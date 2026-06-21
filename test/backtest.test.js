// test/backtest.test.js
const { scoreAsOf, backtestSingleStock, computeStats, aggregateBacktests } = require('../lib/backtest');

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

function genSeries(seed, days, drift = 0) {
  const rand = mulberry32(seed);
  const closes = [], highs = [], lows = [], volumes = [];
  let p = 50000;
  for (let i = 0; i < days; i++) {
    p *= (1 + drift + (rand() - 0.5) * 0.01);
    if (p < 100) p = 100;
    closes.push(p); highs.push(p * 1.01); lows.push(p * 0.99);
    volumes.push(Math.round(100000 + rand() * 50000));
  }
  return { closes, highs, lows, volumes };
}

console.log('=== 테스트 1: lookahead bias 없는지 검증 ===');
// 핵심 검증: scoreAsOf(series, 70)의 결과가, series를 70번째 인덱스까지 자른 별도 시계열에
// scoreStock을 직접 돌린 것과 완전히 동일해야 한다 (즉 70번째 이후 데이터를 절대 보지 않았다는 증거)
const { scoreStock } = require('../lib/scoring');
const fullSeries = genSeries(1, 150, 0.001);
const asOfResult = scoreAsOf(fullSeries, 70);
const truncatedSeries = {
  closes: fullSeries.closes.slice(0, 71),
  highs: fullSeries.highs.slice(0, 71),
  lows: fullSeries.lows.slice(0, 71),
  volumes: fullSeries.volumes.slice(0, 71),
};
const directResult = scoreStock(truncatedSeries);
assert(JSON.stringify(asOfResult) === JSON.stringify(directResult),
  'scoreAsOf(series, 70)은 70번째까지 자른 시계열의 scoreStock()과 완전히 동일해야 함 (lookahead 없음 증명)');

// 추가 검증: 70번째 이후 데이터를 완전히 다른 값으로 바꿔도 scoreAsOf(70)의 결과가 안 바뀌어야 함
const tamperedSeries = JSON.parse(JSON.stringify(fullSeries));
for (let i = 71; i < tamperedSeries.closes.length; i++) {
  tamperedSeries.closes[i] = 999999; // 미래 데이터를 극단적으로 조작
}
const asOfResultAfterTamper = scoreAsOf(tamperedSeries, 70);
assert(JSON.stringify(asOfResult) === JSON.stringify(asOfResultAfterTamper),
  '미래(71번째 이후) 데이터를 조작해도 scoreAsOf(70)의 결과는 절대 바뀌면 안 됨 (lookahead 없음 재증명)');

console.log('\n=== 테스트 2: 확실한 상승 패턴 → 백테스트가 높은 적중률을 보여야 함 ===');
// 매 구간 강한 상승 추세를 가진 합성 데이터: 이런 종목만 모아놓으면 selected된 표본들의
// actualUpRate가 높게 나오는 게 "당연한 정답"이어야 한다. 안 그러면 엔진 버그.
const uptrendSeries = genSeries(2, 200, 0.012); // 매일 평균 +1.2% 우상향
const uptrendResult = backtestSingleStock(uptrendSeries, { minScore: 50, horizonDays: 10, stepDays: 5 });
console.log('상승추세 종목 통계:', uptrendResult.stats);
assert(uptrendResult.stats.selectedSamples > 0, '상승추세에서는 선정되는 표본이 있어야 함');
assert(uptrendResult.stats.actualUpRate > 60, `강한 상승추세에서는 적중률이 높아야 함 (실제: ${uptrendResult.stats.actualUpRate}%)`);
assert(uptrendResult.stats.avgReturnIfSelected > 0, '선정된 표본들의 평균 수익률은 양수여야 함');

console.log('\n=== 테스트 3: 확실한 하락 패턴 → 백테스트가 낮은 적중률을 보여야 함 ===');
const downtrendSeries = genSeries(3, 200, -0.012);
const downtrendResult = backtestSingleStock(downtrendSeries, { minScore: 50, horizonDays: 10, stepDays: 5 });
console.log('하락추세 종목 통계:', downtrendResult.stats);
if (downtrendResult.stats.selectedSamples > 0) {
  assert(downtrendResult.stats.actualUpRate < 50, `하락추세에서 선정된 표본이 있다면 적중률이 낮아야 함 (실제: ${downtrendResult.stats.actualUpRate}%)`);
}
// 하락장에서는 애초에 선정(score>=50)되는 경우 자체가 적어야 정상 (스코어링 로직이 하락을 잘 걸러낸다는 뜻)
console.log('하락추세에서 선정 비율:', (downtrendResult.stats.selectedSamples / downtrendResult.stats.totalSamples * 100).toFixed(1) + '%');

console.log('\n=== 테스트 4: 횡보(무작위) 패턴 → 다수 시드 합산시 적중률이 50% 근처로 수렴해야 함 ===');
// 단일 시드만 보면 표본 수가 적어(수십개) 통계적 변동으로 50%에서 꽤 벗어날 수 있다.
// 이건 버그가 아니라 정상적인 표본 변동이므로, 여러 시드를 합쳐 표본을 키워 검증해야
// "스코어링 로직 자체가 무작위 데이터에서 구조적으로 편향되어 있는가"를 제대로 판별할 수 있다.
const flatResults = [];
for (let seed = 100; seed < 130; seed++) {
  const s = genSeries(seed, 300, 0); // drift 0 = 순수 무작위 워크
  flatResults.push(backtestSingleStock(s, { minScore: 50, horizonDays: 10, stepDays: 5 }));
}
const flatCombined = aggregateBacktests(flatResults);
console.log('30개 시드 합산 통계 (총 표본:', flatCombined.totalSamples, '):', flatCombined);
if (flatCombined.selectedSamples >= 30) {
  assert(flatCombined.actualUpRate >= 40 && flatCombined.actualUpRate <= 60,
    `순수 무작위 워크는 표본을 충분히 모으면 적중률이 50% 근처로 수렴해야 함 (실제: ${flatCombined.actualUpRate}%, 표본 ${flatCombined.selectedSamples}개)`);
}
// 단일 시드 결과도 별도로 출력은 해두되, 단일 시드의 변동성 자체가 "왜 백테스트에 표본 수가 중요한지"의 증거가 됨
const singleSeedFlat = backtestSingleStock(genSeries(4, 300, 0), { minScore: 50, horizonDays: 10, stepDays: 5 });
console.log('(참고) 단일 시드 결과:', singleSeedFlat.stats, '— 표본이 적을 때 50%에서 벗어날 수 있음을 보여줌');

console.log('\n=== 테스트 5: 데이터 부족시 빈 결과 처리 ===');
const tinySeries = genSeries(5, 40); // 60일 미만
const tinyResult = backtestSingleStock(tinySeries, { minScore: 50 });
assert(tinyResult.samples.length === 0, '60일 미만 데이터는 표본이 0개여야 함 (에러 throw 아님)');
assert(tinyResult.stats.totalSamples === 0, '빈 표본의 stats도 안전하게 0으로 처리되어야 함');

console.log('\n=== 테스트 6: stepDays가 표본 수를 올바르게 조절하는지 ===');
const series200 = genSeries(6, 200, 0.002);
const fineGrain = backtestSingleStock(series200, { minScore: 50, horizonDays: 10, stepDays: 1 });
const coarseGrain = backtestSingleStock(series200, { minScore: 50, horizonDays: 10, stepDays: 10 });
console.log('stepDays=1 표본수:', fineGrain.samples.length, '/ stepDays=10 표본수:', coarseGrain.samples.length);
assert(fineGrain.samples.length > coarseGrain.samples.length, 'stepDays가 작을수록 표본이 더 많아야 함');

console.log('\n=== 테스트 7: 여러 종목 합산(aggregateBacktests) ===');
const multi = [uptrendResult, downtrendResult, singleSeedFlat];
const combined = aggregateBacktests(multi);
console.log('합산 통계:', combined);
const expectedTotal = uptrendResult.samples.length + downtrendResult.samples.length + singleSeedFlat.samples.length;
assert(combined.totalSamples === expectedTotal, `합산 표본수는 개별 합과 같아야 함 (기대: ${expectedTotal}, 실제: ${combined.totalSamples})`);

console.log('\n=== 테스트 8: predictedProb과 실제 환산식이 일치하는지 (단일 진실 공급원 검증) ===');
const { scoreToProb } = require('../lib/probability');
assert(scoreToProb(100) === 80, 'score=100이면 prob=80이어야 함 (40+100/100*40=80)');
assert(scoreToProb(0) === 40, 'score=0이면 prob=40이어야 함');
assert(scoreToProb(70) === 68, 'score=70이면 prob=68이어야 함');

console.log('\n=== 테스트 9: screen.js와 backtest.js가 정확히 같은 모듈을 쓰는지 (중복 정의 재발 방지) ===');
// 핵심 회귀 방지 테스트: 과거에 lib/backtest.js가 scoreToProbLocal이라는 별도 사본을 갖고 있었고,
// 이게 lib/probability.js로 통합되었다. 이 테스트는 두 파일이 같은 함수 "참조"를 쓰는지 확인해서
// 누군가 실수로 다시 사본을 만들어 분기되는 것을 막는다.
const screenSource = require('fs').readFileSync(require('path').join(__dirname, '../api/screen.js'), 'utf-8');
const backtestSource = require('fs').readFileSync(require('path').join(__dirname, '../lib/backtest.js'), 'utf-8');
assert(screenSource.includes("require('../lib/probability')"), 'api/screen.js는 lib/probability.js에서 import해야 함 (자체 정의 금지)');
assert(backtestSource.includes("require('./probability')"), 'lib/backtest.js는 lib/probability.js에서 import해야 함 (자체 정의 금지)');
assert(!screenSource.includes('function scoreToProb('), 'api/screen.js에 scoreToProb 자체 정의가 남아있으면 안 됨');
assert(!backtestSource.match(/function scoreToProb\w*\(/), 'lib/backtest.js에 scoreToProb류 자체 정의가 남아있으면 안 됨');

console.log('\n=== 테스트 10: stepDays=horizonDays로 호출하면 표본 간 결과 측정구간이 겹치지 않는지 ===');
// api/backtest.js의 실제 운영 정책: stepDays를 horizonDays와 동일하게 맞춰서
// 인접 표본의 "N일 후 결과" 측정 구간이 겹치지 않도록 한다 (자기상관/표본 중복 방지).
// 이 테스트는 그 정책이 실제로 중첩 없는 표본을 만드는지 직접 검증한다.
const overlapCheckSeries = genSeries(7, 250, 0.001);
const noOverlapResult = backtestSingleStock(overlapCheckSeries, { minScore: 0, horizonDays: 10, stepDays: 10 }); // minScore:0으로 전부 selected 취급해 표본 확보
const indices = noOverlapResult.samples.map(s => s.asOfIndex);
let hasOverlap = false;
for (let i = 1; i < indices.length; i++) {
  const prevWindowEnd = indices[i-1] + 10; // 이전 표본의 결과 측정 시점
  if (indices[i] < prevWindowEnd) hasOverlap = true; // 다음 표본의 채점 시점이 이전 측정구간 안에 있으면 중첩
}
console.log('표본 asOfIndex들:', indices.slice(0, 5), '... (총', indices.length, '개)');
assert(!hasOverlap, 'stepDays=horizonDays이면 인접 표본의 결과 측정구간이 절대 겹치지 않아야 함');

console.log('\n백테스트 엔진 테스트 완료.');
