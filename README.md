# ALPHA DESK — 실시간 규칙 기반 종목 스크리너

장 마감 후(또는 언제든) 조회 시점 기준으로, **AI가 아닌 계산식**으로 단기 상승 가능성이 높아 보이는 종목을 선별해 보여주는 투자 참고용 도구입니다.

## 이게 무엇인가

- Yahoo Finance에서 종목별 최근 6개월 시세를 가져와 **RSI, 이동평균(5/20/60일), 거래량 비율, 단기 모멘텀, ATR 변동성**을 직접 계산합니다.
- 이 지표들을 가중 합산해 0~100점 점수를 매기고, 상위 N개를 정렬해 보여줍니다.
- "2주 내 상승 확률(추정)"은 점수를 40~82% 구간으로 환산한 **직관적 추정치**이며, 통계적으로 검증된 확률이 아닙니다.
- Claude API나 다른 AI를 전혀 호출하지 않습니다. API 키도, 과금도 필요 없습니다.

## 한계 솔직히 공개 (4분야 전문가 교차검증 반영)

이 프로젝트는 풀스택 아키텍처, 보안, 개발, 주식(금융) 4개 분야 관점에서 교차 검증을 거쳤고, 발견된 핵심 결함은 모두 수정했습니다. 수정 이력:

- **아키텍처**: market=ALL(전체 종목) 스캔 시 서버리스 함수 타임아웃(특히 Vercel Hobby 무료 플랜의 10초 제한)을 초과할 수 있던 문제 → 시간 예산(7초) 컷오프 도입, 초과 시 `partial_scan: true`로 부분 결과임을 명시.
- **금융 로직**: 목표가/손절가의 손익비가 ATR과 무관하게 사실상 고정값(~1.83~2.0)이던 결함 → 손익비가 신호 품질(추세·RSI·거래량)에 따라 1.3~2.8 사이에서 실제로 변별력을 갖도록 재설계 (`riskRewardRatio` 필드로 직접 확인 가능).
- **보안**: rate limiting이 전무해 무료 Yahoo Finance 우회 프록시로 악용될 수 있던 문제 → IP당 분당 10회 제한 추가 (단, 서버리스 인스턴스 분산 환경에서 완벽하지 않다는 한계는 `lib/rateLimit.js` 주석에 명시).
- **코드 품질**: MACD가 `macdLine > 0`만 보는 부정확한 근사치였던 문제 → 실제 시그널선(9일 EMA) 교차 기반 골든/데드크로스로 재구현, 가속 하락→급반등 패턴으로 검증(반전 후 3일 이내 정확히 감지). 또한 스코어링 가중치 전체를 `WEIGHTS` 설정 객체로 추출(100개 무작위 시드로 리팩토링 전후 동일 출력 검증 완료).

여전히 남아있는 한계 (사용 전 인지 필요):

1. **종목 유니버스가 정적 리스트입니다** (data/universe.js, 약 140개 — 한국 시총 상위 + 미국 대형주).
   실시간 전수 스캔(코스피+코스닥 약 2,500개)은 무료 호스팅의 함수 실행시간 제한(보통 10~30초) 때문에 불가능합니다.
   분기 1회 정도 수동으로 리스트를 갱신하거나, 추후 거래소 랭킹 API로 자동화하는 것을 권장합니다.

2. **Yahoo Finance는 비공식 API입니다.** 공식 지원이 종료된 지 오래됐고, 가끔 차단되거나 비정상 응답(예: "Edge: Not Found")을 줍니다.
   lib/yahoo.js가 이런 상황을 방어적으로 처리해 해당 종목만 건너뛰지만, 완전한 가동률을 보장하지는 않습니다.

3. **점수 공식은 검증된 백테스트 결과가 아니라 합리적 추정 규칙입니다.** (lib/scoring.js에 가중치 근거 주석 포함)
   실제 사용 전 과거 데이터로 백테스트해보고 가중치를 조정하는 것을 권장합니다.

## 프로젝트 구조

api/screen.js       서버리스 함수 — GET /api/screen?market=KR_ALL&limit=15&sector=반도체
data/universe.js     종목 유니버스 (정적 시드 리스트)
lib/indicators.js    RSI/SMA/EMA/MACD/ATR 등 순수 계산 함수
lib/scoring.js       지표를 조합해 0~100점 산출
lib/yahoo.js         Yahoo Finance 호출 + 방어적 파싱
public/index.html    프론트엔드 (정적 파일, /api/screen 호출)
test/                전체 단위/통합 테스트

## 로컬에서 테스트 실행

npm install
npm test

5개 테스트 스위트(지표 계산, Yahoo 파서, 파이프라인, API 핸들러, 프론트엔드 렌더링)가 전부 통과해야 정상입니다.

## GitHub + Vercel로 배포하기

1. 이 폴더를 GitHub repo로 push

   git init
   git add .
   git commit -m "init: rule-based stock screener"
   git branch -M main
   git remote add origin https://github.com/계정명/repo이름.git
   git push -u origin main

2. vercel.com 가입 후 "Add New Project" → 방금 만든 GitHub repo 선택 → Import

3. 별도 환경변수 설정 없이 바로 Deploy 가능합니다 (API 키 불필요).

4. 배포 완료 후 https://프로젝트명.vercel.app 으로 접속하면 바로 작동합니다.

## (선택) 나중에 AI 설명 기능을 추가하고 싶다면

api/explain.js를 새로 만들어 상위 15개의 계산된 지표값을 Claude API에 보내 자연어 설명만 받아오는 방식을 권장합니다.
이 경우 Vercel 프로젝트 설정의 Environment Variables에 ANTHROPIC_API_KEY를 추가하고, 프론트엔드가 아닌 서버리스 함수 안에서만 키를 사용해야 합니다 (브라우저에 노출 금지).

## 면책 조항

본 도구는 투자 참고용이며 투자 권유가 아닙니다. 모든 투자 판단과 책임은 사용자 본인에게 있습니다.
