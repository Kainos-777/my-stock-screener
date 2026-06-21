// test/api-screen.test.js
// api/screen.js 핸들러를 실제 req/res 객체를 흉내내어 호출, fetch는 모킹.

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

function genGoodPayload(seed, days = 95) {
  const rand = mulberry32(seed);
  const timestamp = [], close = [], high = [], low = [], volume = [];
  let p = 10000 + rand() * 90000;
  const bias = (rand() - 0.5) * 0.01;
  for (let i = 0; i < days; i++) {
    p *= (1 + bias + (rand() - 0.5) * 0.015);
    if (p < 100) p = 100;
    timestamp.push(1700000000 + i * 86400);
    close.push(p); high.push(p * 1.01); low.push(p * 0.99);
    volume.push(Math.round(50000 + rand() * 200000));
  }
  return {
    chart: {
      result: [{
        meta: { currency: 'KRW', regularMarketPrice: p, previousClose: close[close.length - 2] },
        timestamp,
        indicators: { quote: [{ close, high, low, volume }] },
      }],
      error: null,
    },
  };
}

// fetch 모킹: 티커별로 시드를 다르게 줘서 다양한 점수가 나오게 함.
// 일부 티커는 의도적으로 실패시켜 부분 실패 처리도 검증.
let callCount = 0;
global.fetch = async (url) => {
  callCount++;
  const tickerMatch = decodeURIComponent(url).match(/chart\/([^?]+)\?/);
  const ticker = tickerMatch ? tickerMatch[1] : 'UNKNOWN';

  // 의도적 실패 케이스: 코드가 'FAILME'로 끝나는 임의 종목 (없지만 안전장치 확인용)
  if (ticker.includes('FAILTEST')) {
    return { ok: true, status: 200, text: async () => 'Edge: Not Found' };
  }

  const seed = ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(genGoodPayload(seed)),
  };
};

const handler = require('../api/screen');
const { _resetForTests } = require('../lib/rateLimit');
_resetForTests(); // 이 테스트 파일이 여러 번 handler를 호출하므로 매 실행 시작시 초기화

function createMockReqRes(query) {
  const req = { method: 'GET', query };
  let statusCode = 200;
  let jsonBody = null;
  const res = {
    setHeader: () => {},
    status(code) { statusCode = code; return this; },
    json(body) { jsonBody = body; return this; },
    end() { return this; },
  };
  return { req, res, getStatus: () => statusCode, getBody: () => jsonBody };
}

(async () => {
  console.log('=== API 테스트 1: KOSPI만 조회 ===');
  callCount = 0;
  const t1 = createMockReqRes({ market: 'KOSPI', limit: '15' });
  await handler(t1.req, t1.res);
  const b1 = t1.getBody();
  console.log('status:', t1.getStatus(), 'scanned:', b1.scanned, 'succeeded:', b1.succeeded, 'stocks:', b1.stocks.length);
  assert(t1.getStatus() === 200, '정상 응답은 200이어야 함');
  assert(b1.stocks.length <= 15, `limit=15이면 15개 이하여야 함 (실제: ${b1.stocks.length})`);
  assert(b1.market === 'KOSPI', 'market 필드가 echo 되어야 함');
  assert(callCount === b1.scanned, `fetch 호출 횟수(${callCount})는 scanned(${b1.scanned})와 같아야 함`);

  // rank가 1부터 순차 부여되는지
  const ranksOk = b1.stocks.every((s, i) => s.rank === i + 1);
  assert(ranksOk, 'rank는 1부터 순차적으로 부여되어야 함');

  // 점수 내림차순 정렬 확인
  let sorted = true;
  for (let i = 1; i < b1.stocks.length; i++) if (b1.stocks[i].score > b1.stocks[i - 1].score) sorted = false;
  assert(sorted, '응답의 stocks는 점수 내림차순이어야 함');

  // prob2w가 40~82 범위인지
  const probOk = b1.stocks.every(s => s.prob2w >= 40 && s.prob2w <= 82);
  assert(probOk, 'prob2w는 40~82 범위 내여야 함');

  console.log('\n=== API 테스트 2: limit=5 ===');
  const t2 = createMockReqRes({ market: 'KOSPI', limit: '5' });
  await handler(t2.req, t2.res);
  const b2 = t2.getBody();
  assert(b2.stocks.length === 5, `limit=5이면 정확히 5개 (실제: ${b2.stocks.length})`);

  console.log('\n=== API 테스트 3: 섹터 필터 (반도체) ===');
  const t3 = createMockReqRes({ market: 'KR_ALL', sector: '반도체', limit: '15' });
  await handler(t3.req, t3.res);
  const b3 = t3.getBody();
  console.log('반도체 섹터 결과:', b3.stocks.map(s => s.name));
  const sectorOk = b3.stocks.every(s => s.sector === '반도체');
  assert(sectorOk, '섹터 필터 적용시 모든 결과가 해당 섹터여야 함');

  console.log('\n=== API 테스트 4: 잘못된 market 파라미터 ===');
  const t4 = createMockReqRes({ market: 'MARS_STOCK_EXCHANGE' });
  await handler(t4.req, t4.res);
  console.log('status:', t4.getStatus(), 'body:', t4.getBody());
  assert(t4.getStatus() === 400, '알 수 없는 market은 400 에러여야 함');

  console.log('\n=== API 테스트 5: 존재하지 않는 섹터 ===');
  const t5 = createMockReqRes({ market: 'KOSPI', sector: '우주산업' });
  await handler(t5.req, t5.res);
  const b5 = t5.getBody();
  console.log('status:', t5.getStatus(), 'stocks:', b5.stocks.length, 'warning:', b5.warning);
  assert(t5.getStatus() === 200, '빈 결과도 200으로 응답해야 함 (서버 에러 아님)');
  assert(b5.stocks.length === 0, '존재하지 않는 섹터는 빈 배열 반환');
  assert(!!b5.warning, '안내 메시지가 포함되어야 함');

  console.log('\n=== API 테스트 6: POST 요청 거부 ===');
  const t6 = createMockReqRes({});
  t6.req.method = 'POST';
  await handler(t6.req, t6.res);
  assert(t6.getStatus() === 405, 'POST는 405 Method Not Allowed');

  console.log('\n=== API 테스트 7: 응답에 failedDetail이 너무 길지 않은지 ===');
  assert(b1.failedDetail.length <= 10, 'failedDetail은 최대 10개로 제한되어야 함');

  console.log('\n=== API 테스트 8: 전체 종목(US_ALL) 조회 성능/정합성 ===');
  const start = Date.now();
  const t8 = createMockReqRes({ market: 'US_ALL', limit: '15' });
  await handler(t8.req, t8.res);
  const elapsed = Date.now() - start;
  const b8 = t8.getBody();
  console.log(`US_ALL: scanned=${b8.scanned}, succeeded=${b8.succeeded}, elapsed=${elapsed}ms`);
  assert(b8.succeeded > 0, 'US_ALL 스캔 결과가 있어야 함');
  assert(elapsed < 5000, `모킹 환경에서는 5초 이내 완료되어야 함 (실제: ${elapsed}ms)`);

  console.log('\n전체 API 테스트 완료.');
})();
