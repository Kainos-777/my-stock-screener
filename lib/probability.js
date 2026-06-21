// lib/probability.js
//
// 0~100 스코어를 "N영업일 내 상승 확률(추정)"으로 환산하는 단일 공식.
//
// ⚠️ 중요: 이 파일이 유일한 정의처여야 한다. api/screen.js(실제 화면에 표시)와
// lib/backtest.js(그 표시값을 과거 데이터로 검증)가 각자 따로 이 공식을 들고 있으면,
// 한쪽만 수정되고 다른 쪽이 누락되는 순간 "백테스트가 검증하는 대상"과
// "실제 화면에 뜨는 값"이 달라져버린다 — 사용자에게 잘못된 신뢰를 주는 심각한 결함이 된다.
// 따라서 screen.js와 backtest.js는 반드시 이 함수 하나만 import해서 써야 한다.

/**
 * 순수 규칙 기반 점수이므로 실제 통계적으로 검증된 확률이 아니라 직관적 환산값임에 유의.
 * 점수 100 → 약 80%, 점수 0 → 약 40% (완전 무작위 동전던지기보다 약간 낮은 바닥)
 */
function scoreToProb(score) {
  const prob = 40 + (score / 100) * 40;
  return Math.round(Math.min(82, Math.max(40, prob)));
}

module.exports = { scoreToProb };
