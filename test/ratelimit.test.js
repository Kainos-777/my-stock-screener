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

console.log('\nRate limit 테스트 완료.');
