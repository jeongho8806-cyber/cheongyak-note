// netlify/functions/news.js
// 네이버 뉴스 검색 API 중계 — 부동산·청약 뉴스 자동 수집
// 호출: /api/news?preset=all      (탭별 프리셋)
//      /api/news?q=재건축          (키워드 직접 지정)
//      /api/news?preset=ranking    (주요 뉴스 TOP = 정확도순)

const NAVER_NEWS = "https://openapi.naver.com/v1/search/news.json";

// 기본 키워드 (탭별)
// ※ 네이버 뉴스 API는 띄어쓰기를 AND 조건으로 처리하므로
//    여러 단어 중 하나만 포함돼도 잡히도록 | (OR) 연산자를 사용한다.
const PRESETS = {
  all:     "부동산|청약|분양|아파트",
  apt:     "청약|분양|아파트 분양|분양권|입주",
  policy:  "부동산 정책|대출 규제|LTV|DSR|부동산 대책",
  redev:   "재건축|재개발|리모델링|정비사업",
  market:  "집값|아파트 시세|부동산 시세|매매가|전셋값",
  ranking: "부동산|청약|분양|아파트", // 정확도순으로 정렬되는 주요 뉴스
};

// 정확도순(sim)으로 띄울 프리셋
const SIM_PRESETS = new Set(["ranking"]);

exports.handler = async (event) => {
  const ID = process.env.NAVER_ID;
  const SECRET = process.env.NAVER_SECRET;
  if (!ID || !SECRET) {
    return resp(500, { error: "NAVER_ID / NAVER_SECRET 환경변수가 설정되지 않았습니다." });
  }

  const p = event.queryStringParameters || {};
  const presetKey = p.preset && PRESETS[p.preset] ? p.preset : null;
  const query = p.q || (presetKey ? PRESETS[presetKey] : PRESETS.all);
  const display = Math.min(parseInt(p.display || "24", 10) || 24, 100);

  // sort: 명시 우선 → 프리셋 기본값 → 최신순
  let sort = "date";
  if (p.sort === "sim" || p.sort === "date") sort = p.sort;
  else if (presetKey && SIM_PRESETS.has(presetKey)) sort = "sim";

  const url = NAVER_NEWS +
    "?query=" + encodeURIComponent(query) +
    "&display=" + display +
    "&start=1&sort=" + sort;

  try {
    const r = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": ID,
        "X-Naver-Client-Secret": SECRET,
      },
    });
    const data = await r.json();

    let items = (data.items || []).map((it) => ({
      title: stripTag(it.title),
      desc: stripTag(it.description),
      link: it.originallink || it.link,
      naverLink: it.link,
      pubDate: it.pubDate,
      date: fmtDate(it.pubDate),
    }));

    // 같은 제목 중복 기사 제거
    items = dedupe(items);

    return resp(200, { items, query, sort });
  } catch (e) {
    return resp(502, { error: "네이버 뉴스 호출 실패", detail: String(e) });
  }
};

// HTML 태그·엔티티 제거 (네이버는 <b> 강조 태그를 넣어줌)
function stripTag(s) {
  return (s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .trim();
}

// 제목 기준 중복 제거 (공백·특수문자 정규화 후 비교)
function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = (it.title || "").replace(/[\s\W]+/g, "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

// "Mon, 16 Jun 2026 09:30:00 +0900" → "2026.06.16"
function fmtDate(s) {
  const d = new Date(s);
  if (isNaN(d)) return "";
  return d.getFullYear() + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + String(d.getDate()).padStart(2, "0");
}

function resp(status, body) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=900", // 15분 캐시
    },
    body: JSON.stringify(body),
  };
}
