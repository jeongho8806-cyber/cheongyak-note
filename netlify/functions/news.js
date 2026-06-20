// netlify/functions/news.js
// 네이버 뉴스 검색 API 중계 — 부동산·청약 뉴스 자동 수집
// 호출: /api/news            (기본: 부동산 청약)
//      /api/news?q=재건축    (키워드 지정)

const NAVER_NEWS = "https://openapi.naver.com/v1/search/news.json";

// 기본 키워드 (탭별)
const PRESETS = {
  all:    "부동산 청약",
  apt:    "아파트 청약 분양",
  policy: "부동산 정책 대출 규제",
  redev:  "재건축 재개발",
  market: "부동산 시세 집값",
};

exports.handler = async (event) => {
  const ID = process.env.NAVER_ID;
  const SECRET = process.env.NAVER_SECRET;
  if (!ID || !SECRET) {
    return resp(500, { error: "NAVER_ID / NAVER_SECRET 환경변수가 설정되지 않았습니다." });
  }

  const p = event.queryStringParameters || {};
  const preset = p.preset && PRESETS[p.preset] ? PRESETS[p.preset] : null;
  const query = p.q || preset || PRESETS.all;
  const display = Math.min(parseInt(p.display || "20", 10) || 20, 50);
  const sort = p.sort === "sim" ? "sim" : "date"; // date=최신순(기본), sim=정확도

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
    const items = (data.items || []).map((it) => ({
      title: stripTag(it.title),
      desc: stripTag(it.description),
      link: it.originallink || it.link,
      naverLink: it.link,
      pubDate: it.pubDate,
      date: fmtDate(it.pubDate),
    }));
    return resp(200, { items, query });
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
