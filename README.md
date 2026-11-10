# KoreaIssues

대한민국 전국 종합일간지 Top 10 및 주요 방송사(공식 뉴스 유튜브 채널 1:1 매핑)의 보도 스크립트를 수집하여, 자주 등장하는 결합단어(키워드) 기반의 **이슈 팩트 카드**와 **문장별 시간순 출처 꼬리표(최초 보도 언론사 및 기사 입력 시각 포함)**를 생성·공유하는 웹 애플리케이션입니다.

## 핵심 아키텍처
- **0단계 — 채널 마스터 레지스트리 & 파서 분석기**:
  - [media-channel-registry.json](file:///c:/git/KoreaIssues/public/data/media-channel-registry.json): 종합일간지 Top 10 및 방송사 공식 유튜브 9곳(`1:1`) 채널 ID 관리
  - [analyze-media-parsers.mjs](file:///c:/git/KoreaIssues/scripts/analyze-media-parsers.mjs): 포털(정답지) vs 언론사 공식 RSS 파싱 가능성 비교 및 방송사 유튜브 영상 설명란 대본·자막 트랙 진단
- **1단계 — 역방향(어제 → 과거) 순차 수집 및 중단 복구 DB**:
  - [crawl-checkpoint-manager.mjs](file:///c:/git/KoreaIssues/scripts/crawl-checkpoint-manager.mjs): 채널별 완료 날짜 구간(`completedRanges`) 및 비정상 종료 복구 커서(`inProgress`) 관리
  - [crawl-raw-scripts.mjs](file:///c:/git/KoreaIssues/scripts/crawl-raw-scripts.mjs) (**Track 1 수집기**): 어제(`D-1`)부터 과거로 내려가며 원본 스크립트를 로컬 `data/raw/{YYYY-MM-DD}/{channelId}.json`에 저장
- **2단계 — 결합단어 키워드화, 원문 문장 통째 발췌 + 시간순 꼬리표 & 1개월 보관 후 폐기**:
  - [process-issues-and-purge.mjs](file:///c:/git/KoreaIssues/scripts/process-issues-and-purge.mjs) (**Track 2 처리·폐기 매니저**):
    - 무료 로컬 한국어 결합단어(Compound Noun) 추출 및 이슈 클러스터링
    - 기존 이슈에 없던 새로운 사실 문장을 원문 그대로 통째 발췌하고, 동일 사실 문장은 **최초 보도 시각(`publishedAt ASC`) 순으로 출처 꼬리표**를 누적
    - 처리 완료된 Raw 스크립트는 트레이스를 위해 **30일(1개월)간 보관 후 자동 폐기**(`npm.cmd run purge:expired`)하거나 확인 즉시 처분(`npm.cmd run purge:processed`)
- **3단계 — 요약 이슈 공유 웹앱**:
  - 추천 키워드 필터, 매체별 보도 횟수 통계, 문장별 시간순 출처 꼬리표 아웃링크, 수집 범위 DB 및 파서 분석 리포트 대시보드 제공

## 실행 방법
```bash
# 1. 파서/자막 진단 리포트 갱신
npm.cmd run analyze:parsers

# 2. 이원화 파이프라인 실행 (Track 1 원본 수집 -> Track 2 이슈 추출)
npm.cmd run crawl:raw
npm.cmd run process:issues

# 3. 확인 완료된 Raw 스크립트 즉시 처분 또는 30일 경과 스크립트 자동 폐기
npm.cmd run purge:processed
npm.cmd run purge:expired
```
