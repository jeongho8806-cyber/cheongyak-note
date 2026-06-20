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
    const tokens = q.split(/\s+/).filter(Boolean);
    const aptRaw = tokens[0] || q;                  // 첫 토큰 = 단지명(원본)
    const rest = tokens.slice(1);                   // 나머지 = 지역/동
    // 지역 토큰 중 '동/읍/면'으로 끝나는 걸 동네로, '구/시/군'을 시군구로 분리
    const dong = rest.find(t => /(동|읍|면|가)$/.test(t)) || "";
    const gugu = rest.find(t => /(구|시|군)$/.test(t)) || "";
    const region = rest.join(" ");

    // 단지명 정규화: 괄호 안 내용 제거, 끝의 'N차/N단지' 제거, 특수문자 정리
    const aptClean = aptRaw
      .replace(/\(.*?\)/g, "")
      .replace(/\d+차$/,"").replace(/\d+단지$/,"")
      .replace(/[·,]/g," ").trim();
    const aptBase = aptClean.replace(/아파트$/,"").trim(); // '아파트' 접미사도 떼본 형태

    // 시도 후보를 우선순위대로 구성 (중복 제거)
    const cands = [];
    const push = s => { s = (s||"").trim(); if (s && !cands.includes(s)) cands.push(s); };
    push(q);                              // ① 원본 그대로
    push(dong + " " + aptClean);          // ② 동 + 정제단지명  (예: 압구정동 신현대)
    push(dong + " " + aptBase);           // ③ 동 + 단지명(아파트 제거)
    push(aptClean + " " + dong);          // ④ 정제단지명 + 동
    push(gugu + " " + aptClean);          // ⑤ 구 + 정제단지명
    push(aptClean);                       // ⑥ 정제단지명만
    push(aptBase);                        // ⑦ 단지명만(아파트 제거)
    push(aptRaw);                         // ⑧ 원본 단지명

    let hit = null;
    for (const cand of cands) {
      hit = await searchKeyword(cand, headers);
      if (hit) break;
    }
    // 키워드로 다 실패하면 주소 검색
    if (!hit) hit = await searchAddress(q, headers) || await searchAddress(region, headers);
    // 그래도 없으면 동네 중심이라도
    if (!hit && dong && gugu) hit = await searchKeyword(gugu + " " + dong, headers);

    if (!hit) return resp(200, { ok: false, error: "좌표를 찾지 못했습니다.", q, tried: cands });
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
