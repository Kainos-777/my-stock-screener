// test/macd.test.js
// MACD 골든/데드크로스 감지 로직을 독립적으로 검증.
// (lib/scoring.js의 회귀 테스트와 별개로, MACD 자체의 정확성을 픽스처로 보증한다)

const { macd } = require('../lib/indicators');

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ PASS:', msg);
}

function genAccelDeclineThenReversal(days, declineStart, reversalStart, mildDrift, sharpDrift, reboundDrift) {
  const closes = [];
  let p = 100000;
  for (let i = 0; i < days; i++) {
    let drift;
    if (i < declineStart) drift = mildDrift;
    else if (i < reversalStart) drift = sharpDrift;
    else drift = reboundDrift;
    p *= (1 + drift);
    closes.push(p);
  }
  return closes;
}

console.log('=== MACD 골든크로스: 가속 하락 후 급반등 ===');
const closesUp = genAccelDeclineThenReversal(60, 20, 40, -0.005, -0.02, 0.025);
let goldenAt = null;
for (let len = 35; len <= closesUp.length; len++) {
  const r = macd(closesUp.slice(0, len));
  if (r && r.goldenCross && goldenAt === null) goldenAt = len;
}
console.log('골든크로스 감지 시점:', goldenAt, '(반등 시작:', 40, ')');
assert(goldenAt !== null, '가속 하락 후 급반등 시 골든크로스가 감지되어야 함');
assert(goldenAt !== null && goldenAt >= 40 && goldenAt <= 50, `골든크로스는 반등 시작(40일) 직후 합리적 범위(40~50일) 안에서 잡혀야 함 (실제: ${goldenAt})`);

console.log('\n=== MACD 데드크로스: 가속 상승 후 급하락 ===');
const closesDown = genAccelDeclineThenReversal(60, 20, 40, 0.008, 0.02, -0.025);
let deadAt = null;
for (let len = 35; len <= closesDown.length; len++) {
  const r = macd(closesDown.slice(0, len));
  if (r && r.deadCross && deadAt === null) deadAt = len;
}
console.log('데드크로스 감지 시점:', deadAt, '(하락전환 시작:', 40, ')');
assert(deadAt !== null, '가속 상승 후 급하락 시 데드크로스가 감지되어야 함');
assert(deadAt !== null && deadAt >= 40 && deadAt <= 50, `데드크로스는 하락전환(40일) 직후 합리적 범위(40~50일) 안에서 잡혀야 함 (실제: ${deadAt})`);

console.log('\n=== MACD 오탐 없음: 일정한 추세에서는 크로스가 반복 발생하면 안 됨 ===');
const closesFlat = genAccelDeclineThenReversal(60, 999, 999, 0.003, 0.003, 0.003); // 전체 구간 동일 drift
let crossCount = 0;
for (let len = 35; len <= closesFlat.length; len++) {
  const r = macd(closesFlat.slice(0, len));
  if (r && (r.goldenCross || r.deadCross)) crossCount++;
}
console.log('일정 추세 구간에서 발생한 크로스 횟수:', crossCount);
assert(crossCount <= 1, `일정한 추세에서는 크로스가 거의 없어야 함 (워밍업 직후 1회는 허용, 실제: ${crossCount})`);

console.log('\n=== 데이터 부족시 null 반환 ===');
const shortCloses = Array.from({ length: 30 }, (_, i) => 50000 + i * 10);
const shortResult = macd(shortCloses);
assert(shortResult === null, '35일(26+9) 미만 데이터는 null을 반환해야 함');

console.log('\n=== histogram 부호와 macdLine/signalLine 관계 일관성 ===');
const r = macd(closesUp);
assert(r !== null, '충분한 데이터에서는 정상 반환되어야 함');
const expectedHist = +(r.macdLine - r.signalLine).toFixed(6);
const actualHist = +r.histogram.toFixed(6);
assert(Math.abs(expectedHist - actualHist) < 0.001, `histogram은 정확히 macdLine - signalLine 이어야 함 (기대: ${expectedHist}, 실제: ${actualHist})`);

console.log('\nMACD 테스트 완료.');
