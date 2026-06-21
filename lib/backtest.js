// lib/backtest.js
//
// 백테스트 엔진: "과거 특정 시점에 이 스코어링 로직을 돌렸다면,
// 실제로 2주 후 얼마나 올랐을까?"를 검증한다.
//
// 핵심 원칙(데이터 누출 방지): 시점 T에서 점수를 계산할 때는
// T 이전 데이터만 사용해야 한다. T 이후 데이터를 슬쩍 보고 점수를 매기면
// "미래를 알고 채점한" 것이라 결과가 실제보다 좋게 나오는 착시(lookahead bias)가 생긴다.
// 이 파일의 모든 함수는 이 원칙을 지키도록 설계했다.

const { scoreStock } = require('./scoring');
const { scoreToProb } = require('./probability');

/**
 * 전체 과거 시계열(closes 등)에서, "마치 그 날짜까지만 데이터가 있었던 것처럼"
 * 잘라낸 부분 시계열에 대해 점수를 계산한다.
 *
 * @param {object} fullSeries { closes, highs, lows, volumes } (시간순 오름차순, 전체 기간)
 * @param {number} asOfIndex  이 인덱스까지의 데이터만 사용 (asOfIndex번째 날이 "현재")
 * @returns {object|null} scoreStock()과 동일한 형태, 데이터 부족시 null
 */
function scoreAsOf(fullSeries, asOfIndex) {
  const { closes, highs, lows, volumes } = fullSeries;
  if (asOfIndex < 0 || asOfIndex >= closes.length) return null;

  // asOfIndex번째 날까지만 슬라이스 — 이후 데이터는 절대 보지 않음 (lookahead 방지)
  const slice = {
    closes: closes.slice(0, asOfIndex + 1),
    highs: highs.slice(0, asOfIndex + 1),
    lows: lows.slice(0, asOfIndex + 1),
    volumes: volumes.slice(0, asOfIndex + 1),
  };
  return scoreStock(slice);
}

/**
 * 단일 종목에 대해, 과거 전체 기간을 훑으며 일정 간격마다 "그 시점에 점수를 매겼다면
 * 어땠을지"를 계산하고, 실제 horizonDays 뒤의 결과(올랐는지, 얼마나)와 비교한다.
 *
 * @param {object} fullSeries 전체 과거 시계열
 * @param {object} opts
 *   minHistory: 점수 계산에 필요한 최소 과거 일수 (scoring.js의 minHistoryDays와 동일해야 함, 기본 60)
 *   horizonDays: 결과를 확인할 미래 시점 (기본 10 — 영업일 기준 약 2주)
 *   stepDays: 매 며칠마다 한 번씩 채점할지 (기본 5 — 매일 다 하면 샘플이 너무 겹쳐서 사실상 같은 구간 중복 카운트됨)
 *   minScore: 이 점수 이상인 경우만 "선정되었다"고 간주 (기본 60 — 실제 서비스의 상위권 컷과 유사하게)
 * @returns {object} { samples: [...], stats: {...} }
 */
function backtestSingleStock(fullSeries, opts = {}) {
  const {
    minHistory = 60,
    horizonDays = 10,
    stepDays = 5,
    minScore = 60,
  } = opts;

  const { closes } = fullSeries;
  const samples = [];

  // asOfIndex가 minHistory-1 이상이어야 scoreStock이 동작하고,
  // closes.length - 1 - horizonDays 이하여야 "미래 결과"를 확인할 데이터가 존재함
  const lastUsableIndex = closes.length - 1 - horizonDays;

  for (let asOfIndex = minHistory - 1; asOfIndex <= lastUsableIndex; asOfIndex += stepDays) {
    const result = scoreAsOf(fullSeries, asOfIndex);
    if (!result) continue;

    const priceAtScoring = closes[asOfIndex];
    const priceAfterHorizon = closes[asOfIndex + horizonDays];
    const actualReturnPct = ((priceAfterHorizon - priceAtScoring) / priceAtScoring) * 100;

    samples.push({
      asOfIndex,
      score: result.score,
      selected: result.score >= minScore, // 이 시뮬레이션에서 "선정"되었다고 볼지 여부
      priceAtScoring: +priceAtScoring.toFixed(2),
      priceAfterHorizon: +priceAfterHorizon.toFixed(2),
      actualReturnPct: +actualReturnPct.toFixed(2),
      wentUp: actualReturnPct > 0,
      predictedProb: result.score >= minScore ? scoreToProb(result.score) : null,
    });
  }

  return { samples, stats: computeStats(samples) };
}

/**
 * 표본들로부터 통계를 산출.
 * "선정된 표본"(score >= minScore)만 따로 떼서 실제 상승 비율을 계산하는 것이 핵심 —
 * 이게 바로 "이 도구가 선정한 종목이 실제로 얼마나 자주 맞았는가"에 대한 답.
 */
function computeStats(samples) {
  if (samples.length === 0) {
    return { totalSamples: 0, selectedSamples: 0, actualUpRate: null, avgReturnIfSelected: null, avgReturnAll: null };
  }

  const selected = samples.filter(s => s.selected);
  const avgReturnAll = average(samples.map(s => s.actualReturnPct));

  if (selected.length === 0) {
    return {
      totalSamples: samples.length,
      selectedSamples: 0,
      actualUpRate: null,
      avgReturnIfSelected: null,
      avgReturnAll: +avgReturnAll.toFixed(2),
    };
  }

  const upCount = selected.filter(s => s.wentUp).length;
  const actualUpRate = (upCount / selected.length) * 100;
  const avgReturnIfSelected = average(selected.map(s => s.actualReturnPct));
  const avgPredictedProb = average(selected.map(s => s.predictedProb));

  return {
    totalSamples: samples.length,
    selectedSamples: selected.length,
    actualUpRate: +actualUpRate.toFixed(1),       // 실제로 올랐던 비율 (%)
    avgPredictedProb: +avgPredictedProb.toFixed(1), // 도구가 예측했던 평균 확률 (%) — 이 둘의 차이가 핵심 검증 포인트
    avgReturnIfSelected: +avgReturnIfSelected.toFixed(2), // 선정된 것들의 평균 실제 수익률
    avgReturnAll: +avgReturnAll.toFixed(2),         // 선정 여부 무관, 전체 평균 수익률 (비교 기준선)
  };
}

function average(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * 여러 종목의 백테스트 결과를 합산해 종합 통계를 낸다.
 */
function aggregateBacktests(perStockResults) {
  const allSamples = perStockResults.flatMap(r => r.samples);
  return computeStats(allSamples);
}

module.exports = { scoreAsOf, backtestSingleStock, computeStats, aggregateBacktests };
