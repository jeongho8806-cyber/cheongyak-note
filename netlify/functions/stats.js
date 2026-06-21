// netlify/functions/stats.js
// 한국부동산원 R-ONE 주간 아파트 매매·전세 가격지수를 가져와
// 핵심 지역(전국/수도권/지방/서울/경기/인천)의 최신 지수와 전주 대비 변동을 정리해 반환.
// 인증키는 Netlify 환경변수 REB_KEY 에 저장 (브라우저에 노출되지 않음).

const REB_KEY = process.env.REB_KEY;

// 주간 통계표 코드
const STATBL = {
  sale:   'T244183132827305', // (주) 매매가격지수
  jeonse: 'T247713133046872', // (주) 전세가격지수
};

// 우리가 카드에 보여줄 핵심 지역 (CLS_NM 기준)
const PICK = ['전국', '수도권', '지방권', '서울', '경기', '인천'];

// R-ONE 한 통계표 호출 → 최신 시점 지역별 지수 + 전주 대비 변동 계산
async function fetchStat(statblId) {
  // R-ONE은 한 번에 최대 행 수 제한이 있고 오래된 시점부터 줄 수 있어,
  // 여러 페이지를 받아 전체에서 최신 시점을 정확히 고른다.
  let allRows = [];
  for (let page = 1; page <= 8; page++) {
    const url = `https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do`
      + `?KEY=${REB_KEY}`
      + `&STATBL_ID=${statblId}`
      + `&DTACYCLE_CD=WK`
      + `&Type=json`
      + `&pIndex=${page}&pSize=1000`;
    const res = await fetch(url);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { break; }
    const container = json.SttsApiTblData;
    if (!container || !Array.isArray(container)) break;
    const rowBlock = container.find(b => b && b.row);
    const rows = rowBlock ? rowBlock.row : [];
    if (!rows.length) break;
    allRows = allRows.concat(rows);
    if (rows.length < 1000) break; // 마지막 페이지
  }
  if (!allRows.length) throw new Error('R-ONE row 비어있음');
  return buildResult(allRows);
}

function buildResult(rows) {
  // 각 row: { CLS_NM(지역명), WRTTIME_IDTFR_ID(시점 YYMMDD), DTA_VAL(값), ... }
  const byRegion = {};
  rows.forEach(r => {
    const region = (r.CLS_NM || '').trim();
    const time = String(r.WRTTIME_IDTFR_ID || '');
    const val = parseFloat(r.DTA_VAL);
    if (!region || !time || isNaN(val)) return;
    (byRegion[region] = byRegion[region] || []).push({ time, val });
  });

  const result = [];
  PICK.forEach(name => {
    const arr = byRegion[name];
    if (!arr || !arr.length) return;
    // 시점을 숫자로 정렬 (YYMMDD → 6자리 숫자 비교)
    arr.sort((a, b) => Number(a.time) - Number(b.time));
    const last = arr[arr.length - 1];
    const prev = arr.length >= 2 ? arr[arr.length - 2] : null;
    const change = prev ? +(last.val - prev.val).toFixed(2) : null;
    result.push({
      region: name,
      value: last.val.toFixed(2),
      change,
      time: last.time,
    });
  });
  return { rows: result, latestTime: result.length ? result[0].time : '' };
}

exports.handler = async function () {
  if (!REB_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'REB_KEY 환경변수가 설정되지 않았습니다.' }) };
  }
  try {
    const [sale, jeonse] = await Promise.all([
      fetchStat(STATBL.sale),
      fetchStat(STATBL.jeonse),
    ]);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify({
        saleIdx: sale.rows,
        jeonseIdx: jeonse.rows,
        latestTime: sale.latestTime || jeonse.latestTime,
      }),
    };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
