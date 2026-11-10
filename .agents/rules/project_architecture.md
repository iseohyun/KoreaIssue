# Project Architecture & Development Rules (KoreaIssues)

## 1. CSS 스타일링 아키텍처 (Component-Scoped Modular CSS)
- **방식**: `KoreaEventList`와 동일하게 컴포넌트별 모듈형 CSS (**CSS Modules**, `*.module.css`)를 기본 스타일링 정책으로 사용한다.
- **전역 스타일**: CSS 변수(디자인 토큰), 리셋, 폰트 설정만 `src/styles/global.css`에 최소한으로 정의하고, 각 UI 컴포넌트의 스타일은 해당 컴포넌트와 동일한 경로/이름의 `ComponentName.module.css`로 격리하여 작성한다.

## 2. 이원화 버전 관리 및 캐시 버스팅 (Dual Versioning & Cache-Busting)
- **버전 파일**: `src/version.ts`에서 정식 시맨틱 버전(`SEMVER`)과 일자 기반 캐시 버스팅 빌드 태그(`BUILD_TAG`: `YYYYMMDDvN`)를 이원화하여 관리한다.
- **갱신 규칙**:
  - `BUILD_TAG` (`YYYYMMDDvN`): 코드 수정 및 빌드 시 당일 날짜 기준으로 `v1`, `v2`... 형태로 자동 갱신하며, Vite 빌드 시 에셋 파일명 해시/태그에 주입하여 브라우저 강제 새로고침(Hard Refresh) 없이도 최신 번들이 즉시 반영되도록 한다.
  - `SEMVER` (`v0.1.0` 등): 사용자의 명시적인 릴리즈 승인 시에만 버전을 올린다.

## 3. 수집 대상 매체 및 채널 마스터 레지스트리 (`public/data/media-channel-registry.json`)
- **신문사 (전국 종합일간지 Top 10)**:
  - 구독·열독률 상위 10대 종합일간지(조선일보, 중앙일보, 동아일보, 한겨레, 경향신문, 한국일보, 서울신문, 국민일보, 세계일보, 문화일보)로 시작한다.
  - 포털(네이버 언론사별 일자별 뉴스 목록 `oid` + `date`)을 **정답지(Ground Truth)**로 활용하여 수집하되, 각 언론사의 공식 RSS 피드 및 원문 HTML 메타태그(`article:published_time` 등) 파싱 전환 가능 여부를 `scripts/analyze-media-parsers.mjs`로 비교·분석한다.
- **방송사 (공식 뉴스 유튜브 채널 1:1 관리)**:
  - 주요 방송사 공식 뉴스 채널(KBS, MBC, SBS, JTBC, TV조선, 채널A, MBN, YTN, 연합뉴스TV)을 1:1로 매핑하여 관리한다.
  - 영상 설명란(Description)에 포함된 리포트 대본 전문과 유튜브 기본 제공 한국어 자막 트랙(`captions` / `timedtext`)을 우선 활용한다.

## 4. 이원화 수집/처리 파이프라인 및 데이터 생명주기 (30일 보관 후 폐기)
- **Track 1 — 원본 스크립트 수집기 (`scripts/crawl-raw-scripts.mjs`)**:
  - 어제(`D-1`)부터 과거 날짜를 순차적으로 탐색하며 채널별 뉴스/방송 스크립트를 `data/raw/{YYYY-MM-DD}/{channelId}.json`에 저장한다 (`data/raw/`는 `.gitignore` 처리하여 Git 용량 폭증을 방지).
  - 비정상 종료(강제 종료, 네트워크 오류 등)에 대비하여 채널별·일자별 완료 범위(`completedRanges`)와 진행 중인 커서(`inProgress`)를 `public/data/crawl-checkpoints.json`에 즉시 저장(Atomic Write)한다.
- **Track 2 — 이슈 추출·문장 발췌 병합 및 폐기 매니저 (`scripts/process-issues-and-purge.mjs`)**:
  - 무료 로컬 한국어 명사/결합단어(Compound Noun) 추출기를 우선 사용하여 자주 등장하는 핵심 키워드를 추천하고 이슈 카드를 생성·갱신한다 (추후 유료 LLM 어댑터 확장 가능).
  - 기존 이슈 카드에 없던 새로운 사실 문장은 **원문 문장을 통째로 발췌(Extractive)**하여 추가하고, 각 문장마다 **최초 보도 언론사부터 시간순(`publishedAt ASC`)으로 정렬된 출처 꼬리표(매체명 + 기사 입력 시각 `YYYY-MM-DD HH:mm` + 원문 링크)**를 부착한다.
  - 이슈 병합이 완료된 Raw 스크립트는 트레이스(역추적)를 위해 **기본 30일(1개월)간 로컬 보관 후 자동 폐기(Purge)**하거나, 사용자 확인 후 즉시 처분(`--purge-processed`)할 수 있도록 관리한다.

## 5. 저작권 및 웹앱 노출 정책
- 웹앱(`public/data/issues-summary.json`)에는 기사 원문 전체를 전재하지 않고, **키워드·매체별 보도 횟수 통계·핵심 사실 발췌 문장 + 시간순 원문 아웃링크 꼬리표**만 공유한다.
