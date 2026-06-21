// lib/indicators.js
// 순수 함수로 작성된 기술적 지표 계산 라이브러리.
// 입력: closes(종가 배열, 시간순 오름차순), volumes(거래량 배열)
// 외부 의존성 없음 — 단위 테스트로 검증 가능

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  // Wilder's smoothing method (표준 RSI 계산식)
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses += -diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let emaPrev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    emaPrev = values[i] * k + emaPrev * (1 - k);
  }
  return emaPrev;
}

/**
 * ema()와 달리, 전체 EMA 시계열을 한 번의 워밍업으로 계산해 배열로 반환한다.
 * 반환 배열의 인덱스 0은 "values[period-1]" 시점의 EMA에 대응한다.
 *
 * 왜 필요한가: macd()에서 매 길이(end)마다 ema(slice(0,end), period)를 별도로 호출하면
 * 길이가 다를 때마다 워밍업(첫 period개 단순평균)이 매번 다른 시작점에서 새로 일어나
 * 같은 시계열인데도 EMA12/EMA26 간의 상대적 위치가 인위적으로 흔들리는 편향이 생긴다.
 * 한 번만 워밍업하고 그 뒤로는 점진적으로 갱신해야 동일 시계열에 대해 일관된 EMA가 나온다.
 */
function emaSeries(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let emaPrev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(emaPrev);
  for (let i = period; i < values.length; i++) {
    emaPrev = values[i] * k + emaPrev * (1 - k);
    out.push(emaPrev);
  }
  return out; // out[0] = values[0..period-1] 평균, out[i] = values[period-1+i] 시점의 EMA
}

function macd(closes) {
  if (closes.length < 26 + 9) return null; // signal line 계산까지 하려면 26+9일치 필요

  // 핵심 수정: EMA12/EMA26을 "한 번씩만" 전체 시계열에 대해 계산한다.
  // (이전 버그: 길이를 늘려가며 매번 ema()를 새로 호출해 워밍업 시작점이 흔들렸음)
  const ema12Series = emaSeries(closes, 12); // ema12Series[i] = closes[11+i] 시점의 EMA12
  const ema26Series = emaSeries(closes, 26); // ema26Series[i] = closes[25+i] 시점의 EMA26
  if (!ema12Series.length || !ema26Series.length) return null;

  // 두 시계열의 길이를 맞춘다: ema26Series가 항상 더 짧게 시작하므로(26>12)
  // ema12Series 쪽에서 앞부분을 잘라 같은 날짜 인덱스로 정렬한다.
  const offset = 26 - 12; // ema12가 ema26보다 14일 먼저 시작함
  const alignedEma12 = ema12Series.slice(offset);
  const len = Math.min(alignedEma12.length, ema26Series.length);
  const macdSeries = [];
  for (let i = 0; i < len; i++) {
    macdSeries.push(alignedEma12[i] - ema26Series[i]);
  }

  if (macdSeries.length < 9) return null;

  const signalSeries = emaSeries(macdSeries, 9);
  if (signalSeries.length < 2) return null;

  const macdLine = macdSeries[macdSeries.length - 1];
  const prevMacdLine = macdSeries[macdSeries.length - 2];
  const signalLine = signalSeries[signalSeries.length - 1];
  const prevSignalLine = signalSeries[signalSeries.length - 2];

  const histogram = macdLine - signalLine;
  const prevHistogram = prevMacdLine - prevSignalLine;

  const goldenCross = prevHistogram <= 0 && histogram > 0;
  const deadCross = prevHistogram >= 0 && histogram < 0;

  return { macdLine, signalLine, histogram, goldenCross, deadCross };
}

function volumeRatio(volumes, period = 20) {
  if (volumes.length < period + 1) return null;
  const recent = volumes[volumes.length - 1];
  const avgPrev = sma(volumes.slice(-period - 1, -1), period);
  if (!avgPrev) return null;
  return recent / avgPrev;
}

function momentum(closes, days = 5) {
  if (closes.length < days + 1) return null;
  const past = closes[closes.length - 1 - days];
  const now = closes[closes.length - 1];
  return (now - past) / past * 100;
}

function atrPct(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return null;
  let trs = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
  }
  const atr = trs.reduce((a, b) => a + b, 0) / period;
  return (atr / closes[closes.length - 1]) * 100;
}

module.exports = { sma, rsi, ema, emaSeries, macd, volumeRatio, momentum, atrPct };
