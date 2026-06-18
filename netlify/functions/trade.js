// netlify/functions/trade.js
// 국토교통부 아파트 매매 실거래가 상세자료(XML) 중계 함수
// 주요 지역들의 이번 달(+지난 달) 거래를 모아 가격순 TOP으로 반환
// 호출 예: /api/trade            (주요지역 신고가 TOP)
//          /api/trade?lawd=11680&ymd=202606  (특정 지역/월)

const ENDPOINT = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev";

// 주요 지역(법정동 시군구 코드 5자리) — 신고가가 잘 나오는 서울 주요구 + 핵심 지역
const MAJOR_REGIONS = [
  { code: "11680", name: "강남구" },
  { code: "11650", name: "서초구" },
  { code: "11710", name: "송파구" },
  { code: "11440", name: "마포구" },
  { code: "11215", name: "광진구" },
  { code: "11170", name: "용산구" },
  { code: "41135", name: "성남분당" },
  { code: "41210", name: "광명시" },
];

// 거래년월 문자열(YYYYMM) 만들기
function ymd(offset) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return "" + d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0");
}

// XML에서 <item>...</item> 블록들을 파싱해 객체 배열로 변환
function parseItems(xml, regionName) {
  const items = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const b of blocks) {
    const get = (tag) => {
      const m = b.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"));
      return m ? m[1].trim() : "";
    };
    const amountStr = get("dealAmount").replace(/[^0-9]/g, "");
    const amount = amountStr ? parseInt(amountStr, 10) : 0; // 만원
    if (!amount) continue;
    items.push({
      apt: get("aptNm"),
      amount: amount, // 만원
      area: parseFloat(get("excluUseAr")) || 0,
      floor: parseInt(get("floor"), 10) || 0,
      year: get("dealYear"),
      month: get("dealMonth"),
      day: get("dealDay"),
      dong: get("umdNm"),
      buildYear: get("buildYear"),
      region: regionName,
      lawd: get("sggCd"),
    });
  }
  return items;
}

exports.handler = async function (event) {
  const p = event.queryStringParameters || {};
  const KEY = process.env.APPLYHOME_KEY;
  if (!KEY) return resp(500, { error: "APPLYHOME_KEY 환경변수가 설정되지 않았습니다." });

  // 특정 단지 거래이력 조회 모드 (지역코드 + 단지명, 최근 여러 달)
  if (p.lawd && p.apt) {
    const aptName = p.apt;
    const monthsHist = [ymd(0), ymd(-1), ymd(-2), ymd(-3), ymd(-4), ymd(-5)];
    try {
      const tasks = monthsHist.map((mm) =>
        fetch(buildUrl(p.lawd, mm, KEY, "200"))
          .then((r) => r.text())
          .then((xml) => parseItems(xml, p.lawd))
          .catch(() => [])
      );
      const results = await Promise.all(tasks);
      let rows = [];
      results.forEach((arr) => { rows = rows.concat(arr); });
      // 단지명이 일치하는 것만
      const norm = (s) => (s || "").replace(/\s|\(.*?\)/g, "");
      const target = norm(aptName);
      rows = rows.filter((it) => norm(it.apt) === target || norm(it.apt).indexOf(target) >= 0 || target.indexOf(norm(it.apt)) >= 0);
      // 최신순 정렬
      rows.sort((a, b) => {
        const da = a.year + String(a.month).padStart(2,"0") + String(a.day).padStart(2,"0");
        const db = b.year + String(b.month).padStart(2,"0") + String(b.day).padStart(2,"0");
        return db.localeCompare(da);
      });
      return resp(200, { items: rows });
    } catch (e) {
      return resp(502, { error: "단지 이력 조회 실패", detail: String(e) });
    }
  }

  // 특정 지역/월 단건 조회 모드
  if (p.lawd) {
    const url = buildUrl(p.lawd, p.ymd || ymd(0), KEY, p.rows || "50");
    try {
      const r = await fetch(url);
      const xml = await r.text();
      return resp(200, { items: parseItems(xml, p.lawd) });
    } catch (e) {
      return resp(502, { error: "실거래가 호출 실패", detail: String(e) });
    }
  }

  // 기본: 주요 지역 신고가 TOP 모드
  const months = [ymd(0), ymd(-1)]; // 이번 달 + 지난 달
  let all = [];
  try {
    // 지역 x 월 병렬 호출
    const tasks = [];
    for (const rg of MAJOR_REGIONS) {
      for (const mm of months) {
        tasks.push(
          fetch(buildUrl(rg.code, mm, KEY, "50"))
            .then((r) => r.text())
            .then((xml) => parseItems(xml, rg.name))
            .catch(() => [])
        );
      }
    }
    const results = await Promise.all(tasks);
    results.forEach((arr) => { all = all.concat(arr); });

    // 가격순 정렬 후 상위 20건
    all.sort((a, b) => b.amount - a.amount);
    const top = all.slice(0, 20);
    return resp(200, { items: top, totalScanned: all.length });
  } catch (e) {
    return resp(502, { error: "실거래가 집계 실패", detail: String(e) });
  }
};

function buildUrl(lawd, dealYmd, key, rows) {
  return ENDPOINT +
    "?serviceKey=" + encodeURIComponent(key) +
    "&LAWD_CD=" + encodeURIComponent(lawd) +
    "&DEAL_YMD=" + encodeURIComponent(dealYmd) +
    "&pageNo=1&numOfRows=" + encodeURIComponent(rows);
}

function resp(status, body) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
    body: JSON.stringify(body),
  };
}
