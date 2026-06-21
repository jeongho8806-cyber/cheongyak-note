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

// 상단 요약 카드용 핵심 지역
const PICK = ['전국', '수도권', '지방권', '서울', '경기', '인천'];

// 17개 시도 전체 (CLS_FULLNM 최상위 기준)
const SIDO = ['서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주'];

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
  // 시점은 WRTTIME_DESC(예: "2026-06-15")가 실제 날짜라 이걸로 정렬
  // 지역 식별: 전국/수도권/지방권은 CLS_NM, 17개 시도는 CLS_FULLNM 최상위로 구분
  const byRegion = {};
  function push(key, date, val){
    (byRegion[key] = byRegion[key] || []).push({ date, val });
  }
  rows.forEach(r => {
    const region = (r.CLS_NM || '').trim();
    const full = (r.CLS_FULLNM || '').trim();
    const dateStr = String(r.WRTTIME_DESC || '');
    const val = parseFloat(r.DTA_VAL);
    if (!dateStr || isNaN(val)) return;

    // 광역 단위
    if (region === '전국' && full === '전국') push('전국', dateStr, val);
    else if (region === '수도권') push('수도권', dateStr, val);
    else if (region === '지방권') push('지방권', dateStr, val);

    // 17개 시도: CLS_FULLNM이 시도명과 정확히 일치하는 최상위 행
    // (예: "서울", "경기", "부산" — 하위는 "서울>강북지역" 식이라 제외)
    if (SIDO.indexOf(full) !== -1) push(full, dateStr, val);
  });

  // 각 지역의 시계열 정렬 + 최신/직전 추출
  function latest(arr){
    if(!arr || !arr.length) return null;
    arr.sort((a,b)=>a.date.localeCompare(b.date));
    const last = arr[arr.length-1];
    const prev = arr.length>=2 ? arr[arr.length-2] : null;
    const change = prev ? +(last.val-prev.val).toFixed(2) : null;
    return { value:+last.val.toFixed(2), change, time:last.date,
             series: arr.slice(-12).map(x=>+x.val.toFixed(2)) };
  }

  // 상단 요약용 (전국/수도권/지방/서울/경기/인천)
  const summary = [];
  PICK.forEach(name=>{
    const L = latest(byRegion[name]);
    if(L) summary.push({ region:name, value:L.value.toFixed(2), change:L.change, time:L.time, series:L.series });
  });

  // 17개 시도 전체
  const sido = [];
  SIDO.forEach(name=>{
    const L = latest(byRegion[name]);
    if(L) sido.push({ region:name, value:L.value.toFixed(2), change:L.change, time:L.time });
  });

  // 전국 시계열 (추세 그래프용)
  const nationL = latest(byRegion['전국']);
  const trend = nationL ? nationL.series : [];

  // 상승/하락 지역 TOP (시도 기준, 변동 큰 순)
  const ranked = sido.filter(s=>s.change!==null).slice();
  const topUp = ranked.slice().sort((a,b)=>b.change-a.change).slice(0,5);
  const topDown = ranked.slice().sort((a,b)=>a.change-b.change).slice(0,5);

  return {
    rows: summary,
    sido,
    trend,
    topUp,
    topDown,
    latestTime: summary.length ? summary[0].time : (sido[0]?sido[0].time:'')
  };
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
        saleSido: sale.sido,
        jeonseSido: jeonse.sido,
        saleTrend: sale.trend,
        jeonseTrend: jeonse.trend,
        saleUp: sale.topUp,
        saleDown: sale.topDown,
        jeonseUp: jeonse.topUp,
        jeonseDown: jeonse.topDown,
        latestTime: sale.latestTime || jeonse.latestTime,
      }),
    };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
