// api/screen.js
// Vercel Serverless Function: GET /api/screen?market=KR_ALL&limit=15
//
// 흐름: 종목 유니버스 선택 → Yahoo Finance 배치 조회 → 스코어링 → 상위 N개 반환
// Claude API 키 불필요. 순수 규칙 기반.

const { getUniverse } = require('../data/universe');
const { fetchBatch, toYFTicker } = require('../lib/yahoo');
const { scoreStock } = require('../lib/scoring');
const { checkRateLimit, cleanupStaleBuckets, getClientIp } = require('../lib/rateLimit');

module.exports = async function handler(req, res) {
  // CORS: 운영시에는 실제 배포 도메인으로 좁히는 것을 강력 권장.
  // 현재는 개발 편의를 위해 '*'로 두되, 아래 rate limit으로 남용 비용을 구조적으로 제한한다.
  // 프로덕션에서는 ALLOWED_ORIGIN 환경변수를 두고 그 값만 허용하도록 바꿀 것.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET만 지원합니다' });

  // ── Rate limiting ──
  // 분산 환경에서 완벽하지 않다는 한계는 lib/rateLimit.js 주석 참고.
  // 그래도 단순 반복 스크립트 남용은 상당 부분 차단된다.
  cleanupStaleBuckets();
  const clientIp = getClientIp(req);
  const rl = checkRateLimit(clientIp);
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
    return res.status(429).json({
      error: '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.',
      retryAfterMs: rl.retryAfterMs,
    });
  }

  const market = (req.query.market || 'KR_ALL').toUpperCase();
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 15));
  const sector = req.query.sector || null; // 선택적 섹터 필터

  const universe = getUniverse(market);
  if (!universe) {
    return res.status(400).json({ error: `알 수 없는 시장 구분: ${market}. 가능한 값: KOSPI, KOSDAQ, KR_ALL, US_ALL, ALL` });
  }

  const filtered = sector ? universe.filter(s => s.sector === sector) : universe;
  if (!filtered.length) {
    return res.status(200).json({
      market, sector, scanned: 0, succeeded: 0, failed: 0,
      generated_at: new Date().toISOString(),
      stocks: [],
      warning: '해당 섹터에 종목이 없습니다',
    });
  }

  const tickers = filtered.map(s => toYFTicker(s.code, s.market));

  // 시간 예산: Vercel Hobby(무료) 플랜은 함수 실행시간이 10초로 강제 고정되며
  // maxDuration 설정값 자체가 무시된다. Pro 플랜(60초 가능) 여부와 무관하게
  // 가장 보수적인 환경(Hobby)에서도 안전하도록 7초로 시간 예산을 잡는다.
  // concurrency=12, 종목당 timeout 5초 기준 → 최악의 경우도 batch 1개(5초) 안에 끝나거나
  // 7초 예산 컷에 걸려 부분 결과라도 반환한다.
  let fetchResults;
  try {
    fetchResults = await fetchBatch(tickers, { concurrency: 12, range: '6mo', timeBudgetMs: 7000 });
  } catch (e) {
    return res.status(502).json({ error: 'Yahoo Finance 호출 실패: ' + e.message });
  }

  const scored = [];
  const failed = [];

  for (let i = 0; i < filtered.length; i++) {
    const meta = filtered[i];
    const fr = fetchResults[i];

    if (!fr || !fr.ok) {
      failed.push({ code: meta.code, name: meta.name, reason: fr ? fr.error : '응답 없음' });
      continue;
    }

    const result = scoreStock({ closes: fr.closes, highs: fr.highs, lows: fr.lows, volumes: fr.volumes });
    if (!result) {
      failed.push({ code: meta.code, name: meta.name, reason: '지표 계산 불가 (데이터 부족)' });
      continue;
    }

    const cp = fr.regularMarketPrice ?? result.price;
    const targetPrice = Math.round(cp * (1 + result.targetUpsidePct / 100));
    const stopLoss = Math.round(cp * (1 - result.stopLossPct / 100));

    scored.push({
      code: meta.code,
      name: meta.name,
      market: meta.market,
      sector: meta.sector,
      currency: fr.currency,
      currentPrice: cp,
      priceChangePct: result.changePct,
      targetPrice,
      targetUpsidePct: result.targetUpsidePct,
      stopLoss,
      stopLossPct: result.stopLossPct,
      riskRewardRatio: result.riskRewardRatio,
      score: result.score,
      riskLevel: result.riskLevel,
      signals: result.signals,
      indicators: {
        rsi: result.rsi,
        ma5: result.ma5,
        ma20: result.ma20,
        ma60: result.ma60,
        volRatio: result.volRatio,
        momentum5d: result.momentum5d,
        atrPct: result.atrPct,
      },
      priceSource: 'live', // 이 시점에 도달했다면 Yahoo Finance에서 정상 수신한 것
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  const avgProb = top.length
    ? Math.round(top.reduce((sum, s) => sum + scoreToProb(s.score), 0) / top.length)
    : 0;

  const timedOutCount = failed.filter(f => f.reason === '시간 예산 초과로 조회 생략').length;

  res.status(200).json({
    market,
    sector,
    scanned: filtered.length,
    succeeded: scored.length,
    failed: failed.length,
    failedDetail: failed.slice(0, 10), // 너무 길어지지 않게 상위 10개만
    partial_scan: timedOutCount > 0, // true면 시간 제한으로 일부 종목을 못 봤다는 뜻
    skipped_due_to_timeout: timedOutCount,
    generated_at: new Date().toISOString(),
    avg_score_to_prob: avgProb,
    stocks: top.map((s, i) => ({ rank: i + 1, prob2w: scoreToProb(s.score), ...s })),
  });
};

/**
 * 0~100 점수를 "2주 내 상승 확률" 추정치로 매핑.
 * 순수 규칙 기반이므로 실제 통계적 확률이 아니라 점수의 직관적 환산값임을 명시.
 * 점수 100 → 약 80%, 점수 0 → 약 40% (완전 무작위 동전던지기보다 약간 낮은 바닥)
 */
function scoreToProb(score) {
  const prob = 40 + (score / 100) * 40;
  return Math.round(Math.min(82, Math.max(40, prob)));
}
