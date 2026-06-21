// test/pipeline.test.js
const { scoreStock } = require('../lib/scoring');

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

function genSeries(seed, days = 90) {
  const rand = mulberry32(seed);
  const closes = [], highs = [], lows = [], volumes = [];
  let price = 10000 + rand() * 90000;
  // 종목마다 무작위 추세를 부여 (실제 시장의 다양성을 모사)
  const trendBias = (rand() - 0.5) * 0.01;
  for (let i = 0; i < days; i++) {
    const noise = (rand() - 0.5) * 0.015;
    price *= (1 + trendBias + noise);
    if (price < 100) price = 100; // 음수 방지
    closes.push(price);
    highs.push(price * 1.01);
    lows.push(price * 0.99);
    volumes.push(Math.round(50000 + rand() * 200000));
  }
  return { closes, highs, lows, volumes };
}

// 가상 유니버스: 정상 종목 40개 + 데이터 부족 5개 + 조회 실패 5개
const universe = [];
for (let i = 0; i < 40; i++) {
  universe.push({ code: `OK${i}`, name: `정상종목${i}`, market: 'KOSPI', sector: '기술/AI', series: genSeries(i + 1) });
}
for (let i = 0; i < 5; i++) {
  universe.push({ code: `NEW${i}`, name: `신규상장${i}`, market: 'KOSDAQ', sector: '바이오', series: genSeries(100 + i, 20) }); // 20일치만
}
for (let i = 0; i < 5; i++) {
  universe.push({ code: `FAIL${i}`, name: `조회실패${i}`, market: 'KOSPI', sector: '금융', series: null }); // fetch 실패 시뮬레이션
}

console.log(`=== 파이프라인 테스트: 유니버스 ${universe.length}개 종목 ===`);

const scored = [];
const failed = [];

for (const stock of universe) {
  if (!stock.series) {
    failed.push({ code: stock.code, reason: '시세 조회 실패' });
    continue;
  }
  const result = scoreStock(stock.series);
  if (!result) {
    failed.push({ code: stock.code, reason: '데이터 부족' });
    continue;
  }
  scored.push({ ...stock, ...result });
}

console.log(`\n성공: ${scored.length}개, 실패: ${failed.length}개`);
console.log('실패 사유 분포:', failed.reduce((acc, f) => {
  acc[f.reason] = (acc[f.reason] || 0) + 1;
  return acc;
}, {}));

assert(scored.length === 40, `정상 종목 40개가 모두 스코어링되어야 함 (실제: ${scored.length})`);
assert(failed.length === 10, `데이터부족5 + 실패5 = 10개가 failed에 들어가야 함 (실제: ${failed.length})`);
assert(failed.filter(f => f.reason === '데이터 부족').length === 5, '데이터부족 5개 검증');
assert(failed.filter(f => f.reason === '시세 조회 실패').length === 5, '조회실패 5개 검증');

// 상위 15개 선정
const top15 = [...scored].sort((a, b) => b.score - a.score).slice(0, 15);

console.log('\n=== 상위 15개 종목 (점수 내림차순) ===');
top15.forEach((s, i) => {
  console.log(`${i + 1}. ${s.name} (${s.code}) — 점수 ${s.score}, RSI ${s.rsi}, 리스크 ${s.riskLevel}`);
});

assert(top15.length === 15, `정확히 15개가 선정되어야 함 (실제: ${top15.length})`);

// 점수가 실제로 내림차순인지 검증
let isDescending = true;
for (let i = 1; i < top15.length; i++) {
  if (top15[i].score > top15[i - 1].score) isDescending = false;
}
assert(isDescending, '상위 15개는 점수 내림차순으로 정렬되어야 함');

// 15등의 점수가 16등(컷오프 밖)보다 높거나 같아야 함
const rest = [...scored].sort((a, b) => b.score - a.score).slice(15);
if (rest.length > 0) {
  assert(top15[14].score >= rest[0].score, '15등 점수가 16등 점수 이상이어야 함 (정렬 정합성)');
}

// 중복 종목 코드 없는지 확인
const codes = new Set(top15.map(s => s.code));
assert(codes.size === 15, '선정된 15개 종목에 중복이 없어야 함');

// 유니버스가 15개 미만으로 성공했을 경우의 엣지 케이스
console.log('\n=== 엣지 케이스: 성공 종목이 15개 미만일 때 ===');
const smallScored = scored.slice(0, 8);
const smallTop = [...smallScored].sort((a, b) => b.score - a.score).slice(0, 15);
assert(smallTop.length === 8, `8개만 있으면 8개만 반환해야 함, 15개로 패딩하면 안 됨 (실제: ${smallTop.length})`);

console.log('\n전체 파이프라인 테스트 완료.');
