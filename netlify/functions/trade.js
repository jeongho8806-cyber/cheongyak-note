// netlify/functions/trade.js
// 국토교통부 실거래가(XML) 중계 함수 — 매매/전세/분양권
// 호출 예:
//   /api/trade                         매매 신고가 TOP (주요지역, 1년 추세 포함)
//   /api/trade?kind=rent               전월세 신고가 TOP (보증금 기준)
//   /api/trade?kind=silv               분양권 신고가 TOP
//   /api/trade?lawd=11680&ymd=202606   특정 지역/월 (매매)
//   /api/trade?lawd=11680&apt=은마      특정 단지 거래이력 (최근 1년)

const ENDPOINTS = {
  trade: "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
  rent:  "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
  silv:  "https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade",
  // 오피스텔
  offitrade: "https://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade",
  offirent:  "https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent",
  // 연립다세대(빌라)
  villatrade: "https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade",
  villarent:  "https://apis.data.go.kr/1613000/RTMSDataSvcRHRent/getRTMSDataSvcRHRent",
};

// 주요 지역(법정동 시군구 코드 5자리)
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
// 분양권은 수도권 신도시/택지 위주로 (분양권 전매가 활발한 곳)
const SILV_REGIONS = [
  { code: "28260", name: "인천서구" },
  { code: "41590", name: "화성시" },
  { code: "41220", name: "평택시" },
  { code: "41630", name: "양주시" },
  { code: "41280", name: "고양덕양" },
  { code: "41271", name: "안양만안" },
  { code: "11680", name: "강남구" },
  { code: "11650", name: "서초구" },
];

function ymd(offset) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return "" + d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0");
}

function tag(block, name) {
  const m = block.match(new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">"));
  return m ? m[1].trim() : "";
}
function num(s) { const n = (s || "").replace(/[^0-9]/g, ""); return n ? parseInt(n, 10) : 0; }
// 단지명: 부동산 유형마다 필드명이 다름 (아파트 aptNm / 오피스텔 offiNm / 빌라 mhouseNm)
function nameTag(b) {
  return tag(b, "aptNm") || tag(b, "offiNm") || tag(b, "mhouseNm") || tag(b, "bldgNm") || "";
}

// 매매 파싱
function parseTrade(xml, regionName) {
  const out = [];
  (xml.match(/<item>[\s\S]*?<\/item>/g) || []).forEach((b) => {
    const amount = num(tag(b, "dealAmount"));
    if (!amount) return;
    out.push({
      apt: nameTag(b), amount, area: parseFloat(tag(b, "excluUseAr")) || 0,
      floor: parseInt(tag(b, "floor"), 10) || 0,
      year: tag(b, "dealYear"), month: tag(b, "dealMonth"), day: tag(b, "dealDay"),
      dong: tag(b, "umdNm"), buildYear: tag(b, "buildYear"),
      region: regionName, lawd: tag(b, "sggCd"),
      cancel: tag(b, "cdealType") === "O", cancelDay: tag(b, "cdealDay"),
    });
  });
  return out;
}
// 전월세 파싱 (전세=월세0, 보증금 기준)
function parseRent(xml, regionName) {
  const out = [];
  (xml.match(/<item>[\s\S]*?<\/item>/g) || []).forEach((b) => {
    const deposit = num(tag(b, "deposit"));
    const monthly = num(tag(b, "monthlyRent"));
    if (!deposit) return;
    out.push({
      apt: nameTag(b), amount: deposit, monthly,
      area: parseFloat(tag(b, "excluUseAr")) || 0,
      floor: parseInt(tag(b, "floor"), 10) || 0,
      year: tag(b, "dealYear"), month: tag(b, "dealMonth"), day: tag(b, "dealDay"),
      dong: tag(b, "umdNm"), buildYear: tag(b, "buildYear"),
      contractType: tag(b, "contractType"),
      preDeposit: num(tag(b, "preDeposit")),
      region: regionName, lawd: tag(b, "sggCd"),
      isRent: monthly > 0,
    });
  });
  return out;
}
// 분양권 파싱
function parseSilv(xml, regionName) {
  const out = [];
  (xml.match(/<item>[\s\S]*?<\/item>/g) || []).forEach((b) => {
    const amount = num(tag(b, "dealAmount"));
    if (!amount) return;
    out.push({
      apt: nameTag(b), amount, area: parseFloat(tag(b, "excluUseAr")) || 0,
      floor: parseInt(tag(b, "floor"), 10) || 0,
      year: tag(b, "dealYear"), month: tag(b, "dealMonth"), day: tag(b, "dealDay"),
      dong: tag(b, "umdNm"), buildYear: tag(b, "buildYear"),
      region: regionName, lawd: tag(b, "sggCd"),
      cancel: tag(b, "cdealType") === "O", cancelDay: tag(b, "cdealDay"),
    });
  });
  return out;
}

function buildUrl(endpoint, lawd, dealYmd, key, rows) {
  return endpoint +
    "?serviceKey=" + encodeURIComponent(key) +
    "&LAWD_CD=" + encodeURIComponent(lawd) +
    "&DEAL_YMD=" + encodeURIComponent(dealYmd) +
    "&pageNo=1&numOfRows=" + encodeURIComponent(rows);
}

// 단지명 정규화 (동·괄호·특수문자 제거 후 비교)
function normName(s){ return (s || "").replace(/\s|\(.*?\)|[0-9]+동|[~,\-]/g, ""); }

exports.handler = async function (event) {
  const p = event.queryStringParameters || {};
  const KEY = process.env.APPLYHOME_KEY;
  if (!KEY) return resp(500, { error: "APPLYHOME_KEY 환경변수가 설정되지 않았습니다." });

  const kind = p.kind || "trade"; // trade | rent | silv
  const endpoint = ENDPOINTS[kind] || ENDPOINTS.trade;
  // 전월세 계열은 parseRent, 분양권은 parseSilv, 나머지(매매·오피스텔매매·빌라매매)는 parseTrade
  const isRentKind = kind === "rent" || kind === "offirent" || kind === "villarent";
  const parser = isRentKind ? parseRent : kind === "silv" ? parseSilv : parseTrade;

  // 특정 단지 거래이력 (kind별로 매매/전월세/분양권 모두 지원, 기간 선택)
  if (p.lawd && p.apt) {
    // months 파라미터로 조회 기간 결정 (기본 12개월, 최대 24개월)
    let span = parseInt(p.months || "12", 10);
    if (isNaN(span) || span < 1) span = 12;
    if (span > 24) span = 24;
    const monthsHist = [];
    for (let i = 0; i >= -(span - 1); i--) monthsHist.push(ymd(i));
    try {
      const results = await Promise.all(monthsHist.map((mm) =>
        fetch(buildUrl(endpoint, p.lawd, mm, KEY, "300")).then((r) => r.text()).then((x) => parser(x, p.lawd)).catch(() => [])
      ));
      let rows = []; results.forEach((a) => { rows = rows.concat(a); });
      const target = normName(p.apt);
      const head = target.slice(0, 4); // 앞 4글자로 느슨하게 매칭
      rows = rows.filter((it) => { const n = normName(it.apt); return n === target || n.indexOf(target) >= 0 || target.indexOf(n) >= 0 || (head && n.indexOf(head) >= 0); });
      rows.sort((a, b) => (b.year + pad(b.month) + pad(b.day)).localeCompare(a.year + pad(a.month) + pad(a.day)));
      return resp(200, { items: rows });
    } catch (e) { return resp(502, { error: "단지 이력 조회 실패", detail: String(e) }); }
  }

  // 특정 지역/월
  if (p.lawd) {
    try {
      // ymd가 지정되면 그 달만
      if (p.ymd) {
        const r = await fetch(buildUrl(endpoint, p.lawd, p.ymd, KEY, p.rows || "1000"));
        const xml = await r.text();
        return resp(200, { items: parser(xml, p.lawd) });
      }
      // 전월세 계열은 거래량이 매우 많아 응답이 비대해짐 → 개월 수를 더 줄이고 단지별로 묶어 전송
      const span = isRentKind ? 3 : 9;
      const mm = [];
      for (let i = 0; i >= -(span - 1); i--) mm.push(ymd(i));
      let items = [];
      const errs = [];
      // 순차 처리 (동시 대량 호출로 인한 타임아웃/메모리 부담 완화)
      for (const m of mm) {
        try {
          const r = await fetch(buildUrl(endpoint, p.lawd, m, KEY, "1000"));
          const x = await r.text();
          items = items.concat(parser(x, p.lawd));
        } catch (e) { errs.push(m + ":" + String(e)); }
      }
      // 거래 많으면 단지+면적별 대표만 (전월세는 항상 묶어 전송)
      if (isRentKind || items.length > 600) items = groupTop(items);
      return resp(200, { items, debug: { span, raw: items.length, errs } });
    } catch (e) { return resp(502, { error: "조회 실패", detail: String(e) }); }
  }

  // 기본: 주요 지역 신고가 TOP
  const regions = kind === "silv" ? SILV_REGIONS : MAJOR_REGIONS;
  const months = [ymd(0), ymd(-1)];
  let all = [];
  try {
    const tasks = [];
    for (const rg of regions) for (const mm of months) {
      tasks.push(fetch(buildUrl(endpoint, rg.code, mm, KEY, "60")).then((r) => r.text()).then((x) => parser(x, rg.name)).catch(() => []));
    }
    (await Promise.all(tasks)).forEach((a) => { all = all.concat(a); });
    all.sort((a, b) => b.amount - a.amount);
    const top = all.slice(0, 30);

    // 추가 호출 없이, 이미 받은 데이터(최근 2개월)에서 단지·평형별 가벼운 시계열만 부착
    attachLightSeries(top, all);

    // series=1 일 때만 상위 단지 최근 1년 추세를 추가 조회 (무거움 → 옵션)
    if (p.series === "1") {
      await attachYearSeries(top, endpoint, KEY, parser, isRentKind);
    }

    return resp(200, { items: top, totalScanned: all.length });
  } catch (e) { return resp(502, { error: "집계 실패", detail: String(e) }); }
};

// 추가 API 호출 없이, 이미 가져온 거래들로 단지·최고가평형별 짧은 시계열 부착
function attachLightSeries(top, all) {
  // 단지명별로 모으기
  const byApt = {};
  all.forEach((x) => { const k = normName(x.apt); (byApt[k] = byApt[k] || []).push(x); });
  top.forEach((t) => {
    const pool = byApt[normName(t.apt)] || [];
    const repArea = Math.round(t.area);
    const series = pool
      .filter((x) => Math.round(x.area) === repArea)
      .sort((a, b) => (a.year + pad(a.month) + pad(a.day)).localeCompare(b.year + pad(b.month) + pad(b.day)))
      .map((x) => x.amount);
    if (series.length >= 2) t._series = series.slice(-12);
  });
}

// 상위 단지들에 _series(최근 1년, 최고가 평형 기준 가격 흐름) 추가
async function attachYearSeries(top, endpoint, KEY, parser, isRentKind) {
  // 1년치는 호출이 많아 무거움 → 상위 N개 단지만, 지역별 1년치를 한 번씩만 조회해 공유
  const LIMIT_APTS = 12;           // 1년 시계열 붙일 상위 단지 수 (화면 6개 + 여유)
  const targets = top.slice(0, LIMIT_APTS);

  // 필요한 (지역코드) 목록 — 지역별 1년치를 모아두면 그 안에서 단지별로 추려쓸 수 있음
  const lawds = [...new Set(targets.map((t) => t.lawd).filter(Boolean))];
  const months12 = [];
  for (let i = 0; i >= -11; i--) months12.push(ymd(i));

  // 지역코드별로 1년치 거래를 캐싱 (지역 수 × 12개월 호출)
  // 보통 상위 단지는 강남·서초 등 소수 지역에 몰려 호출 수가 크지 않음
  const regionCache = {};
  await Promise.all(lawds.map(async (lawd) => {
    let rows = [];
    // 12개월을 3개씩 4묶음으로 나눠 순차 처리 (동시 폭주 방지)
    for (let i = 0; i < months12.length; i += 3) {
      const chunk = months12.slice(i, i + 3);
      const part = await Promise.all(chunk.map((mm) =>
        fetch(buildUrl(endpoint, lawd, mm, KEY, "1000")).then((r) => r.text()).then((x) => parser(x, lawd)).catch(() => [])
      ));
      part.forEach((a) => { rows = rows.concat(a); });
    }
    regionCache[lawd] = rows;
  }));

  // 각 상위 단지: 같은 지역 1년치에서 같은 단지+최고가 평형의 가격 흐름 추출
  targets.forEach((t) => {
    const pool = regionCache[t.lawd] || [];
    const tn = normName(t.apt);
    const repArea = Math.round(t.area);
    const series = pool
      .filter((x) => normName(x.apt) === tn && Math.round(x.area) === repArea)
      .sort((a, b) => (a.year + pad(a.month) + pad(a.day)).localeCompare(b.year + pad(b.month) + pad(b.day)))
      .map((x) => x.amount);
    if (series.length >= 2) t._series = series.slice(-24); // 1년 + 여유(최대 24점)
  });
}

function pad(s) { return String(s).padStart(2, "0"); }
// 거래가 매우 많은 지역: 단지+면적별 대표(최고가) 거래만 남겨 응답 크기 축소
function groupTop(items) {
  const g = {};
  items.forEach((it) => {
    const key = (it.apt || "") + "|" + Math.round(it.area || 0);
    if (!g[key]) { g[key] = it; it._count = 1; }
    else { g[key]._count = (g[key]._count || 1) + 1; if (it.amount > g[key].amount) { const c = g[key]._count; g[key] = it; it._count = c; } }
  });
  return Object.values(g);
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
