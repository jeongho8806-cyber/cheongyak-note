// netlify/functions/geocode.js
// 카카오 로컬 API로 단지명·주소 → 좌표(위경도) 변환
// 호출 예:
//   /api/geocode?q=이문아이파크자이 서울 동대문구
//   → { ok:true, x:127.06, y:37.59, name:"...", address:"..." }
//
// 환경변수: KAKAO_REST_KEY (카카오 REST API 키)

exports.handler = async function (event) {
  const KEY = process.env.KAKAO_REST_KEY;
  if (!KEY) return resp(500, { ok: false, error: "KAKAO_REST_KEY 환경변수가 설정되지 않았습니다." });

  const q = (event.queryStringParameters && event.queryStringParameters.q || "").trim();
  if (!q) return resp(400, { ok: false, error: "검색어(q)가 없습니다." });

  const headers = { Authorization: "KakaoAK " + KEY };

  try {
    // 1) 키워드(장소명) 검색 — "이문아이파크자이" 같은 단지명에 적합
    let hit = await searchKeyword(q, headers);
    // 2) 키워드로 못 찾으면 주소 검색으로 재시도
    if (!hit) hit = await searchAddress(q, headers);
    // 3) 그래도 없으면 단지명을 떼고 지역만으로 한 번 더(대략 위치라도)
    if (!hit) {
      const onlyRegion = q.split(/\s+/).slice(1).join(" "); // 첫 토큰(단지명) 제거
      if (onlyRegion) hit = await searchKeyword(onlyRegion, headers) || await searchAddress(onlyRegion, headers);
    }

    if (!hit) return resp(200, { ok: false, error: "좌표를 찾지 못했습니다.", q });
    return resp(200, { ok: true, x: Number(hit.x), y: Number(hit.y), name: hit.name || "", address: hit.address || "", q });
  } catch (e) {
    return resp(502, { ok: false, error: "좌표 변환 실패", detail: String(e), q });
  }
};

// 키워드(장소) 검색
async function searchKeyword(query, headers) {
  const url = "https://dapi.kakao.com/v2/local/search/keyword.json?size=1&query=" + encodeURIComponent(query);
  const r = await fetch(url, { headers });
  if (!r.ok) return null;
  const j = await r.json();
  const d = j.documents && j.documents[0];
  if (!d) return null;
  return { x: d.x, y: d.y, name: d.place_name, address: d.road_address_name || d.address_name };
}

// 주소 검색
async function searchAddress(query, headers) {
  const url = "https://dapi.kakao.com/v2/local/search/address.json?size=1&query=" + encodeURIComponent(query);
  const r = await fetch(url, { headers });
  if (!r.ok) return null;
  const j = await r.json();
  const d = j.documents && j.documents[0];
  if (!d) return null;
  return { x: d.x, y: d.y, name: "", address: d.address_name };
}

function resp(status, body) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400",
    },
    body: JSON.stringify(body),
  };
}
