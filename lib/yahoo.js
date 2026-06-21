// lib/yahoo.js
// Yahoo Finance v8 chart 엔드포인트 호출 및 파싱.
// 비공식 API라 응답이 깨진 HTML/텍스트로 올 수 있음 — 방어적으로 처리.

const YF_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

function toYFTicker(code, market) {
  const m = (market || '').toUpperCase();
  if (m.includes('KOSPI')) return `${code}.KS`;
  if (m.includes('KOSDAQ')) return `${code}.KQ`;
  return code; // 미국 종목은 그대로
}

/**
 * 단일 종목의 OHLCV 시계열을 가져온다.
 * @returns {object} { ok, ticker, closes, highs, lows, volumes, currency, error }
 */
async function fetchOHLCV(ticker, { range = '6mo', interval = '1d', timeoutMs = 5000 } = {}) {
  const url = `${YF_BASE}${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // User-Agent 없이 호출하면 Yahoo가 차단하는 경우가 많아 브라우저 헤더를 모사
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    clearTimeout(timer);

    const text = await res.text();

    if (!res.ok) {
      return { ok: false, ticker, error: `HTTP ${res.status}` };
    }

    // 방어 코드: Yahoo가 가끔 "Edge: Not Found" 같은 비-JSON 텍스트를 반환함
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      return { ok: false, ticker, error: `비JSON 응답: ${text.slice(0, 60)}` };
    }

    const result = data?.chart?.result?.[0];
    const chartError = data?.chart?.error;
    if (chartError) {
      return { ok: false, ticker, error: chartError.description || 'chart error' };
    }
    if (!result) {
      return { ok: false, ticker, error: 'result 없음 (상장폐지/잘못된 티커 가능성)' };
    }

    const timestamps = result.timestamp;
    const quote = result.indicators?.quote?.[0];
    if (!timestamps || !quote) {
      return { ok: false, ticker, error: '시계열 데이터 없음' };
    }

    // null 값 필터링 (Yahoo는 휴장일/결측치를 null로 채워서 보냄)
    const closes = [], highs = [], lows = [], volumes = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (
        quote.close[i] == null ||
        quote.high[i] == null ||
        quote.low[i] == null ||
        quote.volume[i] == null
      ) continue; // 결측 행 스킵
      closes.push(quote.close[i]);
      highs.push(quote.high[i]);
      lows.push(quote.low[i]);
      volumes.push(quote.volume[i]);
    }

    if (closes.length < 60) {
      return { ok: false, ticker, error: `데이터 부족 (${closes.length}일치만 확보, 60일 필요)` };
    }

    return {
      ok: true,
      ticker,
      closes, highs, lows, volumes,
      currency: result.meta?.currency || null,
      regularMarketPrice: result.meta?.regularMarketPrice ?? closes[closes.length - 1],
      previousClose: result.meta?.previousClose ?? closes[closes.length - 2],
    };
  } catch (e) {
    clearTimeout(timer);
    const msg = e.name === 'AbortError' ? '타임아웃' : e.message;
    return { ok: false, ticker, error: msg };
  }
}

/**
 * 여러 종목을 동시성 제한을 두고 순차/배치 처리.
 * Yahoo가 동시 요청 과다시 차단하는 경향이 있어 배치 크기를 제한.
 *
 * 시간 예산(timeBudgetMs)을 넘기면 남은 종목은 조회를 포기하고
 * 그때까지의 결과만 반환한다 (서버리스 함수 자체 타임아웃으로 요청 전체가
 * 504로 죽는 것을 방지하기 위함 — 부분 결과가 전체 실패보다 낫다).
 */
async function fetchBatch(tickers, { concurrency = 12, timeBudgetMs = 18000, ...opts } = {}) {
  const results = new Array(tickers.length).fill(null);
  const startedAt = Date.now();

  for (let i = 0; i < tickers.length; i += concurrency) {
    if (Date.now() - startedAt > timeBudgetMs) {
      // 남은 종목은 "시간 예산 초과로 스킵"으로 채워서 인덱스 정합성 유지
      for (let j = i; j < tickers.length; j++) {
        results[j] = { ok: false, ticker: tickers[j], error: '시간 예산 초과로 조회 생략' };
      }
      break;
    }
    const batch = tickers.slice(i, i + concurrency);
    const settled = await Promise.all(batch.map(t => fetchOHLCV(t, opts)));
    settled.forEach((r, k) => { results[i + k] = r; });
  }
  return results;
}

module.exports = { toYFTicker, fetchOHLCV, fetchBatch, YF_BASE };
