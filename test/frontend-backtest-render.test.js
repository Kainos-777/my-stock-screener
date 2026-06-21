// test/frontend-backtest-render.test.js
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; }
  else console.log('✅ PASS:', msg);
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function genYearPayload(seed, days = 250) {
  const rand = mulberry32(seed);
  const timestamp = [], close = [], high = [], low = [], volume = [];
  let p = 10000 + rand() * 90000;
  const bias = (rand() - 0.5) * 0.008;
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
  return { ok: true, status: 200, text: async () => JSON.stringify(genYearPayload(seed)) };
};

const backtestHandler = require('../api/backtest');
const { _resetForTests } = require('../lib/rateLimit');
_resetForTests();

function createMockReqRes(query) {
  const req = { method: 'GET', query };
  let statusCode = 200, jsonBody = null;
  const res = { setHeader: () => {}, status(c){statusCode=c;return this;}, json(b){jsonBody=b;return this;}, end(){return this;} };
  return { req, res, getBody: () => jsonBody, getStatus: () => statusCode };
}

(async () => {
  const t = createMockReqRes({ market: 'KOSPI', count: '8', minScore: '60', horizonDays: '10' });
  await backtestHandler(t.req, t.res);
  const apiResponse = t.getBody();
  console.log('=== 실제 api/backtest.js 응답을 프론트엔드에 주입 ===');
  console.log('overallStats:', apiResponse.overallStats);
  assert(apiResponse.perStock.length > 0, 'perStock에 결과가 있어야 함');

  const htmlPath = path.join(__dirname, '../public/index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/' });
  const { window } = dom;
  await new Promise(r => setTimeout(r, 100));

  assert(typeof window.renderBacktest === 'function', 'renderBacktest 함수가 전역에 노출되어야 함');
  assert(typeof window.switchTab === 'function', 'switchTab 함수가 전역에 노출되어야 함');

  // 탭 전환 검증
  const doc = window.document;
  const screenPanel = doc.getElementById('panel-screen');
  const btPanel = doc.getElementById('panel-backtest');
  assert(screenPanel.classList.contains('active'), '초기 상태는 스크리닝 탭이 active여야 함');
  assert(!btPanel.classList.contains('active'), '초기 상태는 백테스트 탭이 비활성이어야 함');

  window.switchTab('backtest');
  assert(btPanel.classList.contains('active'), 'switchTab("backtest") 후 백테스트 패널이 active여야 함');
  assert(!screenPanel.classList.contains('active'), 'switchTab("backtest") 후 스크리닝 패널은 비활성이어야 함');

  // renderBacktest 실행
  window.renderBacktest(apiResponse);

  const gapCard = doc.querySelector('.bt-gap-card');
  assert(!!gapCard, '.bt-gap-card가 렌더링되어야 함');

  const predictedVal = doc.querySelector('.bt-gap-val.predicted');
  const actualVal = doc.querySelector('.bt-gap-val.actual');
  assert(!!predictedVal && predictedVal.textContent.includes('%'), '예상 확률 값이 표시되어야 함');
  assert(!!actualVal && actualVal.textContent.includes('%'), '실제 적중률 값이 표시되어야 함');
  console.log('화면 표시 — 예상:', predictedVal.textContent, '/ 실제:', actualVal.textContent);

  const interp = doc.querySelector('.bt-interp');
  assert(!!interp && interp.textContent.length > 0, '해석 문구가 표시되어야 함');

  const stockRows = doc.querySelectorAll('.bt-stock-row');
  assert(stockRows.length === apiResponse.perStock.length, `종목별 행 개수는 perStock 길이와 같아야 함 (기대: ${apiResponse.perStock.length}, 실제: ${stockRows.length})`);

  // 빈 결과(선정 표본 0개) 처리 검증
  console.log('\n=== 빈 결과(표본 0개) 렌더링 검증 ===');
  window.renderBacktest({
    overallStats: { totalSamples: 10, selectedSamples: 0, actualUpRate: null, avgReturnIfSelected: null, avgReturnAll: 0.1 },
    interpretation: '테스트용 빈 결과 메시지',
    perStock: [], succeeded: 0, failed: 0, minScore: 80, horizonDays: 10,
  });
  const emptyEl = doc.querySelector('#btResArea .empty');
  assert(!!emptyEl, '표본 0개일 때 .empty 영역이 표시되어야 함');
  assert(emptyEl.textContent.includes('테스트용 빈 결과 메시지'), 'interpretation 메시지가 빈 상태에도 표시되어야 함');

  // partial_scan 표시 검증 (UI/UX 전문가 검토에서 추가된 항목)
  console.log('\n=== partial_scan 알림 렌더링 검증 ===');
  window.renderBacktest({ ...apiResponse, partial_scan: true, skipped_due_to_timeout: 5 });
  const warnNotes = Array.from(doc.querySelectorAll('#btResArea .bt-warn-note')).map(e => e.textContent);
  console.log('표시된 경고 문구들:', warnNotes);
  assert(warnNotes.some(t => t.includes('5') && t.includes('건너뛰')), 'partial_scan=true면 시간초과로 건너뛴 종목 수가 화면에 표시되어야 함');

  window.renderBacktest({ ...apiResponse, partial_scan: false });
  const noWarnAfter = Array.from(doc.querySelectorAll('#btResArea .bt-warn-note')).some(e => e.textContent.includes('건너뛰'));
  assert(!noWarnAfter, 'partial_scan=false면 시간초과 경고가 표시되면 안 됨');

  // 로딩 힌트 텍스트가 종목 수에 비례해 갱신되는지 검증
  console.log('\n=== 백테스트 로딩 힌트(예상 시간) 검증 ===');
  doc.getElementById('btCountSel').value = '20';
  doc.getElementById('btMktSel').value = 'KOSPI';
  // runBacktest()는 실제 fetch까지 실행되므로, 힌트 갱신 로직만 별도로 검증하기 위해
  // 함수 본문과 동일한 계산식을 직접 호출해 일치 여부를 확인한다.
  window.runBacktest(); // 비동기로 실행되며 즉시 힌트 텍스트부터 세팅함
  await new Promise(r => setTimeout(r, 10)); // 힌트 텍스트 세팅 직후 시점을 잡기 위한 짧은 대기
  const hintText = doc.getElementById('btLdHint').textContent;
  console.log('로딩 힌트 텍스트:', hintText);
  assert(hintText.includes('20종목'), `힌트 텍스트에 선택한 종목 수(20)가 반영되어야 함 (실제: "${hintText}")`);
  assert(/약 \d+초/.test(hintText), '힌트 텍스트에 구체적인 예상 초 단위가 포함되어야 함');

  console.log('\n프론트엔드 백테스트 렌더링 테스트 완료.');
  window.close();
})().catch(e => { console.error('테스트 실행 중 예외:', e); process.exitCode = 1; });
