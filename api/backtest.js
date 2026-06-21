// api/backtest.js
// Vercel Serverless Function: GET /api/backtest?market=KOSPI&sector=반도체&minScore=60&horizonDays=10
//
// 과거 1년치 데이터를 가져와, "그 기간 동안 매 5일마다 이 스코어링 로직을 돌렸다면
// 실제로 얼마나 자주 맞았는가"를 검증한다.
//
// 주의: 백테스트는 스코어링 1회가 아니라 종목당 수십 번 반복 계산이라 훨씬 무겁다.
// 따라서 /api/screen보다 훨씬 적은 종목 수(기본 12개, 최대 20개)로 제한한다.

const { getUniverse } = require('../data/universe');
const { fetchBatch, toYFTicker } = require('../lib/yahoo');
const { backtestSingleStock, aggregateBacktests } = require('../lib/backtest');
const { checkRateLimit, cleanupStaleBuckets, getClientIp } = require('../lib/rateLimit');

const MAX_STOCKS = 20; // 백테스트는 무거우므로 /api/screen(최대 50)보다 훨씬 보수적으로 제한
const DEFAULT_STOCKS = 12;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET만 지원합니다' });

  cleanupStaleBuckets();
  const clientIp = getClientIp(req);
  const rl = checkRateLimit(clientIp, 'backtest');
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
    return res.status(429).json({ error: '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.', retryAfterMs: rl.retryAfterMs });
  }

  const market = (req.query.market || 'KR_ALL').toUpperCase();
  const sector = req.query.sector || null;
  const minScore = Math.min(90, Math.max(0, parseInt(req.query.minScore, 10) || 60));
  const horizonDays = Math.min(20, Math.max(3, parseInt(req.query.horizonDays, 10) || 10));
  const stockCount = Math.min(MAX_STOCKS, Math.max(1, parseInt(req.query.count, 10) || DEFAULT_STOCKS));

  const universe = getUniverse(market);
  if (!universe) {
    return res.status(400).json({ error: `알 수 없는 시장 구분: ${market}` });
  }
  const filtered = (sector ? universe.filter(s => s.sector === sector) : universe).slice(0, stockCount);
  if (!filtered.length) {
    return res.status(200).json({ market, sector, error: '해당 조건에 종목이 없습니다', perStock: [], stats: null });
  }

  const tickers = filtered.map(s => toYFTicker(s.code, s.market));

  let fetchResults;
  try {
    // 백테스트는 1년치 데이터가 필요 (range=6mo였던 screen.js와 다름)
    // 시간 예산: screen.js와 동일하게 Vercel Hobby(무료) 플랜의 10초 강제 제한을 고려해
    // 6초로 보수적으로 잡는다. 백테스트는 fetch 이후 scoreStock을 수십~수백 회 반복 계산하므로
    // (실측상 계산 자체는 수십 ms로 빠르지만) JSON 직렬화·HTTP 오버헤드까지 고려해 여유를 더 둔다.
    fetchResults = await fetchBatch(tickers, { concurrency: 10, range: '1y', timeBudgetMs: 6000 });
  } catch (e) {
    return res.status(502).json({ error: 'Yahoo Finance 호출 실패: ' + e.message });
  }

  const perStock = [];
  const failed = [];
  const backtestResults = [];

  for (let i = 0; i < filtered.length; i++) {
    const meta = filtered[i];
    const fr = fetchResults[i];
    if (!fr || !fr.ok) {
      failed.push({ code: meta.code, name: meta.name, reason: fr ? fr.error : '응답 없음' });
      continue;
    }
    if (fr.closes.length < 100) {
      // 백테스트는 최소 60일(스코어링 워밍업) + horizonDays + 여유분이 필요.
      // 1년치를 요청했는데 100일 미만이면 신규상장 등으로 의미있는 백테스트가 어려움.
      failed.push({ code: meta.code, name: meta.name, reason: `백테스트에 데이터 부족 (${fr.closes.length}일)` });
      continue;
    }

    const series = { closes: fr.closes, highs: fr.highs, lows: fr.lows, volumes: fr.volumes };
    // stepDays를 horizonDays와 동일하게 맞춘다 — 인접 표본의 "N일 후 결과" 측정 구간이
    // 겹치지 않게 하기 위함이다 (자기상관/표본 중복 카운트 방지).
    // 예: horizonDays=10인데 stepDays=5로 하면 표본1(1/1~1/15)과 표본2(1/6~1/20)가
    // 50% 겹쳐서 사실상 같은 시장 구간을 두 번 세는 셈이 되어 표본 수가 부풀려진다.
    // 트레이드오프: 표본 수가 줄어들지만(중첩 제거 우선), 통계적으로 더 정직한 결과를 준다.
    const result = backtestSingleStock(series, { minScore, horizonDays, stepDays: horizonDays });
    backtestResults.push(result);

    perStock.push({
      code: meta.code,
      name: meta.name,
      market: meta.market,
      sector: meta.sector,
      historyDays: fr.closes.length,
      stats: result.stats,
    });
  }

  const combinedStats = aggregateBacktests(backtestResults);
  const timedOutCount = failed.filter(f => f.reason === '시간 예산 초과로 조회 생략').length;

  res.status(200).json({
    market,
    sector,
    minScore,
    horizonDays,
    requestedStocks: filtered.length,
    succeeded: perStock.length,
    failed: failed.length,
    failedDetail: failed.slice(0, 10),
    partial_scan: timedOutCount > 0,
    skipped_due_to_timeout: timedOutCount,
    generated_at: new Date().toISOString(),
    overallStats: combinedStats,
    perStock,
    interpretation: buildInterpretation(combinedStats, minScore, horizonDays),
  });
};

function buildInterpretation(stats, minScore, horizonDays) {
  if (!stats || stats.selectedSamples === 0) {
    return '이 조건으로 과거에 선정된 표본이 충분하지 않아 신뢰할 만한 통계를 낼 수 없습니다.';
  }
  if (stats.selectedSamples < 20) {
    return `선정된 표본이 ${stats.selectedSamples}개로 적어 통계적 신뢰도가 낮습니다. 참고용으로만 보세요.`;
  }
  const gap = (stats.avgPredictedProb ?? 0) - stats.actualUpRate;
  let gapNote;
  if (Math.abs(gap) <= 5) {
    gapNote = '도구가 표시하는 예상 확률과 실제 결과가 비교적 근접합니다.';
  } else if (gap > 5) {
    gapNote = `도구가 표시하는 예상 확률(${stats.avgPredictedProb}%)이 실제 적중률(${stats.actualUpRate}%)보다 ${gap.toFixed(1)}%p 높게 나왔습니다 — 화면의 확률을 액면 그대로 믿지 마세요.`;
  } else {
    gapNote = `실제 적중률(${stats.actualUpRate}%)이 도구의 예상 확률(${stats.avgPredictedProb}%)보다 높게 나왔습니다. 다만 이는 우연일 수 있으니 더 많은 기간으로 재검증이 필요합니다.`;
  }
  return `점수 ${minScore}점 이상으로 선정된 과거 표본 ${stats.selectedSamples}개 중 실제로 ${horizonDays}영업일 후 상승한 비율은 ${stats.actualUpRate}%였습니다. ${gapNote}`;
}
