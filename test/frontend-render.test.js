// test/frontend-render.test.js
// public/index.html의 render()/sortCards() 로직을 jsdom으로 실제 실행해서
// api/screen.js가 만든 실제 형태의 JSON이 화면에 올바르게 그려지는지 검증.

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ PASS:', msg);
}

// --- 1) api/screen.js를 모킹 fetch로 실제 호출해서 "진짜" 응답 JSON을 만든다 ---
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function genGoodPayload(seed, days = 95) {
  const rand = mulberry32(seed);
  const timestamp = [], close = [], high = [], low = [], volume = [];
  let p = 10000 + rand() * 90000;
  const bias = (rand() - 0.5) * 0.01;
  for (let i = 0; i < days; i++) {
    p *= (1 + bias + (rand() - 0.5) * 0.015);
    if (p < 100) p = 100;
    timestamp.push(1700000000 + i * 86400);
    close.push(p); high.push(p * 1.01); low.push(p * 0.99);
    volume.push(Math.round(50000 + rand() * 200000));
  }
  return { chart: { result: [{ meta: { currency: 'KRW', regularMarketPrice: p, previousClose: close[close.length - 2] }, timestamp, indicators: { quote: [{ close, high, low, volume }] } }], error: null } };
}
global.fetch = async (url) => {
  const tickerMatch = decodeURIComponent(url).match(/chart\/([^?]+)\?/);
  const ticker = tickerMatch ? tickerMatch[1] : 'UNKNOWN';
  const seed = ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return { ok: true, status: 200, text: async () => JSON.stringify(genGoodPayload(seed)) };
};

const screenHandler = require('../api/screen');
const { _resetForTests } = require('../lib/rateLimit');
_resetForTests();

function createMockReqRes(query) {
  const req = { method: 'GET', query };
  let statusCode = 200, jsonBody = null;
  const res = { setHeader: () => {}, status(c){statusCode=c;return this;}, json(b){jsonBody=b;return this;}, end(){return this;} };
  return { req, res, getBody: () => jsonBody, getStatus: () => statusCode };
}

(async () => {
  const t = createMockReqRes({ market: 'KOSPI', limit: '15' });
  await screenHandler(t.req, t.res);
  const apiResponse = t.getBody();
  console.log('=== 실제 api/screen.js 응답을 프론트엔드에 주입 ===');
  console.log('응답 종목 수:', apiResponse.stocks.length);
  assert(apiResponse.stocks.length === 15, 'API가 15개 종목을 반환해야 함');

  // --- 2) public/index.html을 jsdom으로 로드 ---
  const htmlPath = path.join(__dirname, '../public/index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/' });
  const { window } = dom;

  // jsdom 환경에서 script 태그가 동기 실행되도록 약간 대기
  await new Promise(r => setTimeout(r, 100));

  assert(typeof window.render === 'function', 'render 함수가 전역에 노출되어 있어야 함');
  assert(typeof window.sortCards === 'function', 'sortCards 함수가 전역에 노출되어 있어야 함');
  assert(typeof window.tog === 'function', 'tog 함수가 전역에 노출되어 있어야 함');

  // --- 3) render()를 실제 API 응답으로 호출 ---
  window.render(apiResponse);

  const doc = window.document;
  const cards = doc.querySelectorAll('.card');
  console.log('렌더링된 카드 수:', cards.length);
  assert(cards.length === 15, `15개 카드가 DOM에 렌더링되어야 함 (실제: ${cards.length})`);

  // 첫 카드의 내용이 1위 종목과 일치하는지
  const firstCard = cards[0];
  const firstName = firstCard.querySelector('.sname').textContent;
  assert(firstName === apiResponse.stocks[0].name, `1번 카드 이름이 1위 종목과 일치해야 함 (기대: ${apiResponse.stocks[0].name}, 실제: ${firstName})`);

  // rank 뱃지 확인
  const firstRank = firstCard.querySelector('.rbadge').textContent.trim();
  assert(firstRank === '1', `첫 카드 순위 뱃지는 1이어야 함 (실제: ${firstRank})`);

  // 가격 포맷팅 확인 (한국 종목이므로 '원' 포함되어야 함)
  const priceText = firstCard.querySelector('.cprice .pval').textContent;
  console.log('가격 표시:', priceText);
  assert(priceText.includes('원'), `한국 종목은 가격에 "원"이 포함되어야 함 (실제: ${priceText})`);

  // 신호 태그가 실제로 렌더링되는지 (signals 배열이 있는 카드 확인)
  const cardsWithSignals = apiResponse.stocks.filter(s => s.signals && s.signals.length > 0);
  if (cardsWithSignals.length > 0) {
    const sigEls = doc.querySelectorAll('.sig');
    assert(sigEls.length > 0, '신호 태그(.sig)가 최소 1개 이상 렌더링되어야 함');
  }

  // --- 4) 상세 토글 동작 확인 ---
  const detailBefore = doc.getElementById('det0').classList.contains('open');
  window.tog(0);
  const detailAfter = doc.getElementById('det0').classList.contains('open');
  assert(detailBefore === false && detailAfter === true, 'tog(0) 호출시 상세 영역이 열려야 함');
  window.tog(0);
  assert(doc.getElementById('det0').classList.contains('open') === false, '다시 tog(0) 호출시 닫혀야 함');

  // 상세 영역에 RSI 등 지표값이 실제로 표시되는지
  window.tog(0);
  const indVals = doc.querySelectorAll('#det0 .ind-val');
  console.log('지표 셀 개수:', indVals.length, '값들:', Array.from(indVals).map(e=>e.textContent));
  assert(indVals.length === 6, `지표 셀은 6개(RSI,5일선,20일선,60일선,거래량비,ATR)여야 함 (실제: ${indVals.length})`);
  const hasRealValue = Array.from(indVals).some(e => e.textContent.trim() !== '—' && e.textContent.trim() !== '');
  assert(hasRealValue, '지표 셀에 실제 계산값(— 아닌 값)이 하나 이상 있어야 함');

  // --- 5) 정렬 기능 검증 ---
  console.log('\n=== sortCards 검증 ===');
  const fakeBtn = doc.createElement('button');
  fakeBtn.className = 'srt-btn';
  doc.body.appendChild(fakeBtn);
  window.sortCards('score', fakeBtn);
  const scoresAfterSort = Array.from(doc.querySelectorAll('.card')).map(c => parseFloat(c.dataset.score));
  console.log('점수순 정렬 결과:', scoresAfterSort);
  let isDesc = true;
  for (let i = 1; i < scoresAfterSort.length; i++) if (scoresAfterSort[i] > scoresAfterSort[i-1]) isDesc = false;
  assert(isDesc, 'sortCards("score") 호출 후 점수 내림차순이어야 함');

  // --- 6) 빈 결과 처리 (empty state) ---
  console.log('\n=== 빈 결과 렌더링 검증 ===');
  window.render({ stocks: [], succeeded: 0, scanned: 10, failed: 10, market: 'KOSPI', warning: '테스트 빈 결과', generated_at: new Date().toISOString(), avg_score_to_prob: 0 });
  const emptyEl = doc.querySelector('.empty');
  assert(!!emptyEl, '빈 결과일 때 .empty 영역이 표시되어야 함');
  assert(emptyEl.textContent.includes('테스트 빈 결과'), 'warning 메시지가 화면에 표시되어야 함');

  console.log('\n프론트엔드 렌더링 테스트 완료.');
  window.close();
})().catch(e => { console.error('테스트 실행 중 예외:', e); process.exitCode = 1; });
