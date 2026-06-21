// lib/scoring.js
const { sma, rsi, macd, volumeRatio, momentum, atrPct } = require('./indicators');

/**
 * 스코어링 가중치/임계값 설정.
 * 매직넘버를 함수 본문에 흩어놓지 않고 여기 모아서, 추후 백테스트로
 * 튜닝할 때 이 객체만 수정하면 되도록 분리했다.
 *
 * 각 카테고리의 점수 배점 합: RSI(25) + 거래량(20) + 이평선(20) + 모멘텀(20) + ATR(15) = 100
 */
const WEIGHTS = {
  rsi: {
    maxScore: 25,
    oversoldThreshold: 35,      // 이하면 "과매도"로 분류
    neutralThreshold: 60,       // 35~60: 중립~상승 전환
    strongThreshold: 70,        // 60~70: 상승 모멘텀
    warmThreshold: 80,          // 70~80: 과열 근접
    // 점수 테이블 (조건 분기 순서와 1:1 대응)
    oversoldRecoveringScore: 25, // 과매도 + 반등 확인
    oversoldNotRecoveringScore: 10, // 과매도지만 반등 미확인 (떨어지는 칼 위험)
    neutralScore: 18,
    strongScore: 14,
    warmScore: 7,
    overboughtScore: 2,
  },
  volume: {
    maxScore: 20,
    surgeThreshold: 2.5,   // 평균 대비 2.5배 이상
    increaseThreshold: 1.5,
    normalThreshold: 1.0,
    surgeScore: 20,
    increaseScore: 14,
    normalScore: 7,
    lowScore: 2,
  },
  movingAverage: {
    maxScore: 20,
    fullAlignScore: 20,   // 5>20>60 정배열
    partialAlignScore: 12, // 5>20만
    aboveMa20Score: 7,
    belowScore: 2,
  },
  momentum: {
    maxScore: 20,
    idealMin: 2, idealMax: 12,     // 견조한 상승 구간
    warmMax: 20,                   // 과열 시작 구간 상한
    consolidationMin: -3, consolidationMax: 2, // 바닥 다지기 구간
    idealScore: 20,
    warmScore: 12,
    consolidationScore: 10,
    overheatedScore: 4,
    decliningScore: 3,
  },
  atr: {
    maxScore: 15,
    idealMin: 1.5, idealMax: 4.5,  // 적정 변동성
    elevatedMax: 7,
    idealScore: 15,
    elevatedScore: 9,
    tooLowScore: 6,
    tooHighScore: 4,
  },
  overheatCap: {
    // RSI가 이 이상이면 다른 지표가 만점이어도 총점에 상한을 건다 (추격매수 위험 반영)
    extremeThreshold: 85,
    extremeCap: 55,
    elevatedThreshold: 80,
    elevatedCap: 65,
  },
  riskReward: {
    stopLossMin: 2.5, stopLossMax: 10, stopLossAtrMultiplier: 1.3,
    ratioMin: 1.3, ratioRange: 1.5, // 손익비는 ratioMin ~ (ratioMin+ratioRange) 사이에서 신호품질에 따라 변동
    targetCapPct: 22,
    qualityWeights: { trend: 0.4, rsi: 0.35, volume: 0.25 }, // 합 1.0
  },
  riskLevel: {
    lowAtrMax: 3, lowRsiMax: 70,
    highAtrMin: 6, highRsiMin: 75,
  },
  minHistoryDays: 60, // 60일선 계산에 필요한 최소 일수
};

/**
 * 종목 하나의 OHLCV 시계열을 받아 점수와 근거를 산출.
 * @param {object} series { closes, highs, lows, volumes } 시간순 오름차순 배열
 * @returns {object|null} 점수/근거/지표값. 데이터 부족시 null.
 */
function scoreStock(series) {
  const { closes, highs, lows, volumes } = series;
  if (!closes || closes.length < WEIGHTS.minHistoryDays) return null;

  const price = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];
  const changePct = ((price - prevClose) / prevClose) * 100;

  const r = rsi(closes, 14);
  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const m = macd(closes);
  const volRatio = volumeRatio(volumes, 20);
  const mom5 = momentum(closes, 5);
  const atr = atrPct(highs, lows, closes, 14);

  if (r === null || ma5 === null || ma20 === null || ma60 === null) return null;

  let score = 0;
  const signals = [];
  const W = WEIGHTS;

  // 1) RSI 반등 신호
  // RSI만으로는 "하락 중인 종목"과 "바닥 찍고 반등한 종목"을 구분 못 하므로
  // 최근 5일 모멘텀(mom5) 방향과 결합해서 판단한다.
  let rsiScore = 0;
  const isRecovering = mom5 !== null && mom5 > 0;
  if (r <= W.rsi.oversoldThreshold) {
    if (isRecovering) {
      rsiScore = W.rsi.oversoldRecoveringScore;
      signals.push({ type: 'tech', label: `RSI ${r.toFixed(1)} 과매도권 반등 시도` });
    } else {
      rsiScore = W.rsi.oversoldNotRecoveringScore;
      signals.push({ type: 'tech', label: `RSI ${r.toFixed(1)} 과매도, 반등 미확인` });
    }
  } else if (r <= W.rsi.neutralThreshold) {
    rsiScore = W.rsi.neutralScore;
    signals.push({ type: 'tech', label: `RSI ${r.toFixed(1)} 중립~상승 전환 구간` });
  } else if (r <= W.rsi.strongThreshold) {
    rsiScore = W.rsi.strongScore;
    signals.push({ type: 'tech', label: `RSI ${r.toFixed(1)} 상승 모멘텀 유지` });
  } else if (r <= W.rsi.warmThreshold) {
    rsiScore = W.rsi.warmScore;
  } else {
    rsiScore = W.rsi.overboughtScore;
  }
  score += rsiScore;

  // 2) 거래량 급증
  let volScore = 0;
  if (volRatio !== null) {
    if (volRatio >= W.volume.surgeThreshold) {
      volScore = W.volume.surgeScore;
      signals.push({ type: 'flow', label: `거래량 평균 대비 ${volRatio.toFixed(1)}배 급증` });
    } else if (volRatio >= W.volume.increaseThreshold) {
      volScore = W.volume.increaseScore;
      signals.push({ type: 'flow', label: `거래량 평균 대비 ${volRatio.toFixed(1)}배 증가` });
    } else if (volRatio >= W.volume.normalThreshold) {
      volScore = W.volume.normalScore;
    } else {
      volScore = W.volume.lowScore;
    }
  }
  score += volScore;

  // 3) 이동평균 정배열
  let maScore = 0;
  if (ma5 > ma20 && ma20 > ma60) {
    maScore = W.movingAverage.fullAlignScore;
    signals.push({ type: 'tech', label: '5/20/60일선 정배열 (상승 추세)' });
  } else if (ma5 > ma20) {
    maScore = W.movingAverage.partialAlignScore;
    signals.push({ type: 'tech', label: '단기 이평선 상향 돌파' });
  } else if (price > ma20) {
    maScore = W.movingAverage.aboveMa20Score;
  } else {
    maScore = W.movingAverage.belowScore;
  }
  score += maScore;

  // 4) 단기 모멘텀 — 너무 과열되지 않은 적당한 상승
  let momScore = 0;
  if (mom5 !== null) {
    if (mom5 >= W.momentum.idealMin && mom5 <= W.momentum.idealMax) {
      momScore = W.momentum.idealScore;
      signals.push({ type: 'theme', label: `최근 5일 +${mom5.toFixed(1)}% 견조한 상승` });
    } else if (mom5 > W.momentum.idealMax && mom5 <= W.momentum.warmMax) {
      momScore = W.momentum.warmScore;
    } else if (mom5 >= W.momentum.consolidationMin && mom5 < W.momentum.idealMin) {
      momScore = W.momentum.consolidationScore;
    } else if (mom5 > W.momentum.warmMax) {
      momScore = W.momentum.overheatedScore;
    } else {
      momScore = W.momentum.decliningScore;
    }
  }
  score += momScore;

  // 5) 변동성 적정성 — ATR이 너무 낮으면 모멘텀 부족, 너무 높으면 리스크 과다
  let atrScore = 0;
  if (atr !== null) {
    if (atr >= W.atr.idealMin && atr <= W.atr.idealMax) {
      atrScore = W.atr.idealScore;
    } else if (atr > W.atr.idealMax && atr <= W.atr.elevatedMax) {
      atrScore = W.atr.elevatedScore;
    } else if (atr < W.atr.idealMin) {
      atrScore = W.atr.tooLowScore;
    } else {
      atrScore = W.atr.tooHighScore;
    }
  }
  score += atrScore;

  // MACD 보조 신호 (signals에만 반영, 점수는 위 5개 항목에 이미 반영됨)
  if (m && m.goldenCross) {
    signals.push({ type: 'tech', label: 'MACD 골든크로스 (매수 신호)' });
  } else if (m && m.histogram !== null && m.histogram > 0) {
    signals.push({ type: 'tech', label: 'MACD 매도세보다 매수세 우위' });
  }
  if (m && m.deadCross) {
    signals.push({ type: 'news', label: 'MACD 데드크로스 — 하락 전환 주의' });
  }

  // ── 과열 캡(cap) ──
  // RSI가 극단적 과매수 영역이면, 다른 지표가 아무리 좋아도
  // "추격매수 위험"이 본질적 리스크이므로 총점에 상한을 건다.
  if (r >= W.overheatCap.extremeThreshold) {
    score = Math.min(score, W.overheatCap.extremeCap);
    signals.push({ type: 'news', label: `RSI ${r.toFixed(1)} 강한 과매수 — 추격매수 주의` });
  } else if (r >= W.overheatCap.elevatedThreshold) {
    score = Math.min(score, W.overheatCap.elevatedCap);
  }

  // ── 목표가/손절가 산정 ──
  // 손절폭은 ATR(변동성)에 비례시키되, 목표폭은 "신호 품질"(정배열+모멘텀+RSI)에 따라
  // 손익비 자체를 가변적으로 조정한다 (신호가 강할수록 더 높은 손익비를 기대할 근거가 있다고 봄).
  const rr = W.riskReward;
  const stopLossPctRaw = atr !== null
    ? Math.min(rr.stopLossMax, Math.max(rr.stopLossMin, atr * rr.stopLossAtrMultiplier))
    : 5;

  const signalQuality = Math.min(1, Math.max(0,
    (maScore / W.movingAverage.maxScore) * rr.qualityWeights.trend +
    (rsiScore / W.rsi.maxScore) * rr.qualityWeights.rsi +
    (volScore / W.volume.maxScore) * rr.qualityWeights.volume
  ));
  const riskRewardRatio = rr.ratioMin + signalQuality * rr.ratioRange;
  const targetUpsidePctRaw = Math.min(rr.targetCapPct, stopLossPctRaw * riskRewardRatio);

  // 리스크 레벨 판정
  let riskLevel = 'medium';
  if (atr !== null) {
    if (atr <= W.riskLevel.lowAtrMax && r < W.riskLevel.lowRsiMax) riskLevel = 'low';
    else if (atr > W.riskLevel.highAtrMin || r > W.riskLevel.highRsiMin) riskLevel = 'high';
  }

  return {
    score: Math.round(score),
    price,
    changePct: +changePct.toFixed(2),
    rsi: +r.toFixed(1),
    ma5: +ma5.toFixed(2),
    ma20: +ma20.toFixed(2),
    ma60: +ma60.toFixed(2),
    volRatio: volRatio !== null ? +volRatio.toFixed(2) : null,
    momentum5d: mom5 !== null ? +mom5.toFixed(2) : null,
    atrPct: atr !== null ? +atr.toFixed(2) : null,
    riskLevel,
    signals,
    targetUpsidePct: +targetUpsidePctRaw.toFixed(1),
    stopLossPct: +stopLossPctRaw.toFixed(1),
    riskRewardRatio: +riskRewardRatio.toFixed(2),
  };
}

module.exports = { scoreStock, WEIGHTS };
