// test/yahoo.test.js
// global.fetch를 모킹해서 yahoo.js 파서가 다양한 실제 응답 패턴을 견디는지 검증.

const { fetchOHLCV } = require('../lib/yahoo');

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ PASS:', msg);
}

function mockFetchOnce(responseFactory) {
  global.fetch = async (url, opts) => responseFactory(url, opts);
}

function genGoodPayload(days = 90) {
  const timestamp = [], close = [], high = [], low = [], volume = [];
  let p = 50000;
  for (let i = 0; i < days; i++) {
    p *= 1 + (Math.sin(i / 4) * 0.01);
    timestamp.push(1700000000 + i * 86400);
    close.push(p);
    high.push(p * 1.01);
    low.push(p * 0.99);
    volume.push(100000 + i * 10);
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

(async () => {
  console.log('=== 케이스 1: 정상 JSON 응답 ===');
  mockFetchOnce(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(genGoodPayload(90)),
  }));
  const r1 = await fetchOHLCV('005930.KS');
  console.log({ ok: r1.ok, len: r1.closes?.length, currency: r1.currency });
  assert(r1.ok === true, '정상 응답은 ok:true 여야 함');
  assert(r1.closes.length === 90, '90일치 데이터가 모두 파싱되어야 함');
  assert(r1.currency === 'KRW', '통화 정보가 파싱되어야 함');

  console.log('\n=== 케이스 2: 비-JSON 응답 ("Edge: Not Found" 같은 실제 사례) ===');
  mockFetchOnce(async () => ({
    ok: true,
    status: 200,
    text: async () => 'Edge: Not Found',
  }));
  const r2 = await fetchOHLCV('FAKE.KS');
  console.log(r2);
  assert(r2.ok === false, '비JSON 응답은 ok:false 여야 함 (throw 하면 안 됨)');
  assert(typeof r2.error === 'string', '에러 메시지가 문자열로 존재해야 함');

  console.log('\n=== 케이스 3: HTTP 404 (잘못된 티커) ===');
  mockFetchOnce(async () => ({
    ok: false,
    status: 404,
    text: async () => '{"chart":{"result":null,"error":{"code":"Not Found","description":"No data found"}}}',
  }));
  const r3 = await fetchOHLCV('NOTREAL.KS');
  console.log(r3);
  assert(r3.ok === false, '404는 ok:false 여야 함');

  console.log('\n=== 케이스 4: null 결측치가 섞인 응답 (휴장일 등) ===');
  const goodPayload = genGoodPayload(90);
  const q = goodPayload.chart.result[0].indicators.quote[0];
  // 임의로 5개 행에 null 주입
  [10, 11, 30, 50, 70].forEach(i => { q.close[i] = null; });
  mockFetchOnce(async () => ({
    ok: true, status: 200, text: async () => JSON.stringify(goodPayload),
  }));
  const r4 = await fetchOHLCV('005930.KS');
  console.log({ ok: r4.ok, len: r4.closes?.length });
  assert(r4.ok === true, 'null 일부 섞여도 나머지 데이터로 처리되어야 함');
  assert(r4.closes.length === 85, `null 5개 제외한 85개여야 함 (실제: ${r4.closes?.length})`);

  console.log('\n=== 케이스 5: chart.error 필드가 채워진 정상 에러 응답 ===');
  mockFetchOnce(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ chart: { result: null, error: { code: 'Not Found', description: '존재하지 않는 종목' } } }),
  }));
  const r5 = await fetchOHLCV('000000.KS');
  console.log(r5);
  assert(r5.ok === false, 'chart.error가 있으면 ok:false 여야 함');
  assert(r5.error.includes('존재하지 않는'), '에러 description이 전달되어야 함');

  console.log('\n=== 케이스 6: 데이터 60일 미만 (신규 상장주) ===');
  mockFetchOnce(async () => ({
    ok: true, status: 200, text: async () => JSON.stringify(genGoodPayload(30)),
  }));
  const r6 = await fetchOHLCV('NEWIPO.KS');
  console.log(r6);
  assert(r6.ok === false, '60일 미만이면 ok:false (스코어링 불가)');

  console.log('\n=== 케이스 7: 네트워크 타임아웃 시뮬레이션 ===');
  global.fetch = async (url, { signal }) => {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ ok: true, status: 200, text: async () => '{}' }), 50000);
      signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    });
  };
  const r7 = await fetchOHLCV('SLOW.KS', { timeoutMs: 200 });
  console.log(r7);
  assert(r7.ok === false, '타임아웃은 ok:false 여야 함');
  assert(r7.error === '타임아웃', `에러 메시지가 타임아웃이어야 함 (실제: ${r7.error})`);

  console.log('\n전체 테스트 완료.');
})();
