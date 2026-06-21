// test/ratelimit.test.js
const { checkRateLimit } = require('../lib/rateLimit');

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ PASS:', msg);
}

console.log('=== Rate Limit 테스트 ===');

const ip = '1.2.3.4';
let lastResult;
for (let i = 1; i <= 10; i++) {
  lastResult = checkRateLimit(ip);
  assert(lastResult.allowed === true, `${i}번째 요청은 허용되어야 함 (한도 10)`);
}

console.log('11번째 요청 시도...');
const blocked = checkRateLimit(ip);
assert(blocked.allowed === false, '11번째 요청은 차단되어야 함');
assert(blocked.retryAfterMs > 0, 'retryAfterMs가 양수여야 함');

console.log('\n=== 다른 IP는 별도로 카운트되는지 확인 ===');
const otherIp = '5.6.7.8';
const otherResult = checkRateLimit(otherIp);
assert(otherResult.allowed === true, '다른 IP는 독립적인 한도를 가져야 함');

console.log('\n=== 엔드포인트별 분리 한도 검증 (screen vs backtest) ===');
const { _resetForTests, LIMITS } = require('../lib/rateLimit');
_resetForTests();

const ip2 = '9.9.9.9';
console.log('LIMITS 설정:', LIMITS);
assert(LIMITS.backtest < LIMITS.screen, 'backtest 한도는 screen보다 엄격(낮음)해야 함 — 더 무거운 작업이므로');

// screen 한도(10)를 다 채워도 backtest 카운터는 영향받지 않아야 함
for (let i = 0; i < LIMITS.screen; i++) checkRateLimit(ip2, 'screen');
const screenBlocked = checkRateLimit(ip2, 'screen');
assert(screenBlocked.allowed === false, 'screen 한도를 다 채우면 screen 호출은 막혀야 함');

const backtestStillOk = checkRateLimit(ip2, 'backtest');
assert(backtestStillOk.allowed === true, 'screen이 막혀도 같은 IP의 backtest 호출은 독립적으로 허용되어야 함 (버킷 분리 증명)');

// backtest는 한도가 더 낮으므로 더 빨리 막혀야 함
_resetForTests();
const ip3 = '8.8.8.8';
let backtestBlockedAt = null;
for (let i = 1; i <= LIMITS.backtest + 2; i++) {
  const r = checkRateLimit(ip3, 'backtest');
  if (!r.allowed && backtestBlockedAt === null) backtestBlockedAt = i;
}
console.log('backtest는', backtestBlockedAt, '번째 요청부터 차단됨 (한도:', LIMITS.backtest, ')');
assert(backtestBlockedAt === LIMITS.backtest + 1, `backtest는 ${LIMITS.backtest+1}번째 요청부터 차단되어야 함 (실제: ${backtestBlockedAt})`);

console.log('\nRate limit 테스트 완료.');
