// lib/rateLimit.js
//
// ⚠️ 한계 공개: 이것은 "완벽한" rate limiter가 아니다.
// Vercel 서버리스 함수는 인스턴스가 여러 개로 분산 실행되고, 콜드 스타트마다
// 메모리가 초기화되므로 이 인메모리 카운터는 "같은 웜 인스턴스에 도달한 요청"만 제한한다.
// 즉 분산 환경에서는 우회 가능하다. 완전한 보호가 필요하면 Vercel KV/Upstash Redis 같은
// 외부 저장소를 붙여야 한다. 다만 이것만으로도 단순 스크립트형 남용(짧은 시간 반복 호출)은
// 상당 부분 막을 수 있어, "아예 없는 것보다는 훨씬 낫다"는 절충안으로 추가한다.

const buckets = new Map(); // key: `${endpoint}:${ip}`, value: { count, windowStart }

const WINDOW_MS = 60 * 1000; // 1분 윈도우

// 엔드포인트별로 한도를 분리한다. /api/screen은 가볍지만(종목당 점수 1회 계산),
// /api/backtest는 종목당 수십 회 반복 계산 + 1년치 데이터 조회로 훨씬 무겁기 때문에
// 같은 한도를 공유하면 백테스트 쪽 실질 남용 방지 효과가 약해진다 (가벼운 호출 기준으로 맞춰진 한도라서).
const LIMITS = {
  screen: 10,    // 분당 10회
  backtest: 4,   // 분당 4회 — 훨씬 무거운 작업이므로 더 엄격하게
  default: 10,
};

function checkRateLimit(ip, endpoint = 'default') {
  const max = LIMITS[endpoint] ?? LIMITS.default;
  const key = `${endpoint}:${ip}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: max - 1 };
  }

  if (bucket.count >= max) {
    const retryAfterMs = WINDOW_MS - (now - bucket.windowStart);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  bucket.count++;
  return { allowed: true, remaining: max - bucket.count };
}

// 메모리 누수 방지: 오래된 버킷 주기적 정리 (간단한 GC)
function cleanupStaleBuckets() {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.windowStart > WINDOW_MS * 2) buckets.delete(key);
  }
}

function getClientIp(req) {
  // Vercel은 x-forwarded-for 헤더에 실제 클라이언트 IP를 넣어줌
  const xff = req.headers?.['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  const direct = req.socket?.remoteAddress || req.connection?.remoteAddress;
  if (direct) return direct;
  // 이 경로에 도달하면(IP를 전혀 식별 못함) 요청마다 별도 키를 줘서
  // 서로 다른 사용자들이 의도치 않게 같은 버킷을 공유하는 것을 방지한다.
  // (완벽하진 않지만 "전원이 한 버킷 공유"보다는 안전한 폴백)
  return `unidentified-${Math.random().toString(36).slice(2, 10)}`;
}

// 테스트 전용: 메모리 상태를 초기화해 테스트 간 rate-limit 상태가 누적되는 것을 방지.
// 프로덕션 코드 경로에서는 호출되지 않음.
function _resetForTests() {
  buckets.clear();
}

module.exports = { checkRateLimit, cleanupStaleBuckets, getClientIp, WINDOW_MS, LIMITS, _resetForTests };
