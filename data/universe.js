// data/universe.js
//
// ⚠️ 중요: 이 리스트는 "정적 시드 리스트"입니다.
// 시가총액 순위는 시간이 지나며 바뀌므로, 실제 운영시에는
// 분기에 1회 정도 수동 갱신하거나, KRX/거래소 랭킹 API로 동적 생성하는 것을 권장합니다.
// (이 프로젝트의 1차 버전은 "스코어링 로직 검증"이 목적이라 정적 리스트로 시작합니다.)
//
// 코드 형식:
//   한국: 6자리 종목코드 (market 필드로 KOSPI/KOSDAQ 구분 → yahoo.js가 .KS/.KQ 접미사 자동 부여)
//   미국: 티커 그대로

const KOSPI_CORE = [
  { code: '005930', name: '삼성전자', sector: '반도체' },
  { code: '000660', name: 'SK하이닉스', sector: '반도체' },
  { code: '373220', name: 'LG에너지솔루션', sector: '2차전지' },
  { code: '207940', name: '삼성바이오로직스', sector: '바이오' },
  { code: '005380', name: '현대차', sector: '소비' },
  { code: '000270', name: '기아', sector: '소비' },
  { code: '068270', name: '셀트리온', sector: '바이오' },
  { code: '005935', name: '삼성전자우', sector: '반도체' },
  { code: '105560', name: 'KB금융', sector: '금융' },
  { code: '055550', name: '신한지주', sector: '금융' },
  { code: '035420', name: 'NAVER', sector: '기술/AI' },
  { code: '012330', name: '현대모비스', sector: '소비' },
  { code: '028260', name: '삼성물산', sector: '소비' },
  { code: '066570', name: 'LG전자', sector: '기술/AI' },
  { code: '003670', name: '포스코퓨처엠', sector: '2차전지' },
  { code: '035720', name: '카카오', sector: '기술/AI' },
  { code: '051910', name: 'LG화학', sector: '2차전지' },
  { code: '006400', name: '삼성SDI', sector: '2차전지' },
  { code: '086790', name: '하나금융지주', sector: '금융' },
  { code: '032830', name: '삼성생명', sector: '금융' },
  { code: '015760', name: '한국전력', sector: '소비' },
  { code: '009150', name: '삼성전기', sector: '반도체' },
  { code: '034730', name: 'SK', sector: '기술/AI' },
  { code: '018260', name: '삼성에스디에스', sector: '기술/AI' },
  { code: '010130', name: '고려아연', sector: '소비' },
  { code: '011200', name: 'HMM', sector: '소비' },
  { code: '033780', name: 'KT&G', sector: '소비' },
  { code: '030200', name: 'KT', sector: '기술/AI' },
  { code: '316140', name: '우리금융지주', sector: '금융' },
  { code: '024110', name: '기업은행', sector: '금융' },
  { code: '003550', name: 'LG', sector: '기술/AI' },
  { code: '267260', name: 'HD현대일렉트릭', sector: '방산' },
  { code: '042660', name: '한화오션', sector: '방산' },
  { code: '012450', name: '한화에어로스페이스', sector: '방산' },
  { code: '079550', name: 'LIG넥스원', sector: '방산' },
  { code: '047810', name: '한국항공우주', sector: '방산' },
  { code: '011070', name: 'LG이노텍', sector: '반도체' },
  { code: '010950', name: 'S-Oil', sector: '소비' },
  { code: '096770', name: 'SK이노베이션', sector: '2차전지' },
  { code: '003490', name: '대한항공', sector: '소비' },
  { code: '028050', name: '삼성E&A', sector: '소비' },
  { code: '009830', name: '디엘이앤씨', sector: '소비' },
  { code: '161390', name: '한국타이어앤테크놀로지', sector: '소비' },
  { code: '021240', name: '코웨이', sector: '소비' },
  { code: '011170', name: '롯데케미칼', sector: '2차전지' },
  { code: '097950', name: 'CJ제일제당', sector: '소비' },
  { code: '139480', name: '이마트', sector: '소비' },
  { code: '052690', name: '한전기술', sector: '방산' },
  { code: '034020', name: '두산에너빌리티', sector: '방산' },
  { code: '010140', name: '삼성중공업', sector: '방산' },
].map(s => ({ ...s, market: 'KOSPI' }));

const KOSDAQ_CORE = [
  { code: '196170', name: '알테오젠', sector: '바이오' }, // ⚠ 2026년 상반기 중 코스피 이전 상장 예정 — 갱신 필요
  { code: '247540', name: '에코프로비엠', sector: '2차전지' },
  { code: '086520', name: '에코프로', sector: '2차전지' },
  { code: '277810', name: '레인보우로보틱스', sector: '기술/AI' },
  { code: '028300', name: 'HLB', sector: '바이오' },
  { code: '000250', name: '삼천당제약', sector: '바이오' },
  { code: '298380', name: '에이비엘바이오', sector: '바이오' },
  { code: '058470', name: '리노공업', sector: '반도체' },
  { code: '214450', name: '파마리서치', sector: '바이오' },
  { code: '347850', name: '디앤디파마텍', sector: '바이오' },
  { code: '039030', name: '이오테크닉스', sector: '반도체' },
  { code: '240810', name: '원익IPS', sector: '반도체' },
  { code: '214370', name: '케어젠', sector: '바이오' },
  { code: '310210', name: '보로노이', sector: '바이오' },
  { code: '214150', name: '클래시스', sector: '바이오' },
  { code: '108490', name: '로보티즈', sector: '기술/AI' },
  { code: '141080', name: '리가켐바이오', sector: '바이오' },
  { code: '293490', name: '카카오게임즈', sector: '기술/AI' },
  { code: '263750', name: '펄어비스', sector: '기술/AI' },
  { code: '041510', name: '에스엠', sector: '소비' },
  { code: '035900', name: 'JYP Ent.', sector: '소비' },
  { code: '357780', name: '솔브레인', sector: '반도체' },
  { code: '067310', name: '하나마이크론', sector: '반도체' },
].map(s => ({ ...s, market: 'KOSDAQ' }));

const SP500_CORE = [
  { code: 'AAPL', name: 'Apple', sector: '기술/AI' },
  { code: 'MSFT', name: 'Microsoft', sector: '기술/AI' },
  { code: 'NVDA', name: 'NVIDIA', sector: '반도체' },
  { code: 'AMZN', name: 'Amazon', sector: '소비' },
  { code: 'GOOGL', name: 'Alphabet', sector: '기술/AI' },
  { code: 'META', name: 'Meta Platforms', sector: '기술/AI' },
  { code: 'TSLA', name: 'Tesla', sector: '2차전지' },
  { code: 'AVGO', name: 'Broadcom', sector: '반도체' },
  { code: 'BRK-B', name: 'Berkshire Hathaway', sector: '금융' },
  { code: 'JPM', name: 'JPMorgan Chase', sector: '금융' },
  { code: 'LLY', name: 'Eli Lilly', sector: '바이오' },
  { code: 'V', name: 'Visa', sector: '금융' },
  { code: 'XOM', name: 'ExxonMobil', sector: '소비' },
  { code: 'UNH', name: 'UnitedHealth', sector: '바이오' },
  { code: 'MA', name: 'Mastercard', sector: '금융' },
  { code: 'COST', name: 'Costco', sector: '소비' },
  { code: 'HD', name: 'Home Depot', sector: '소비' },
  { code: 'PG', name: 'Procter & Gamble', sector: '소비' },
  { code: 'NFLX', name: 'Netflix', sector: '기술/AI' },
  { code: 'JNJ', name: 'Johnson & Johnson', sector: '바이오' },
  { code: 'BAC', name: 'Bank of America', sector: '금융' },
  { code: 'CRM', name: 'Salesforce', sector: '기술/AI' },
  { code: 'ABBV', name: 'AbbVie', sector: '바이오' },
  { code: 'WMT', name: 'Walmart', sector: '소비' },
  { code: 'KO', name: 'Coca-Cola', sector: '소비' },
  { code: 'AMD', name: 'Advanced Micro Devices', sector: '반도체' },
  { code: 'PFE', name: 'Pfizer', sector: '바이오' },
  { code: 'TMO', name: 'Thermo Fisher Scientific', sector: '바이오' },
  { code: 'CSCO', name: 'Cisco Systems', sector: '기술/AI' },
  { code: 'ORCL', name: 'Oracle', sector: '기술/AI' },
  { code: 'ACN', name: 'Accenture', sector: '기술/AI' },
  { code: 'ADBE', name: 'Adobe', sector: '기술/AI' },
  { code: 'LIN', name: 'Linde', sector: '소비' },
  { code: 'MCD', name: "McDonald's", sector: '소비' },
  { code: 'DHR', name: 'Danaher', sector: '바이오' },
  { code: 'TXN', name: 'Texas Instruments', sector: '반도체' },
  { code: 'NKE', name: 'Nike', sector: '소비' },
  { code: 'NEE', name: 'NextEra Energy', sector: '소비' },
  { code: 'RTX', name: 'RTX Corporation', sector: '방산' },
  { code: 'LMT', name: 'Lockheed Martin', sector: '방산' },
  { code: 'NOC', name: 'Northrop Grumman', sector: '방산' },
  { code: 'GD', name: 'General Dynamics', sector: '방산' },
  { code: 'BA', name: 'Boeing', sector: '방산' },
].map(s => ({ ...s, market: 'NYSE' }));

const NASDAQ_CORE = [
  { code: 'INTC', name: 'Intel', sector: '반도체' },
  { code: 'QCOM', name: 'Qualcomm', sector: '반도체' },
  { code: 'AMAT', name: 'Applied Materials', sector: '반도체' },
  { code: 'MU', name: 'Micron Technology', sector: '반도체' },
  { code: 'LRCX', name: 'Lam Research', sector: '반도체' },
  { code: 'KLAC', name: 'KLA Corporation', sector: '반도체' },
  { code: 'PANW', name: 'Palo Alto Networks', sector: '기술/AI' },
  { code: 'PLTR', name: 'Palantir Technologies', sector: '기술/AI' },
  { code: 'BKNG', name: 'Booking Holdings', sector: '소비' },
  { code: 'ISRG', name: 'Intuitive Surgical', sector: '바이오' },
  { code: 'REGN', name: 'Regeneron Pharmaceuticals', sector: '바이오' },
  { code: 'VRTX', name: 'Vertex Pharmaceuticals', sector: '바이오' },
  { code: 'GILD', name: 'Gilead Sciences', sector: '바이오' },
  { code: 'MRNA', name: 'Moderna', sector: '바이오' },
  { code: 'PYPL', name: 'PayPal', sector: '금융' },
  { code: 'SBUX', name: 'Starbucks', sector: '소비' },
  { code: 'ADP', name: 'ADP', sector: '기술/AI' },
  { code: 'MDLZ', name: 'Mondelez International', sector: '소비' },
  { code: 'GEHC', name: 'GE HealthCare', sector: '바이오' },
  { code: 'CDNS', name: 'Cadence Design Systems', sector: '기술/AI' },
  { code: 'SNPS', name: 'Synopsys', sector: '기술/AI' },
  { code: 'MRVL', name: 'Marvell Technology', sector: '반도체' },
  { code: 'ASML', name: 'ASML Holding', sector: '반도체' },
  { code: 'CRWD', name: 'CrowdStrike', sector: '기술/AI' },
].map(s => ({ ...s, market: 'NASDAQ' }));

const UNIVERSE_KR = [...KOSPI_CORE, ...KOSDAQ_CORE];
const UNIVERSE_US = [...SP500_CORE, ...NASDAQ_CORE];
const UNIVERSE_ALL = [...UNIVERSE_KR, ...UNIVERSE_US];

const VALID_MARKETS = ['KOSPI', 'KOSDAQ', 'KR_ALL', 'US_ALL', 'ALL'];

function getUniverse(marketKey) {
  switch (marketKey) {
    case 'KOSPI': return KOSPI_CORE;
    case 'KOSDAQ': return KOSDAQ_CORE;
    case 'KR_ALL': return UNIVERSE_KR;
    case 'US_ALL': return UNIVERSE_US;
    case 'ALL': return UNIVERSE_ALL;
    default: return null; // 알 수 없는 키는 명시적으로 null — 호출부에서 400 처리하도록
  }
}

module.exports = { KOSPI_CORE, KOSDAQ_CORE, SP500_CORE, NASDAQ_CORE, UNIVERSE_KR, UNIVERSE_US, UNIVERSE_ALL, getUniverse, VALID_MARKETS };
