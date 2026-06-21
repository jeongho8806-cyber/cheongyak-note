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
  const PAGE_SIZE = 1000;

  // 1) 먼저 전체 개수를 확인해 마지막 페이지 번호를 구한다
  const firstUrl = `https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do`
    + `?KEY=${REB_KEY}&STATBL_ID=${statblId}&DTACYCLE_CD=WK&Type=json&pIndex=1&pSize=${PAGE_SIZE}`;
  const firstRes = await fetch(firstUrl);
  const firstJson = JSON.parse(await firstRes.text());
  const container = firstJson.SttsApiTblData;
  if (!container || !Array.isArray(container)) throw new Error('R-ONE 형식 오류');
  const head = (container.find(b => b && b.head) || {}).head || [];
  const totalObj = head.find(h => h.list_total_count !== undefined);
  const total = totalObj ? Number(totalObj.list_total_count) : 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 2) 마지막 몇 페이지(최신 시점들)를 받아온다 (뒤에서부터 3페이지)
  let allRows = [];
  const startPage = Math.max(1, lastPage - 2);
  for (let page = startPage; page <= lastPage; page++) {
    const url = `https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do`
      + `?KEY=${REB_KEY}&STATBL_ID=${statblId}&DTACYCLE_CD=WK&Type=json&pIndex=${page}&pSize=${PAGE_SIZE}`;
    const res = await fetch(url);
    let json;
    try { json = JSON.parse(await res.text()); } catch (e) { continue; }
    const c = json.SttsApiTblData;
    if (!c || !Array.isArray(c)) continue;
    const rowBlock = c.find(b => b && b.row);
    if (rowBlock && rowBlock.row) allRows = allRows.concat(rowBlock.row);
  }
  if (!allRows.length) throw new Error('R-ONE row 비어있음');
  return buildResult(allRows);
}

function buildResult(rows) {
  // 시점은 WRTTIME_DESC(예: "2012-05-07" 또는 "2026-06-15")가 실제 날짜라 이걸로 정렬
  const byRegion = {};
  rows.forEach(r => {
    const region = (r.CLS_NM || '').trim();
    const full = (r.CLS_FULLNM || '');
    const dateStr = String(r.WRTTIME_DESC || r.WRTTIME_IDTFR_ID || '');
    const val = parseFloat(r.DTA_VAL);
    if (!region || !dateStr || isNaN(val)) return;
    // 동명 지역(중구 등) 구분: 전국/수도권/지방권/서울/경기/인천은 최상위라 FULLNM으로 식별
    let key = null;
    if (region === '전국' && full === '전국') key = '전국';
    else if (region === '수도권') key = '수도권';
    else if (region === '지방권') key = '지방권';
    else if (region === '서울' && full === '서울') key = '서울';
    else if (region === '경기' && full === '경기') key = '경기';
    else if (region === '인천' && full === '인천') key = '인천';
    if (!key) return;
    (byRegion[key] = byRegion[key] || []).push({ date: dateStr, val });
  });

  const result = [];
  PICK.forEach(name => {
    const arr = byRegion[name];
    if (!arr || !arr.length) return;
    arr.sort((a, b) => a.date.localeCompare(b.date)); // "2026-06-15" 문자열 정렬 = 날짜순
    const last = arr[arr.length - 1];
    const prev = arr.length >= 2 ? arr[arr.length - 2] : null;
    const change = prev ? +(last.val - prev.val).toFixed(2) : null;
    result.push({
      region: name,
      value: last.val.toFixed(2),
      change,
      time: last.date,
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
