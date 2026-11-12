/**
 * Track 2 — 구체적 사건 키워드 추출, 이슈 카드화, 2차 파급력(조회수·좋아요·급상승 트렌드) 점수화 및 Raw 스크립트 폐기 매니저
 * - 핵심 개선 사항:
 *   1) 보편적·추상적 단어("2026년 11월", "20대 남성", "일찍 내린", "인공지능 AI" 등)는 단독 키워드/이슈에서 배제하고,
 *      특정 사건을 식별할 수 있는 구체적 결합 사건명(예: "여자친구 살해 남성", "젠슨 황 스파이 불륜", "조작기소 특검법 예산")으로 키워드화
 *   2) 기사 수가 부족하거나 구체적 사건성이 약하면 억지로 Top 10을 채우지 않고 검증된 이슈만 선정
 *   3) 타임라인 및 문장 꼬리표 이원화:
 *      - 최초 보도 매체만 기본 노출하고, 단순 후속 보도(핵심단어 중복)는 `▼` 아이콘(마우스오버 시에만 표시)으로 축약
 *      - 단, 후속 보도에서 새로운 사실·단서가 추가된 경우에는 해당 언론사명과 새로 추가된 키워드(`addedKeywords`)를 함께 명시
 *   4) 2차 파급력(조회수·좋아요 48h 숙성 보정) 및 구글 급상승 검색어(KR) 비교를 통한
 *      [언론 보도 강도(Media Push) vs 실제 대중 소비·검색 점수(Public Pull)] 산출
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT_DIR,
  RAW_DATA_DIR,
  loadChannelRegistry,
  loadCheckpoints,
  saveCheckpoints,
  getKstDateString,
  addDaysToDateStr,
} from './crawl-checkpoint-manager.mjs';
import { fetchTextSafe, cleanXmlText } from './analyze-media-parsers.mjs';
import {
  extractRichEditorialMeta,
  appendOrUpdateMetricSnapshot,
} from './crawl-raw-scripts.mjs';

export const ISSUES_SUMMARY_PATH = path.join(
  ROOT_DIR,
  'public',
  'data',
  'issues-summary.json'
);

/**
 * 이슈 문서 고유 식별자(issueId)로부터 결정론적 UUID(v5 형식)를 생성
 */
export function generateDeterministicUuid(seedStr = '') {
  const hex = crypto.createHash('sha1').update(String(seedStr)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const STOPWORDS = new Set([
  '기자', '뉴스', '보도', '사진', '영상', '제공', '연합', '연합뉴스', '뉴시스', '뉴스1',
  '오늘', '어제', '내일', '이번', '지난', '최근', '현재', '오전', '오후', '시간', '경우',
  '관련', '대한', '통해', '위해', '대해', '따르면', '가운데', '이후', '당시', '당시엔', '결과',
  '입장', '설명', '주장', '말씀', '생각', '부분', '문제', '상황', '모습', '자리', '시작',
  '가능성', '필요', '예정', '계획', '방침', '수준', '정도', '이상', '이하', '전체', '일부',
  '서울', '한국', '우리', '국민', '정부', '대통령', '의원', '대표', '장관', '관계자',
  '밝혔다', '전했다', '말했다', '했다', '있다', '없다', '됐다', '된다', '이다', '아니다',
  '그동안', '앞으로', '한편', '다만', '특히', '또한', '그러나', '하지만', '그래서',
  '속보', '단독', '종합', '클립', '다시보기', '라이브', '생방송', '뉴스데스크', '뉴스룸',
  '뉴스특보', '모닝와이드', '뉴스파이터', '사건파일', '사실', '진실', '말합니다', '보고',
  '제보', '구독', '좋아요', '알림', '설정', '채널', '유튜브', '홈페이지', '카카오톡',
  '연합뉴스TV', 'YonhapnewsTV', 'KBS', 'MBC', 'SBS', 'JTBC', 'TV조선', 'TVCHOSUN', '채널A', 'MBN', 'YTN',
  '이슈PLAY', '에디터픽', '뉴스플레이리스트', '현장영상', '풀영상', '자막뉴스', '취재파일',
  '일찍', '내린', '많이', '가장', '처음', '다시', '계속', '모두', '직접', '함께', '결국',
  '강하게', '돌아올', '사실상', '본격', '긴급', '올해', '내년', '하루', '이틀', 'MBC중계방송',
  '시사팩트', '신통방통', '뉴스7', '뉴스9', '뉴스A', '시대', '시대에', '발칵', '몰랐다', '통하다니',
  '만에', '없어', '다친', '떠났다', '찾아', '무슨', '달째', '없이',
]);

// 어미/조사로 오인하여 끝 글자(이/의/가/로/도/만 등)를 잘라내면 안 되는 명사 원형 보호 목록
const PROTECTED_NOUN_SUFFIX_RE =
  /(회의|혐의|논의|합의|주의|의의|결의|항의|제의|심의|발의|정의|명의|스파이|아이|나이|차이|길이|높이|깊이|넓이|놀이|걸이|먹이|구이|추이|전이|변이|사우디|후티|국가|물가|전문가|평가|증가|추가|불가|허가|인가|단가|원가|정가|호가|대만|불만|오만|비만|천만|백만|기온|영하|영상|진입|침입|체포|구속|살해|폭행|사망|실종)$/;

// 단독으로 이슈나 대표 키워드가 될 수 없는 보편·일반 명사 및 시간/연령 표현
const GENERIC_NON_ISSUE_TERMS = new Set([
  '남성', '여성', '사람', '시민', '주민', '경찰', '검찰', '법원', '국회', '여야',
  '미국', '중국', '일본', '북한', '러시아', '수도', '지역', '전국', '세계', '국내',
  '인공지능', 'AI', '인공지능 AI', '기술', '산업', '시장', '경제', '사회', '정치',
  '10대', '20대', '30대', '40대', '50대', '60대', '70대', '80대',
  '20대 남성', '20대 여성', '30대 남성', '30대 여성', '40대 남성', '40대 여성', '50대 남성',
  '일찍 내린', '사우디아라비아 수도', '수도 리야드', '청주시 청원구',
  '의혹', '논란', '파장', '충격', '수사', '조사', '검토', '확인', '발표', '입장',
  '요구', '추진', '진술', '핵심', '의심', '반박', '비판', '공방', '우려', '사태',
  '현장', '질문', '답변', '이유', '논의', '대응', '발언', '공개', '언급', '강조',
  '투자', '모델', '출시', '개발', '지원', '확대', '개최', '진행', '마련', '선정',
  '남편', '아내', '가족', '집안', '성공', '인정', '미션', '포커', '집중',
]);

function isGenericOrDatePhrase(phrase = '') {
  const p = phrase.trim();
  if (!p) return true;
  if (GENERIC_NON_ISSUE_TERMS.has(p)) return true;
  // 날짜/연월일/시간 패턴 ("2026년 11월", "11월 8일", "지난 8일" 등) 배제
  if (/^\d{2,4}년(\s*\d{1,2}월)?$/.test(p)) return true;
  if (/^\d{1,2}월(\s*\d{1,2}일)?$/.test(p)) return true;
  if (/^\d+대\s*(남성|여성|운전자|피의자|아들|딸)$/.test(p)) return true;
  if (/^(오전|오후|어제|오늘|내일|지난|이번|최근)\s/.test(p)) return true;
  return false;
}

const POSTPOSITION_RE =
  /(에서는|에서부터|으로부터|에게는|한테는|이라고|라면서|이라며|으로만|까지도|조차도|마저도|에서|에게|한테|으로|로써|로서|보다|처럼|만큼|같이|까지|부터|마저|조차|이나|거나|든지|란|이란|엔|는|은|이|가|을|를|의|에|로|와|과|도|만)$/;

export function normalizeKoreanToken(rawToken = '') {
  let cleaned = String(rawToken)
    .replace(/^[^가-힣A-Za-z0-9]+|[^가-힣A-Za-z0-9]+$/g, '')
    .trim();
  if (cleaned.length < 2) return '';

  // 동사/형용사/부사형 및 인용 구어체 어미 배제 (예: 몰랐다, 통하다니, 자제해야, 지르겠다, 작업하던 등)
  if (
    /(했다|밝혔다|전했다|말했다|보인다|나타났다|된다|됐다|있다|없다|이다|아니다|한다|하며|하고|하는|해서|한|된|할|될|내린|올린|열린|모인|숨진|잡힌|돌아올|강하게|빠르게|크게|작게|랐다|았다|었다|였다|겠다|다니|라니|더니|던데|해야|하면|하던|받았|받고|털어|새는)$/.test(
      cleaned
    )
  ) {
    return '';
  }

  if (!PROTECTED_NOUN_SUFFIX_RE.test(cleaned)) {
    const stripped = cleaned.replace(POSTPOSITION_RE, '');
    if (stripped.length >= 2) {
      cleaned = stripped;
    }
  }

  // '청주서' -> '청주', '국회서' -> '국회' (처격 조사 '~서' 정리)
  if (cleaned.length >= 3 && /서$/.test(cleaned) && !/(보고서|계약서|신청서|청구서|진단서|자서|부서|순서|단서|경찰서|소방서)$/.test(cleaned)) {
    cleaned = cleaned.slice(0, -1);
  }

  if (cleaned.length < 2 || cleaned.length > 12) return '';
  if (/^\d+$/.test(cleaned)) return '';
  if (/^\d+(년|월|일|시|분|초|세|살|번째|차)$/.test(cleaned)) return '';
  if (STOPWORDS.has(cleaned)) return '';
  return cleaned;
}

/**
 * 문장 또는 제목에서 구체적 사건성을 가진 2~3어절 결합키워드 및 핵심 명사 추출
 */
export function extractKeywordsAndCompounds(text = '') {
  const words = String(text)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/['"“”‘’()[\]{}<>·,.:;!?/~`@#$%^&*_+=|\\-\u2026\u2025\u318d]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const singleTokens = [];
  const compound2Tokens = [];
  const compound3Tokens = [];

  const normalizedSeq = words.map((w) => normalizeKoreanToken(w)).filter(Boolean);

  for (let i = 0; i < normalizedSeq.length; i++) {
    const t1 = normalizedSeq[i];
    if (!GENERIC_NON_ISSUE_TERMS.has(t1)) {
      singleTokens.push(t1);
    }

    const t2 = normalizedSeq[i + 1];
    if (t2 && t1 !== t2) {
      const c2 = `${t1} ${t2}`;
      if (!isGenericOrDatePhrase(c2)) {
        compound2Tokens.push(c2);
      }
      const t3 = normalizedSeq[i + 2];
      if (t3 && t2 !== t3 && t1 !== t3) {
        const c3 = `${t1} ${t2} ${t3}`;
        if (!isGenericOrDatePhrase(c3)) {
          compound3Tokens.push(c3);
        }
      }
    }
  }

  return {
    singleTokens: Array.from(new Set(singleTokens)),
    compound2Tokens: Array.from(new Set(compound2Tokens)),
    compound3Tokens: Array.from(new Set(compound3Tokens)),
    allCompounds: Array.from(new Set([...compound3Tokens, ...compound2Tokens])),
  };
}

/**
 * 클러스터 내 기사 제목 + 본문 리드 문장들로부터 가장 구체적인 사건명(2~3어절) 합성
 * - 제목이 인용구/은유('당시엔 몰랐다 스파이', '시대 미인계 통하다니')로만 되어 있어도 본문 리드 문장의 핵심 주체('젠슨', '엔비디아', '불륜')를 함께 반영
 */
function buildSpecificEventKeywords(items = []) {
  const phraseScores = new Map();
  const tokenFreq = new Map();

  for (const it of items) {
    const cleanTitle = String(it.title || '')
      .replace(/\[[^\]]*\]|\([^)]*\)|\/[^\s]+$/g, ' ')
      .trim();
    const { singleTokens, compound2Tokens, compound3Tokens } =
      extractKeywordsAndCompounds(cleanTitle);

    for (const tk of singleTokens) {
      tokenFreq.set(tk, (tokenFreq.get(tk) || 0) + 2);
    }
    for (const c3 of compound3Tokens) {
      phraseScores.set(c3, (phraseScores.get(c3) || 0) + 5);
    }
    for (const c2 of compound2Tokens) {
      phraseScores.set(c2, (phraseScores.get(c2) || 0) + 3);
    }

    // 본문 첫 2문장의 핵심 명사도 가중치(1점)로 합산하여 제목에서 생략된 핵심 고유명사 보완
    const leadBody = (it.sentences || []).slice(0, 2).join(' ');
    const bodyKw = extractKeywordsAndCompounds(leadBody);
    for (const tk of bodyKw.singleTokens) {
      tokenFreq.set(tk, (tokenFreq.get(tk) || 0) + 1);
    }
  }

  // 대표 기사 제목의 자연스러운 어순(좌->우)을 유지한 채 빈도 상위 핵심 명사 3개를 결합해 사건 구절 생성
  const topSingleSet = new Set(
    Array.from(tokenFreq.entries())
      .filter(([k, cnt]) => cnt >= 2 && !isGenericOrDatePhrase(k))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k]) => k)
  );

  const firstTitleClean = String(items[0]?.title || '').replace(
    /\[[^\]]*\]|\([^)]*\)|\/[^\s]+$/g,
    ' '
  );
  const { singleTokens: firstTitleOrder } =
    extractKeywordsAndCompounds(firstTitleClean);
  const orderedCoreTokens = firstTitleOrder.filter((tk) =>
    topSingleSet.has(tk)
  );
  for (const tk of topSingleSet) {
    if (!orderedCoreTokens.includes(tk)) orderedCoreTokens.push(tk);
  }

  const specificResults = [];
  if (orderedCoreTokens.length >= 3) {
    specificResults.push(
      `${orderedCoreTokens[0]} ${orderedCoreTokens[1]} ${orderedCoreTokens[2]}`
    );
  } else if (orderedCoreTokens.length === 2) {
    specificResults.push(`${orderedCoreTokens[0]} ${orderedCoreTokens[1]}`);
  }

  const sortedPhrases = Array.from(phraseScores.entries())
    .filter(([p]) => !isGenericOrDatePhrase(p))
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);

  for (const p of sortedPhrases) {
    if (
      !specificResults.some((existing) => existing.includes(p) || p.includes(existing))
    ) {
      specificResults.push(p);
    }
    if (specificResults.length >= 5) break;
  }

  return specificResults.length > 0 ? specificResults : orderedCoreTokens.slice(0, 4);
}

/**
 * 두 문장 간 핵심단어 겹침 비율(Overlap Ratio) 계산
 * - 후속 보도가 기존 문장과 핵심단어 75~80% 이상 겹치면 단순 중복 보도로 판별하여 `▼` 마우스오버로 숨김
 */
function computeCoreWordOverlapRatio(sentA, sentB) {
  if (sentA === sentB) return 1.0;
  const { singleTokens: tokA } = extractKeywordsAndCompounds(sentA);
  const { singleTokens: tokB } = extractKeywordsAndCompounds(sentB);
  if (tokA.length === 0 || tokB.length === 0) return 0;

  const setA = new Set(tokA);
  const setB = new Set(tokB);
  let inter = 0;
  for (const t of setB) {
    if (setA.has(t)) inter += 1;
  }
  const minLen = Math.min(setA.size, setB.size);
  return minLen > 0 ? inter / minLen : 0;
}

/**
 * 방송사 유튜브 RSS에서 실시간 조회수(views) 및 좋아요(starRating) 2차 수집 갱신
 * + 전체 Raw 파일을 v2.0 스키마로 업그레이드(중복 scriptText 제거, urls/meta/metrics(+hour) 구조화)
 */
async function refreshYoutubeEngagementMetrics(rawFiles) {
  const registry = loadChannelRegistry();
  const liveMetricsMap = new Map();

  for (const bc of registry.broadcasters || []) {
    if (!bc.youtubeChannelId) continue;
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${bc.youtubeChannelId}`;
    const res = await fetchTextSafe(rssUrl, 8000);
    if (!res.ok || !res.text) continue;

    const entries = res.text.match(/<entry>[\s\S]*?<\/entry>/gi) || [];
    for (const entryXml of entries) {
      const vidMatch = entryXml.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i);
      const viewsMatch = entryXml.match(/<media:statistics[^>]*views=["'](\d+)["']/i);
      const likesMatch = entryXml.match(/<media:starRating[^>]*count=["'](\d+)["']/i);
      if (!vidMatch) continue;
      const videoId = vidMatch[1].trim();
      const views = viewsMatch ? Number(viewsMatch[1]) || 0 : 0;
      const likes = likesMatch ? Number(likesMatch[1]) || 0 : 0;
      liveMetricsMap.set(`${bc.id}-yt-${videoId}`, { views, likes });
    }
  }

  let updatedItemsCount = 0;
  let migratedItemsCount = 0;
  for (const rf of rawFiles) {
    let touched = false;
    if (rf.data.schemaVersion !== '2.0') {
      rf.data.schemaVersion = '2.0';
      touched = true;
    }

    for (const item of rf.data.items || []) {
      const live = liveMetricsMap.get(item.itemId);
      if (live) {
        item.viewCount = Math.max(item.viewCount || 0, live.views);
        item.likeCount = Math.max(item.likeCount || 0, live.likes);
        item.metricsUpdatedAt = new Date().toISOString();
        touched = true;
        updatedItemsCount += 1;
      }

      // v2.0 스키마 마이그레이션: 중복 scriptText 제거 + urls, meta, metrics(+hour 시계열) 보강
      if ('scriptText' in item) {
        delete item.scriptText;
        touched = true;
        migratedItemsCount += 1;
      }
      if (item.schemaVersion !== '2.0') {
        item.schemaVersion = '2.0';
        touched = true;
      }
      if (!item.urls) {
        item.urls = {
          orig: item.originalUrl || item.sourceUrl || item.portalUrl || '',
          portal: item.portalUrl || item.sourceUrl || '',
        };
        touched = true;
      }
      if (!item.meta) {
        item.meta = extractRichEditorialMeta({
          title: item.title || '',
          rawHtml: '',
          sentences: item.sentences || [],
          mediaType: item.mediaType || rf.data.mediaType || 'NEWSPAPER',
        });
        touched = true;
      }
      if (!Array.isArray(item.metrics) || item.metrics.length === 0 || live) {
        item.metrics = appendOrUpdateMetricSnapshot(
          item.metrics,
          item.publishedAt,
          {
            views: item.viewCount || 0,
            likes: item.likeCount || 0,
            reactions: 0,
            comments: 0,
          }
        );
        touched = true;
      }
      if (Array.isArray(item.sentences)) {
        item.charLength = item.sentences.reduce((acc, s) => acc + s.length, 0);
      }
    }
    if (touched) {
      fs.writeFileSync(rf.fullPath, JSON.stringify(rf.data, null, 2), 'utf-8');
      rf.sizeBytes = fs.statSync(rf.fullPath).size;
    }
  }
  if (migratedItemsCount > 0) {
    console.log(
      `[SchemaUpgrade] v2.0 스키마 마이그레이션 완료: ${migratedItemsCount}건에서 중복 scriptText 제거 및 urls/meta/metrics(+hour) 구조화 완료.`
    );
  }
  return updatedItemsCount;
}

/**
 * 구글 트렌드(KR) 일간 급상승 검색어 RSS 수집 (실제 대중 관심사 비교용)
 */
async function fetchPublicSearchTrends() {
  const url = 'https://trends.google.co.kr/trending/rss?geo=KR';
  const res = await fetchTextSafe(url, 8000);
  const trends = [];
  if (res.ok && res.text) {
    const items = res.text.match(/<item>[\s\S]*?<\/item>/gi) || [];
    for (const itXml of items.slice(0, 15)) {
      const titleMatch = itXml.match(/<title>([\s\S]*?)<\/title>/i);
      const trafficMatch = itXml.match(/<ht:approx_traffic>([^<]+)<\/ht:approx_traffic>/i);
      const newsTitleMatch = itXml.match(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/i);
      if (!titleMatch) continue;
      const keyword = cleanXmlText(titleMatch[1]);
      const trafficStr = trafficMatch ? cleanXmlText(trafficMatch[1]) : '1,000+';
      const numericTraffic = Number(trafficStr.replace(/[^\d]/g, '')) || 1000;
      trends.push({
        keyword,
        trafficText: trafficStr,
        trafficVolume: numericTraffic,
        sampleNewsTitle: newsTitleMatch ? cleanXmlText(newsTitleMatch[1]) : '',
      });
    }
  }
  return trends;
}

/**
 * 기사/영상이 보도된 후 경과 시간(hours)을 기반으로 48시간 숙성 예상 조회수(48h Matured Views) 산출
 * - 뉴스 소비 곡선: 6시간 내 55%, 12시간 내 72%, 24시간 내 86%, 48시간 내 100% 수렴
 */
function estimate48hMaturedViews(rawViews = 0, publishedAtStr = '') {
  if (!rawViews || rawViews <= 0) return 0;
  const pubMs = new Date(publishedAtStr.replace(' ', 'T') + '+09:00').getTime();
  const nowMs = Date.now();
  const ageHours = Number.isFinite(pubMs)
    ? Math.max(1, (nowMs - pubMs) / (1000 * 3600))
    : 24;

  let maturityFactor = 1.0;
  if (ageHours < 3) maturityFactor = 2.4;
  else if (ageHours < 6) maturityFactor = 1.8;
  else if (ageHours < 12) maturityFactor = 1.4;
  else if (ageHours < 24) maturityFactor = 1.15;
  else maturityFactor = 1.0;

  return Math.round(rawViews * maturityFactor);
}

function loadAllRawFiles() {
  const rawRecords = [];
  if (!fs.existsSync(RAW_DATA_DIR)) return rawRecords;

  const dateDirs = fs
    .readdirSync(RAW_DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort();

  for (const dateStr of dateDirs) {
    const dayDir = path.join(RAW_DATA_DIR, dateStr);
    const files = fs.readdirSync(dayDir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const fullPath = path.join(dayDir, f);
      try {
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
        const stat = fs.statSync(fullPath);
        rawRecords.push({
          dateStr,
          channelId: data.channelId || f.replace(/\.json$/, ''),
          fullPath,
          sizeBytes: stat.size,
          data,
        });
      } catch {
        // ignore
      }
    }
  }
  return rawRecords;
}

export async function runIssueProcessorAndPurge() {
  const args = process.argv.slice(2);
  const purgeExpired = args.includes('--purge-expired');
  const purgeProcessed = args.includes('--purge-processed');

  const checkpointState = loadCheckpoints();
  const retentionDays = checkpointState.retentionDays || 30;
  const todayStr = getKstDateString(0);

  const rawFiles = loadAllRawFiles();
  console.log(
    `[IssueProcessor] 로컬 Raw 스크립트 파일 ${rawFiles.length}개 스캔 및 2차 파급력(조회수·좋아요) 갱신 중...`
  );

  // 2차 파급력 수집: 유튜브 실시간 조회수/좋아요 갱신 + 구글 급상승 검색어 수집
  const updatedMetricsCount = await refreshYoutubeEngagementMetrics(rawFiles);
  const publicTrends = await fetchPublicSearchTrends();
  console.log(
    `[ImpactTracker] 유튜브 영상 ${updatedMetricsCount}건 조회수·좋아요 2차 갱신 완료 | 실시간 급상승 검색어 ${publicTrends.length}개 수집 완료.`
  );

  const itemMap = new Map();
  for (const rf of rawFiles) {
    for (const item of rf.data.items || []) {
      if (!itemMap.has(item.itemId)) {
        item.sentences = (item.sentences || []).filter(
          (s) =>
            !/사실을\s*보고\s*진실을\s*말합니다|기사문의\s*및\s*제보|유튜브\s*구독|라이브\s*스트리밍|카카오톡\s*제보|홈페이지에서\s*확인|무단전재\s*및\s*재배포|더\s*자세한\s*내용은|이슈플레이에서\s*확인|반복재생중입니다|스트리밍은\s*['"]?주요뉴스|다시보기는|구독과\s*좋아요|알림\s*설정|투표에\s*참여|댓글로\s*남겨|이슈날먹/i.test(
              s
            )
        );
        itemMap.set(item.itemId, { ...item, dateStr: rf.dateStr });
      }
    }
  }

  const allItems = Array.from(itemMap.values()).sort((a, b) =>
    String(a.publishedAt).localeCompare(String(b.publishedAt))
  );

  // 각 기사의 제목·본문에서 토큰 추출
  for (const item of allItems) {
    const cleanTitle = String(item.title || '').replace(
      /\[[^\]]*\]|\([^)]*속보[^)]*\)|\/[^\s]+$/g,
      ' '
    );
    const titleKw = extractKeywordsAndCompounds(cleanTitle);
    const bodyKw = extractKeywordsAndCompounds(
      (item.sentences || []).slice(0, 3).join(' ')
    );

    item._titleSingles = new Set(titleKw.singleTokens);
    item._titleCompounds = new Set(titleKw.allCompounds);
    item._allCompounds = new Set([
      ...titleKw.allCompounds,
      ...bodyKw.allCompounds,
    ]);
    item._allSingles = new Set([
      ...titleKw.singleTokens,
      ...bodyKw.singleTokens,
    ]);
  }

  function getItemDateOnly(it) {
    return String(it.publishedAt || it.dateStr || todayStr).slice(0, 10);
  }

  function getDaysDiff(dateA, dateB) {
    const msA = Date.parse(`${dateA}T00:00:00Z`);
    const msB = Date.parse(`${dateB}T00:00:00Z`);
    if (Number.isNaN(msA) || Number.isNaN(msB)) return 0;
    return Math.abs(msA - msB) / (86400 * 1000);
  }

  // 기사 클러스터링: 날짜나 제목 표현(비유·인용구)이 달라도 본문 리드 문장의 핵심 주체·사건이 같으면 하나로 묶기
  const rawClusters = [];
  for (const item of allItems) {
    const itemDate = getItemDateOnly(item);
    let bestCluster = null;
    let bestScore = 0;

    for (const cl of rawClusters) {
      if (getDaysDiff(itemDate, cl.firstDate) > 31) continue;

      let sharedTitleSingles = 0;
      let sharedBodySingles = 0;
      let sharedCompounds = 0;

      for (const tk of item._titleSingles) {
        if (cl.seedTitleSingles.has(tk) || cl.titleSingleSet.has(tk)) {
          sharedTitleSingles += 1;
        }
      }
      for (const tk of item._allSingles) {
        if (cl.seedTitleSingles.has(tk)) {
          sharedBodySingles += 1;
        }
      }
      for (const cp of item._allCompounds) {
        if (cl.seedCompounds.has(cp) || cl.compoundSet.has(cp)) {
          sharedCompounds += 1;
        }
      }

      const score =
        sharedTitleSingles * 2.5 +
        sharedBodySingles * 1.5 +
        sharedCompounds * 3;
      const isStrongMatch =
        (sharedTitleSingles >= 2 && score >= 6.0) ||
        (sharedTitleSingles >= 1 && sharedBodySingles >= 3 && score >= 7.0) ||
        (sharedBodySingles >= 3 && sharedCompounds >= 1 && score >= 7.5);

      if (isStrongMatch && score > bestScore) {
        bestScore = score;
        bestCluster = cl;
      }
    }

    if (bestCluster) {
      bestCluster.items.push(item);
      if (itemDate > bestCluster.latestDate) bestCluster.latestDate = itemDate;
      if (itemDate < bestCluster.firstDate) bestCluster.firstDate = itemDate;
      for (const tk of item._titleSingles) bestCluster.titleSingleSet.add(tk);
      for (const cp of item._allCompounds) bestCluster.compoundSet.add(cp);
    } else {
      rawClusters.push({
        items: [item],
        firstDate: itemDate,
        latestDate: itemDate,
        seedTitleSingles: new Set(item._titleSingles),
        seedCompounds: new Set(item._allCompounds),
        titleSingleSet: new Set(item._titleSingles),
        compoundSet: new Set(item._allCompounds),
      });
    }
  }

  // 2차 클러스터 병합: 날짜가 다르거나 제목이 인용구·비유('당시엔 몰랐다 스파이', '시대 미인계 통하다니')로 뽑힌 동일 맥락 클러스터 통합
  const clusters = [];
  for (const cl of rawClusters.sort((a, b) => b.items.length - a.items.length)) {
    const freqMap = new Map();
    const titleFreqMap = new Map();
    for (const it of cl.items) {
      for (const tk of it._titleSingles) {
        if (!isGenericOrDatePhrase(tk)) {
          titleFreqMap.set(tk, (titleFreqMap.get(tk) || 0) + 1);
          freqMap.set(tk, (freqMap.get(tk) || 0) + 2);
        }
      }
      for (const tk of it._allSingles) {
        if (!isGenericOrDatePhrase(tk)) {
          freqMap.set(tk, (freqMap.get(tk) || 0) + 1);
        }
      }
    }
    const tokensA = new Set(
      Array.from(freqMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k]) => k)
    );
    const titleTokensA = new Set(
      Array.from(titleFreqMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k]) => k)
    );

    let mergedInto = null;
    for (const target of clusters) {
      if (getDaysDiff(cl.firstDate, target.firstDate) > 31) {
        continue;
      }
      let overlapCnt = 0;
      for (const t of tokensA) {
        if (target._coreKwTokens.has(t)) overlapCnt += 1;
      }
      let titleOverlapCnt = 0;
      for (const t of titleTokensA) {
        if (target._titleKwTokens.has(t) || target._coreKwTokens.has(t)) {
          titleOverlapCnt += 1;
        }
      }
      if (overlapCnt >= 3 || (titleOverlapCnt >= 2 && overlapCnt >= 2)) {
        mergedInto = target;
        break;
      }
    }
    if (mergedInto) {
      mergedInto.items.push(...cl.items);
      if (cl.latestDate > mergedInto.latestDate) {
        mergedInto.latestDate = cl.latestDate;
      }
      if (cl.firstDate < mergedInto.firstDate) {
        mergedInto.firstDate = cl.firstDate;
      }
      for (const tk of cl.titleSingleSet) mergedInto.titleSingleSet.add(tk);
      for (const cp of cl.compoundSet) mergedInto.compoundSet.add(cp);
      for (const t of tokensA) mergedInto._coreKwTokens.add(t);
      for (const t of titleTokensA) mergedInto._titleKwTokens.add(t);
    } else {
      cl._coreKwTokens = tokensA;
      cl._titleKwTokens = titleTokensA;
      clusters.push(cl);
    }
  }

  // 구체적 사건성이 검증된 클러스터 선별 및 사건명·본문 핵심주체 기준 3차 중복 맥락 완전 통합
  const preValidClusters = clusters
    .map((cl) => {
      const specificKeywords = buildSpecificEventKeywords(cl.items);
      return {
        ...cl,
        specificKeywords,
      };
    })
    .filter(
      (cl) =>
        cl.items.length >= 2 &&
        cl.specificKeywords.length > 0 &&
        !isGenericOrDatePhrase(cl.specificKeywords[0])
    )
    .sort((a, b) => b.items.length - a.items.length);

  const validClusters = [];
  for (const cl of preValidClusters) {
    const kwWords = new Set(
      cl.specificKeywords
        .slice(0, 3)
        .join(' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !isGenericOrDatePhrase(w))
    );
    const coreWords = new Set([...kwWords, ...(cl._coreKwTokens || [])]);
    let sameTopicTarget = null;
    for (const existing of validClusters) {
      let sharedKw = 0;
      for (const w of kwWords) {
        if (existing._kwWords.has(w)) sharedKw += 1;
      }
      let sharedCore = 0;
      for (const w of coreWords) {
        if (existing._coreWords.has(w)) sharedCore += 1;
      }
      if (sharedKw >= 2 || (sharedKw >= 1 && sharedCore >= 3) || sharedCore >= 4) {
        sameTopicTarget = existing;
        break;
      }
    }
    if (sameTopicTarget) {
      const seenItemIds = new Set(sameTopicTarget.items.map((i) => i.itemId));
      for (const it of cl.items) {
        if (!seenItemIds.has(it.itemId)) {
          sameTopicTarget.items.push(it);
          seenItemIds.add(it.itemId);
        }
      }
      if (cl.latestDate > sameTopicTarget.latestDate) {
        sameTopicTarget.latestDate = cl.latestDate;
      }
      if (cl.firstDate < sameTopicTarget.firstDate) {
        sameTopicTarget.firstDate = cl.firstDate;
      }
      sameTopicTarget.specificKeywords = buildSpecificEventKeywords(
        sameTopicTarget.items
      );
      for (const w of kwWords) sameTopicTarget._kwWords.add(w);
      for (const w of coreWords) sameTopicTarget._coreWords.add(w);
    } else {
      cl._kwWords = kwWords;
      cl._coreWords = coreWords;
      validClusters.push(cl);
    }
  }
  validClusters.sort((a, b) => b.items.length - a.items.length);

  // 전체 추천 키워드도 구체적 사건 키워드만 추출
  const recommendedKeywords = [];
  const seenKw = new Set();
  for (const cl of validClusters) {
    const channelSet = new Set(cl.items.map((i) => i.channelId));
    for (const kw of cl.specificKeywords.slice(0, 2)) {
      if (seenKw.has(kw) || isGenericOrDatePhrase(kw)) continue;
      seenKw.add(kw);
      recommendedKeywords.push({
        keyword: kw,
        isCompound: kw.includes(' '),
        articleCount: cl.items.length,
        channelCount: channelSet.size,
        score: cl.items.length * 3 + channelSet.size * 5,
      });
    }
  }

  // 이슈 카드 생성 및 타임라인/파급력 점수 계산 (일자별 최대 언급/조회수 기준으로 정규화하여 날짜별 점수 왜곡 방지)
  const issueCards = [];
  const maxMentionsByDate = new Map();
  const maxMaturedViewsByDate = new Map();

  for (const cl of validClusters) {
    const d = cl.firstDate || todayStr;
    const prevM = maxMentionsByDate.get(d) || 1;
    if (cl.items.length > prevM) {
      maxMentionsByDate.set(d, cl.items.length);
    }
  }

  // 1차 패스: 각 클러스터의 48h 숙성 조회수 합산 최대치 파악
  const clusterViewSums = validClusters.map((cl) => {
    const d = cl.firstDate || todayStr;
    let rawViews = 0;
    let maturedViews = 0;
    let likes = 0;
    for (const it of cl.items) {
      const v = Number(it.viewCount) || 0;
      const l = Number(it.likeCount) || 0;
      rawViews += v;
      likes += l;
      maturedViews += estimate48hMaturedViews(v, it.publishedAt);
    }
    const prevV = maxMaturedViewsByDate.get(d) || 1;
    if (maturedViews > prevV) {
      maxMaturedViewsByDate.set(d, maturedViews);
    }
    return { rawViews, maturedViews, likes };
  });

  for (let idx = 0; idx < validClusters.length; idx++) {
    const cl = validClusters[idx];
    const viewMetrics = clusterViewSums[idx];
    const sortedItems = [...cl.items].sort((a, b) =>
      String(a.publishedAt).localeCompare(String(b.publishedAt))
    );

    const primaryEventKeyword = cl.specificKeywords[0];
    const firstDate = (sortedItems[0].publishedAt || todayStr).slice(0, 10);
    const issueId = `issue-${firstDate}-${primaryEventKeyword.replace(/\s+/g, '-')}`;
    const issueUuid = generateDeterministicUuid(issueId);

    for (const it of sortedItems) {
      it._issueUuid = issueUuid;
    }

    const byChannel = {};
    let newspaperCount = 0;
    let broadcastCount = 0;

    // 이슈의 기준 키워드 집합 (최초 보도 기사의 핵심 단어들로 초기화)
    const knownIssueTokens = new Set(sortedItems[0]._allSingles);
    const facts = [];

    for (let itemIdx = 0; itemIdx < sortedItems.length; itemIdx++) {
      const it = sortedItems[itemIdx];
      byChannel[it.channelId] = (byChannel[it.channelId] || 0) + 1;
      if (it.mediaType === 'NEWSPAPER') newspaperCount += 1;
      else broadcastCount += 1;

      const citation = {
        channelId: it.channelId,
        channelName: it.channelName,
        mediaType: it.mediaType,
        publishedAt: it.publishedAt,
        url: String(
          it.urls?.orig || it.sourceUrl || it.originalUrl || it.portalUrl || ''
        )
          .replace(/&#x3D;/gi, '=')
          .replace(/&amp;/gi, '&'),
        portalUrl: it.urls?.portal || it.portalUrl,
        articleTitle: it.title,
        viewCount: it.viewCount || 0,
        likeCount: it.likeCount || 0,
        meta: it.meta || undefined,
        metrics: it.metrics || undefined,
      };

      const candidateSentences = (it.sentences || [])
        .filter((s) => !/^[·•\-①②③④⑤▶▷■◆]/.test(s.trim()))
        .slice(0, 3);
      let attachedToAnyFact = false;
      let addedNewFactFromThisArticle = false;
      const clusterCoreTokens = primaryEventKeyword
        .split(/\s+/)
        .filter((w) => w.length >= 2);

      for (const sent of candidateSentences) {
        // 클러스터의 핵심 사건 단어가 최소 1개라도 포함된 문장만 채택 (라이브 모음 영상의 타 이슈 문장 혼입 방지)
        if (
          clusterCoreTokens.length > 0 &&
          !clusterCoreTokens.some((ct) => sent.includes(ct))
        ) {
          continue;
        }

        // 기존 문장과 핵심단어 겹침 검사
        let matchedFact = null;
        let bestOverlap = 0;
        for (const existingFact of facts) {
          const overlap = computeCoreWordOverlapRatio(
            existingFact.sentence,
            sent
          );
          if (overlap >= 0.42 && overlap > bestOverlap) {
            bestOverlap = overlap;
            matchedFact = existingFact;
          }
        }

        if (matchedFact) {
          const exists = matchedFact.citations.some(
            (c) => c.channelId === citation.channelId
          );
          if (!exists) {
            matchedFact.citations.push(citation);
            matchedFact.citations.sort((a, b) =>
              String(a.publishedAt).localeCompare(String(b.publishedAt))
            );
          }
          attachedToAnyFact = true;
        } else if (!addedNewFactFromThisArticle && facts.length < 14) {
          const itemDateOnly = String(it.publishedAt || '').slice(0, 10);
          const sameDayFactCount = facts.filter(
            (f) => String(f.addedAt || '').slice(0, 10) === itemDateOnly
          ).length;
          if (sameDayFactCount >= 5) {
            continue;
          }

          // 새로운 문장 추가: 이 문장이 최초 보도 이후 '새로운 키워드/단서'를 추가했거나 다음 날 이후 후속(추가) 보도인지 계산
          const sentKw = extractKeywordsAndCompounds(sent);
          const newlyAddedKeywords = sentKw.allCompounds
            .filter(
              (cp) =>
                !isGenericOrDatePhrase(cp) &&
                !cp.split(' ').every((w) => knownIssueTokens.has(w))
            )
            .slice(0, 2);

          if (newlyAddedKeywords.length === 0) {
            for (const sg of sentKw.singleTokens) {
              if (!knownIssueTokens.has(sg) && !isGenericOrDatePhrase(sg)) {
                newlyAddedKeywords.push(sg);
                if (newlyAddedKeywords.length >= 2) break;
              }
            }
          }

          const isFollowUpDate =
            Boolean(itemDateOnly) && itemDateOnly > firstDate;

          if (
            facts.length === 0 ||
            newlyAddedKeywords.length > 0 ||
            isFollowUpDate
          ) {
            for (const sg of sentKw.singleTokens) {
              knownIssueTokens.add(sg);
            }

            const isNewFactAdded =
              itemIdx > 0 && (newlyAddedKeywords.length > 0 || isFollowUpDate);

            facts.push({
              factId: `${issueId}-f${facts.length + 1}`,
              sentence: sent,
              addedAt: it.publishedAt,
              firstMentionedAt: citation.publishedAt,
              firstMentionChannel: citation.channelName,
              isNewFactAdded,
              addedKeywords: isNewFactAdded ? newlyAddedKeywords : [],
              citations: [{ ...citation, isFirstMention: true, order: 1 }],
            });
            attachedToAnyFact = true;
            addedNewFactFromThisArticle = true;
          }
        }
      }

      // 클러스터 내 기사인데 문장이 추가되지 않은 경우, 가장 유사도가 높은 기존 팩트 문장(또는 대표 팩트 문장)의 후속 보도로 연결
      if (!attachedToAnyFact && facts.length > 0) {
        let targetFact = facts[0];
        let maxOv = -1;
        const fullText = [it.title, ...(it.sentences || [])].join(' ');
        for (const f of facts) {
          const ov = computeCoreWordOverlapRatio(f.sentence, fullText);
          if (ov > maxOv) {
            maxOv = ov;
            targetFact = f;
          }
        }
        const exists = targetFact.citations.some(
          (c) => c.channelId === citation.channelId
        );
        if (!exists) {
          targetFact.citations.push(citation);
          targetFact.citations.sort((a, b) =>
            String(a.publishedAt).localeCompare(String(b.publishedAt))
          );
        }
      }
    }

    // 문장별 최초 보도 재정렬 보장 (어제 날짜 보도가 들어오면 최초 보도 매체가 어제 날짜 매체로 자동 갱신됨)
    for (const f of facts) {
      f.citations.sort((a, b) =>
        String(a.publishedAt).localeCompare(String(b.publishedAt))
      );
      if (f.citations[0]) {
        f.firstMentionedAt = f.citations[0].publishedAt;
        f.firstMentionChannel = f.citations[0].channelName;
        f.citations[0].isFirstMention = true;
      }
    }

    // 급상승 검색어(Google Trends KR)와 매칭 여부 확인
    let matchedTrend = null;
    for (const tr of publicTrends) {
      const trTokens = tr.keyword.split(/\s+/);
      const isMatched =
        cl.specificKeywords.some((kw) => kw.includes(tr.keyword) || tr.keyword.includes(kw)) ||
        trTokens.some((tk) => tk.length >= 2 && primaryEventKeyword.includes(tk));
      if (isMatched) {
        matchedTrend = tr;
        break;
      }
    }

    // 언론 보도 강도 점수 (Media Push Score: 0~100, 해당 일자 최대치 기준)
    const dayMaxMentions = maxMentionsByDate.get(firstDate) || 10;
    const dayMaxViews = maxMaturedViewsByDate.get(firstDate) || 1;
    const uniqueChannelsCount = Object.keys(byChannel).length;
    const mediaPushScore = Math.min(
      100,
      Math.round(
        (sortedItems.length / dayMaxMentions) * 55 +
          (uniqueChannelsCount / 12) * 35 +
          (newspaperCount > 0 && broadcastCount > 0 ? 10 : 0)
      )
    );

    // 실제 대중 소비·검색 점수 (Public Pull Score: 0~100)
    const viewRatio =
      dayMaxViews > 0
        ? Math.log10(1 + viewMetrics.maturedViews) /
          Math.log10(1 + dayMaxViews)
        : 0;
    const trendBonus = matchedTrend ? 25 : 0;
    const publicPullScore = Math.min(
      100,
      Math.round(
        viewRatio * 65 +
          Math.min(15, viewMetrics.likes / 30) +
          trendBonus
      )
    );

    let gapType = 'BALANCED';
    let evaluationLabel = '언론 보도 일반 관심';
    let remarkLabel = '';
    if (publicPullScore - mediaPushScore >= 12) {
      gapType = 'PUBLIC_VIRAL';
      evaluationLabel = '언론 과소보도';
      remarkLabel = '언론 과소';
    } else if (mediaPushScore - publicPullScore >= 15) {
      gapType = 'MEDIA_PUSH';
      evaluationLabel = '언론 과대보도';
      remarkLabel = '언론 과대';
    } else if (publicPullScore < 28) {
      gapType = 'LOW_INTEREST';
      evaluationLabel = '언론에 관심없음';
      remarkLabel = '';
    } else {
      gapType = 'BALANCED';
      evaluationLabel = '언론 보도 일반 관심';
      remarkLabel = '';
    }

    // 개별 기사 제목의 방송 코너명/태그 제거 후 깔끔한 이슈 요약 제목 생성
    const cleanedSummaryTitle = String(sortedItems[0].title || '')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\/[^\s/]+(\([^)]*\))?$/g, ' ')
      .replace(/#[A-Za-z0-9가-힣_]+/g, ' ')
      .replace(/｜.*$/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Top10 자격 판별: 최소 3건 이상 보도 & 2개 이상 매체 & 구체적 사건 키워드 보유
    const qualifiesForTop10 =
      sortedItems.length >= 3 &&
      uniqueChannelsCount >= 2 &&
      !isGenericOrDatePhrase(primaryEventKeyword);

    issueCards.push({
      uuid: issueUuid,
      issueId,
      eventTitle: primaryEventKeyword,
      title: cleanedSummaryTitle || primaryEventKeyword,
      representativeKeywords: cl.specificKeywords,
      qualifiesForTop10,
      firstReportedAt: sortedItems[0].publishedAt,
      firstReportedChannel: sortedItems[0].channelName,
      firstReportedUrl:
        sortedItems[0].sourceUrl ||
        sortedItems[0].originalUrl ||
        sortedItems[0].portalUrl,
      latestReportedAt: sortedItems[sortedItems.length - 1].publishedAt,
      mentionStats: {
        totalCount: sortedItems.length,
        newspaperCount,
        broadcastCount,
        uniqueChannelsCount,
        byChannel,
      },
      impactMetrics: {
        mediaPushScore,
        publicPullScore,
        gapScore: publicPullScore - mediaPushScore,
        gapType,
        evaluationLabel,
        remarkLabel,
        rawYoutubeViews: viewMetrics.rawViews,
        matured48hViews: viewMetrics.maturedViews,
        youtubeLikes: viewMetrics.likes,
        matchedTrendKeyword: matchedTrend ? matchedTrend.keyword : null,
        matchedTrendTraffic: matchedTrend ? matchedTrend.trafficText : null,
      },
      facts,
    });
  }

  // Raw 스크립트 보관/폐기 처리
  let markedProcessedFiles = 0;
  let purgedFilesCount = 0;
  let purgedBytes = 0;

  for (const rf of rawFiles) {
    const expireDate = addDaysToDateStr(rf.dateStr, retentionDays);
    const isExpired = todayStr >= expireDate;

    if (purgeProcessed || (purgeExpired && isExpired)) {
      try {
        fs.unlinkSync(rf.fullPath);
        purgedFilesCount += 1;
        purgedBytes += rf.sizeBytes;
        const dayDir = path.dirname(rf.fullPath);
        if (fs.existsSync(dayDir) && fs.readdirSync(dayDir).length === 0) {
          fs.rmdirSync(dayDir);
        }
      } catch (err) {
        console.warn(`[Purge] 파일 삭제 실패 (${rf.fullPath}):`, err.message);
      }
    } else if (!rf.data.processed) {
      rf.data.processed = true;
      rf.data.processedAt = new Date().toISOString();
      rf.data.retentionExpireDate = expireDate;
      fs.writeFileSync(rf.fullPath, JSON.stringify(rf.data, null, 2), 'utf-8');
      markedProcessedFiles += 1;
    }
  }

  for (const chEntry of Object.values(checkpointState.channels || {})) {
    chEntry.lastProcessedAt = new Date().toISOString();
  }
  saveCheckpoints(checkpointState);

  const articleRecords = allItems.map((it) => ({
    id: it.itemId,
    ch: it.channelId,
    dt: String(it.publishedAt || it.dateStr || todayStr).slice(0, 10),
    t: String(it.title || ''),
    b: (it.sentences || []).slice(0, 3).join(' ').slice(0, 240),
    u: it._issueUuid || null,
  }));

  // CI(GitHub Actions 등) 또는 Raw 파일 일부 폐기 환경에서 기존 issues-summary.json의 과거 날짜 이슈가 유실되지 않도록 병합 보존
  const activeRawDateSet = new Set(rawFiles.map((rf) => rf.dateStr));
  if (fs.existsSync(ISSUES_SUMMARY_PATH)) {
    try {
      const prevSummary = JSON.parse(
        fs.readFileSync(ISSUES_SUMMARY_PATH, 'utf-8')
      );
      const existingIds = new Set(issueCards.map((c) => c.issueId));
      for (const prevIssue of prevSummary.issues || []) {
        const prevDate = String(prevIssue.latestReportedAt || '').slice(0, 10);
        if (
          prevDate &&
          !activeRawDateSet.has(prevDate) &&
          !existingIds.has(prevIssue.issueId)
        ) {
          if (!prevIssue.uuid) {
            prevIssue.uuid = generateDeterministicUuid(prevIssue.issueId);
          }
          issueCards.push(prevIssue);
          existingIds.add(prevIssue.issueId);
        }
      }
      const existingArtIds = new Set(articleRecords.map((a) => a.id));
      for (const prevArt of prevSummary.articleRecords || []) {
        if (
          prevArt.dt &&
          !activeRawDateSet.has(prevArt.dt) &&
          !existingArtIds.has(prevArt.id)
        ) {
          articleRecords.push(prevArt);
          existingArtIds.add(prevArt.id);
        }
      }
    } catch {
      // ignore parse error
    }
  }

  issueCards.sort(
    (a, b) =>
      b.mentionStats.totalCount - a.mentionStats.totalCount ||
      String(b.latestReportedAt).localeCompare(String(a.latestReportedAt))
  );

  const qualifiedTop10Count = issueCards.filter(
    (i) => i.qualifiesForTop10
  ).length;

  const summaryPayload = {
    version: '1.2.0',
    generatedAt: new Date().toISOString(),
    retentionPolicy: {
      retentionDays,
      autoPurgeEnabled: true,
      purgedFilesInLastRun: purgedFilesCount,
      purgedBytesInLastRun: purgedBytes,
    },
    storageSummary: checkpointState.storageSummary,
    totalScriptsAnalyzed: articleRecords.length,
    totalIssuesCount: issueCards.length,
    qualifiedTop10Count: Math.min(10, qualifiedTop10Count),
    publicSearchTrends: publicTrends,
    recommendedKeywords,
    issues: issueCards,
    articleRecords,
  };

  fs.mkdirSync(path.dirname(ISSUES_SUMMARY_PATH), { recursive: true });
  fs.writeFileSync(
    ISSUES_SUMMARY_PATH,
    JSON.stringify(summaryPayload, null, 2),
    'utf-8'
  );

  console.log(
    `[IssueProcessor] 구체적 사건 이슈 ${issueCards.length}개 (Top10 적격: ${Math.min(10, qualifiedTop10Count)}개), 추천 사건키워드 ${recommendedKeywords.length}개 생성 완료!`
  );
  return summaryPayload;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
) {
  runIssueProcessorAndPurge().catch((err) => {
    console.error('[IssueProcessor] 오류:', err);
    process.exit(1);
  });
}
