// netlify/functions/apt.js
// 청약홈(한국부동산원) 분양정보 odcloud API 중계 함수
// 호출 예:
//   /api/apt?type=apt&page=1&perPage=300           (아파트 목록)
//   /api/apt?type=aptMdl&pblancNo=2026000248        (특정 단지 주택형)

const ENDPOINTS = {
  apt:    "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail",
  aptMdl: "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl",
  remain: "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getRemndrLttotPblancDetail",
  remainMdl: "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getRemndrLttotPblancMdl",
  urban:  "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getUrbtyOfctlLttotPblancDetail",
};

exports.handler = async function (event) {
  const p = event.queryStringParameters || {};
  const type = p.type || "apt";
  const page = p.page || "1";
  const perPage = p.perPage || "100";
  const pblancNo = p.pblancNo || ""; // 특정 공고번호로 필터링

  const base = ENDPOINTS[type] || ENDPOINTS.apt;
  const KEY = process.env.APPLYHOME_KEY;
  if (!KEY) return resp(500, { error: "APPLYHOME_KEY 환경변수가 설정되지 않았습니다." });

  let url = base + "?page=" + encodeURIComponent(page) + "&perPage=" + encodeURIComponent(perPage) + "&serviceKey=" + encodeURIComponent(KEY);
  // 공고번호 필터 (특정 단지의 주택형만 조회할 때)
  if (pblancNo) {
    url += "&cond%5BPBLANC_NO%3A%3AEQ%5D=" + encodeURIComponent(pblancNo);
  }

  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { return resp(502, { error: "JSON 파싱 실패", raw: text.slice(0, 500) }); }
    return resp(200, data);
  } catch (e) {
    return resp(502, { error: "청약홈 API 호출 실패", detail: String(e) });
  }
};

function resp(status, body) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=1800",
    },
    body: JSON.stringify(body),
  };
}
