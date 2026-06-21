// test/scoring.test.js
const { scoreStock } = require('../lib/scoring');
const { rsi, sma, volumeRatio, momentum, atrPct } = require('../lib/indicators');

// 시드 고정 PRNG (테스트 재현성 확보 — Math.random() 매번 다른 결과 방지)
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genSeries({ days = 90, startPrice = 50000, pattern = 'flat', volBase = 100000, seed = 42 }) {
  const rand = mulberry32(seed);
  const closes = [], highs = [], lows = [], volumes = [];
  let price = startPrice;
  for (let i = 0; i < days; i++) {
    let drift = 0;
    const noise = (rand() - 0.5) * 0.012; // 일별 노이즈 (RSI가 0/100 극단으로 안 쏠리게 충분히 키움)
    if (pattern === 'oversold_bounce') {
      // 65일간 완만 하락 → 마지막 14일은 등락을 섞은 약한 반등 (RSI 14일 윈도우 안에 혼합신호 포함되게)
      if (i < days - 14) drift = -0.004;
      else drift = (i % 2 === 0) ? 0.012 : -0.003; // 반등 추세지만 매일 상승은 아님
    } else if (pattern === 'overheated') {
      // 지속 급등이지만 가끔 조정 섞어서 RSI가 100에 붙지 않게
      drift = (i % 4 === 3) ? -0.01 : 0.018;
    } else if (pattern === 'flat') {
      drift = Math.sin(i / 5) * 0.003;
    } else if (pattern === 'steady_uptrend') {
      // 꾸준 상승이지만 3일에 한 번은 소폭 조정
      drift = (i % 3 === 2) ? -0.004 : 0.009;
    }
    price = price * (1 + drift + noise);
    const high = price * 1.012;
    const low = price * 0.988;
    closes.push(price);
    highs.push(high);
    lows.push(low);
    const volSpike = (pattern === 'oversold_bounce' && i >= days - 3) ? 3 : 1;
    volumes.push(Math.round(volBase * volSpike * (0.8 + rand() * 0.4)));
  }
  return { closes, highs, lows, volumes };
}

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ PASS:', msg);
}

console.log('=== 시나리오 1: 과매도 반등주 (이상적인 매수 후보) ===');
const s1 = genSeries({ pattern: 'oversold_bounce' });
const r1 = scoreStock(s1);
console.log(JSON.stringify(r1, null, 2));
assert(r1 !== null, '데이터 충분하면 null 아님');
assert(r1.score >= 50, `과매도 반등주는 50점 이상이어야 함 (실제: ${r1.score})`);
assert(r1.signals.some(s => s.label.includes('과매도') || s.label.includes('급증')), '과매도/거래량 신호가 포함되어야 함');

console.log('\n=== 시나리오 2: 지속 급등(과열)주 — 추격매수 위험 ===');
const s2 = genSeries({ pattern: 'overheated' });
const r2 = scoreStock(s2);
console.log(JSON.stringify(r2, null, 2));
assert(r2 !== null, '데이터 충분하면 null 아님');
assert(r2.rsi > 65, `과열주는 RSI 높아야 함 (실제: ${r2.rsi})`);

console.log('\n=== 시나리오 3: 완만한 꾸준 상승주 (정배열 기대) ===');
const s3 = genSeries({ pattern: 'steady_uptrend' });
const r3 = scoreStock(s3);
console.log(JSON.stringify(r3, null, 2));
assert(r3 !== null, '데이터 충분하면 null 아님');
assert(r3.score >= 55, `꾸준 상승주는 55점 이상 기대 (실제: ${r3.score})`);

console.log('\n=== 시나리오 4: 횡보주 (특별한 신호 없음) ===');
const s4 = genSeries({ pattern: 'flat' });
const r4 = scoreStock(s4);
console.log(JSON.stringify(r4, null, 2));
assert(r4 !== null, '데이터 충분하면 null 아님');

console.log('\n=== 시나리오 5: 데이터 부족 (상장 30일 미만) ===');
const s5 = genSeries({ days: 30, pattern: 'flat' });
const r5 = scoreStock(s5);
assert(r5 === null, '60일 미만 데이터는 null 반환해야 함 (실제: ' + JSON.stringify(r5) + ')');

console.log('\n=== 시나리오 6: 점수 순위 검증 (과매도반등 > 횡보) ===');
assert(r1.score > r4.score, `과매도 반등주(${r1.score}) > 횡보주(${r4.score}) 이어야 함`);

console.log('\n=== 지표 단위 테스트 ===');
const testCloses = [10,10,10,10,10,10,10,10,10,10,10,10,10,10,11,12,13,14,15];
const testRsi = rsi(testCloses, 14);
assert(testRsi > 90, `전부 상승하면 RSI는 90 이상이어야 함 (실제: ${testRsi})`);

const dropCloses = [20,19,18,17,16,15,14,13,12,11,10,9,8,7,6];
const dropRsi = rsi(dropCloses, 14);
assert(dropRsi < 10, `전부 하락하면 RSI는 10 이하여야 함 (실제: ${dropRsi})`);

console.log('\n전체 테스트 완료.');
