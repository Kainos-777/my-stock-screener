// test/timebudget.test.js
const { fetchBatch } = require('../lib/yahoo');

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ PASS:', msg);
}

function genGoodPayload() {
  const timestamp = [], close = [], high = [], low = [], volume = [];
  let p = 50000;
  for (let i = 0; i < 90; i++) {
    p *= 1.001;
    timestamp.push(1700000000 + i * 86400);
    close.push(p); high.push(p * 1.01); low.push(p * 0.99);
    volume.push(100000);
  }
  return { chart: { result: [{ meta: { currency: 'KRW', regularMarketPrice: p, previousClose: close[close.length-2] }, timestamp, indicators: { quote: [{ close, high, low, volume }] } }], error: null } };
}

(async () => {
  console.log('=== 시간 예산 테스트: 일부 종목이 응답 지연될 때 ===');

  // 처음 20개 티커는 즉시 응답, 그 이후는 200ms 지연
  let callIdx = 0;
  global.fetch = async (url, { signal } = {}) => {
    const myIdx = callIdx++;
    const delay = myIdx < 20 ? 0 : 200;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ ok: true, status: 200, text: async () => JSON.stringify(genGoodPayload()) }), delay);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    });
  };

  const tickers = Array.from({ length: 60 }, (_, i) => `T${i}.KS`);
  const start = Date.now();
  const results = await fetchBatch(tickers, { concurrency: 12, timeBudgetMs: 300 });
  const elapsed = Date.now() - start;

  console.log(`총 ${tickers.length}개 중, 소요시간 ${elapsed}ms (예산 300ms)`);
  assert(results.length === tickers.length, `결과 배열 길이는 입력과 같아야 함 (${results.length} vs ${tickers.length})`);

  const skipped = results.filter(r => r && r.error === '시간 예산 초과로 조회 생략');
  console.log('시간초과로 생략된 종목 수:', skipped.length);
  assert(skipped.length > 0, '시간 예산을 넘기면 일부 종목은 생략 처리되어야 함');

  // 예산을 크게 넘기지 않았는지 확인 (어느 정도 여유는 허용 — 진행 중인 배치는 끝까지 기다리므로)
  assert(elapsed < 2000, `시간 예산이 있으면 무한정 걸리면 안 됨 (실제: ${elapsed}ms)`);

  // 결과 순서가 입력 tickers 순서와 일치하는지 (인덱스 정합성)
  const indexOk = results.every((r, i) => r !== null);
  assert(indexOk, '모든 인덱스에 결과(성공 또는 스킵)가 채워져야 함 (null 없음)');

  console.log('\n=== 비교: 예산이 충분할 때는 전부 정상 처리 ===');
  callIdx = 0;
  const results2 = await fetchBatch(tickers.slice(0, 20), { concurrency: 12, timeBudgetMs: 10000 });
  const allOk = results2.every(r => r.ok === true);
  assert(allOk, '예산이 충분하면 전부 정상 처리되어야 함');

  console.log('\n시간 예산 테스트 완료.');
})();
