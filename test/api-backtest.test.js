// test/api-backtest.test.js
const { _resetForTests } = require('../lib/rateLimit');
_resetForTests();

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ PASS:', msg);
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 1년치(약 250 영업일) 데이터를 생성 — 백테스트는 6개월치였던 다른 테스트보다 더 길게 필요
function genYearPayload(seed, days = 250) {
  const rand = mulberry32(seed);
  const timestamp = [], close = [], high = [], low = [], volume = [];
  let p = 10000 + rand() * 90000;
  const bias = (rand() - 0.5) * 0.008;
  for (let i = 0; i < days; i++) {
    p *= (1 + bias + (rand() - 0.5) * 0.015);
    if (p < 100) p = 100;
    timestamp.push(1700000000 + i * 86400);
    close.push(p); high.push(p * 1.01); low.push(p * 0.99);
    volume.push(Math.round(50000 + rand() * 200000));
  }
  return { chart: { result: [{ meta: { currency: 'KRW', regularMarketPrice: p, previousClose: close[close.length - 2] }, timestamp, indicators: { quote: [{ close, high, low, volume }] } }], error: null } };
}

let requestedRanges = [];
global.fetch = async (url) => {
  const u = decodeURIComponent(url);
  const rangeMatch = u.match(/range=(\w+)/);
  requestedRanges.push(rangeMatch ? rangeMatch[1] : null);
  const tickerMatch = u.match(/chart\/([^?]+)\?/);
  const ticker = tickerMatch ? tickerMatch[1] : 'UNKNOWN';
  const seed = ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return { ok: true, status: 200, text: async () => JSON.stringify(genYearPayload(seed)) };
};

const handler = require('../api/backtest');

function createMockReqRes(query) {
  const req = { method: 'GET', query };
  let statusCode = 200, jsonBody = null;
  const res = { setHeader: () => {}, status(c) { statusCode = c; return this; }, json(b) { jsonBody = b; return this; }, end() { return this; } };
  return { req, res, getBody: () => jsonBody, getStatus: () => statusCode };
}

(async () => {
  console.log('=== 백테스트 API 테스트 1: 기본 호출 ===');
  requestedRanges = [];
  const t1 = createMockReqRes({ market: 'KOSPI', count: '8' });
  await handler(t1.req, t1.res);
  const b1 = t1.getBody();
  console.log('status:', t1.getStatus());
  console.log('overallStats:', b1.overallStats);
  console.log('interpretation:', b1.interpretation);
  assert(t1.getStatus() === 200, '정상 응답은 200이어야 함');
  assert(b1.succeeded > 0, '성공한 종목이 있어야 함');
  assert(b1.perStock.length === b1.succeeded, 'perStock 배열 길이는 succeeded와 같아야 함');

  console.log('\n=== 백테스트 API 테스트 2: 1년치(range=1y) 요청했는지 확인 ===');
  assert(requestedRanges.every(r => r === '1y'), `모든 요청이 range=1y 여야 함 (실제: ${[...new Set(requestedRanges)]})`);

  console.log('\n=== 백테스트 API 테스트 3: count 파라미터로 종목 수 제한 ===');
  const t3 = createMockReqRes({ market: 'KOSPI', count: '3' });
  await handler(t3.req, t3.res);
  const b3 = t3.getBody();
  assert(b3.requestedStocks === 3, `count=3이면 requestedStocks도 3이어야 함 (실제: ${b3.requestedStocks})`);

  console.log('\n=== 백테스트 API 테스트 4: count 상한(MAX_STOCKS=20) 적용 ===');
  const t4 = createMockReqRes({ market: 'KR_ALL', count: '999' });
  await handler(t4.req, t4.res);
  const b4 = t4.getBody();
  assert(b4.requestedStocks <= 20, `count가 999여도 최대 20으로 제한되어야 함 (실제: ${b4.requestedStocks})`);

  console.log('\n=== 백테스트 API 테스트 5: minScore/horizonDays 파라미터 반영 ===');
  const t5 = createMockReqRes({ market: 'KOSPI', count: '5', minScore: '75', horizonDays: '15' });
  await handler(t5.req, t5.res);
  const b5 = t5.getBody();
  assert(b5.minScore === 75, `minScore=75가 응답에 반영되어야 함 (실제: ${b5.minScore})`);
  assert(b5.horizonDays === 15, `horizonDays=15가 응답에 반영되어야 함 (실제: ${b5.horizonDays})`);

  console.log('\n=== 백테스트 API 테스트 6: 비정상 파라미터 클램핑 ===');
  const t6 = createMockReqRes({ market: 'KOSPI', minScore: '-50', horizonDays: '999' });
  await handler(t6.req, t6.res);
  const b6 = t6.getBody();
  assert(b6.minScore >= 0 && b6.minScore <= 90, `minScore는 0~90 범위로 클램핑되어야 함 (실제: ${b6.minScore})`);
  assert(b6.horizonDays >= 3 && b6.horizonDays <= 20, `horizonDays는 3~20 범위로 클램핑되어야 함 (실제: ${b6.horizonDays})`);

  console.log('\n=== 백테스트 API 테스트 6b: 숫자가 아닌 입력(NaN 유발) 안전 처리 ===');
  const t6b = createMockReqRes({ market: 'KOSPI', count: 'abc', minScore: 'xyz', horizonDays: 'not-a-number' });
  await handler(t6b.req, t6b.res);
  const b6b = t6b.getBody();
  console.log('비숫자 입력 응답:', { requestedStocks: b6b.requestedStocks, minScore: b6b.minScore, horizonDays: b6b.horizonDays });
  assert(t6b.getStatus() === 200, '비숫자 입력도 에러로 죽지 않고 기본값으로 처리되어야 함');
  assert(Number.isFinite(b6b.minScore), 'minScore가 NaN이 아니라 유효한 숫자여야 함');
  assert(Number.isFinite(b6b.horizonDays), 'horizonDays가 NaN이 아니라 유효한 숫자여야 함');
  assert(Number.isFinite(b6b.requestedStocks) && b6b.requestedStocks > 0, 'requestedStocks가 NaN이 아니라 유효한 양수여야 함');

  console.log('\n=== 백테스트 API 테스트 7: perStock 각 항목에 stats가 들어있는지 ===');
  const allHaveStats = b1.perStock.every(s => s.stats && typeof s.stats.totalSamples === 'number');
  assert(allHaveStats, '모든 perStock 항목에 stats가 있어야 함');

  console.log('\n=== 백테스트 API 테스트 8: interpretation 문구가 실제로 생성되는지 ===');
  assert(typeof b1.interpretation === 'string' && b1.interpretation.length > 0, 'interpretation은 비어있지 않은 문자열이어야 함');

  console.log('\n=== 백테스트 API 테스트 9: avgPredictedProb과 actualUpRate 동시 존재시 gap 계산 정합성 ===');
  if (b1.overallStats && b1.overallStats.selectedSamples >= 20) {
    const hasGapMention = b1.interpretation.includes('%');
    assert(hasGapMention, '표본이 충분하면 interpretation에 구체적 수치(%)가 포함되어야 함');
  } else {
    console.log('(표본 부족으로 gap 검증 스킵, 표본수:', b1.overallStats?.selectedSamples, ')');
  }

  console.log('\n백테스트 API 테스트 완료.');
})();
