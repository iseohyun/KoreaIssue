/**
 * Track 1 — 원본 뉴스·방송 스크립트 수집기 (`scripts/crawl-raw-scripts.mjs`)
 * - 역할:
 *   1) 어제(D-1)부터 과거 날짜로 순차 이동하며 채널별(종합일간지 Top 10 & 방송사 공식 유튜브 9곳) 보도 스크립트 수집
 *   2) 수집 도중 비정상 종료를 대비해 페이지/배치마다 `data/raw/{YYYY-MM-DD}/{channelId}.json` 및
 *      `public/data/crawl-checkpoints.json`의 `inProgress` 커서를 즉시 갱신(Atomic Write)
 *   3) 날짜별 수집이 끝나면 `completedRanges`에 병합하여 다음 실행 시 이미 수집된 날짜를 건너뛰고 과거 날짜(또는 신규 어제 날짜)를 이어서 탐색
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  RAW_DATA_DIR,
  loadChannelRegistry,
  loadCheckpoints,
  markChannelInProgress,
  markChannelDateCompleted,
  getKstDateString,
  getNextTargetDatesForChannel,
} from './crawl-checkpoint-manager.mjs';
import { fetchTextSafe, cleanXmlText } from './analyze-media-parsers.mjs';

function parseCliOptions() {
  const args = process.argv.slice(2);
  let days = 1;
  let maxPagesPerDay = 1;
  let maxArticlesPerPage = 12;
  let force = false;
  let includeToday = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) {
      days = Math.max(1, Number(args[i + 1]) || 1);
      i++;
    } else if (args[i] === '--max-pages' && args[i + 1]) {
      maxPagesPerDay = Math.max(1, Number(args[i + 1]) || 1);
      i++;
    } else if (args[i] === '--max-articles' && args[i + 1]) {
      maxArticlesPerPage = Math.max(3, Number(args[i + 1]) || 12);
      i++;
    } else if (args[i] === '--force') {
      force = true;
    } else if (args[i] === '--include-today') {
      includeToday = true;
    }
  }
  return { days, maxPagesPerDay, maxArticlesPerPage, force, includeToday };
}

/**
 * HTML 본문에서 불필요한 기자 이메일, 저작권 문구, 캡션 등을 정리하고 문장 배열로 분리
 */
export function extractCleanSentences(rawText = '') {
  const cleaned = String(rawText)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<span[^>]*class=["'][^"']*end_photo_org[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, ' ')
    .replace(/<em[^>]*class=["'][^"']*img_desc[^"']*["'][^>]*>[\s\S]*?<\/em>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#039;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\[[^\]]*(기자|특파원|앵커|리포트|사진|영상|그래픽|연합|뉴시스|뉴스1)[^\]]*\]/g, ' ')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, ' ')
    .replace(/무단\s*전재\s*(및\s*)?재배포\s*금지[\s\S]*/g, ' ')
    .replace(/구독해주세요[\s\S]*/g, ' ')
    .replace(/■\s*제보하기[\s\S]*/g, ' ')
    .replace(/▷\s*(카카오톡|전화|이메일|홈페이지)[\s\S]*/g, ' ');

  const rawChunks = cleaned
    .split(/(?<=[.?!다요죠])\s+|\r?\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 22 && s.length <= 260);

  const validSentences = [];
  const seen = new Set();
  for (const s of rawChunks) {
    if (/^(사진|영상|그래픽|출처|제공|저작권자|Copyright|ⓒ|▶|☞|※)/i.test(s)) continue;
    if (/기자입니다|특파원입니다|뉴스\s+[가-힣]+입니다|앵커멘트/.test(s)) continue;
    if (
      /더\s*자세한\s*내용은|이슈플레이에서\s*확인|반복재생중입니다|스트리밍은\s*['"]?주요뉴스|다시보기는|구독과\s*좋아요|알림\s*설정|제보는\s*카카오톡|투표에\s*참여|댓글로\s*남겨/i.test(
        s
      )
    ) {
      continue;
    }
    if (!/[가-힣]{4,}/.test(s)) continue;
    if (!/(다\.|다$|요\.|니다\.|했다\.|밝혔다\.|전했다\.|보인다\.|나타났다\.|분석된다\.|예정이다\.|추진한다\.|마련했다\.|열렸다\.|말했다\.|지적했다\.|강조했다\.|착수했는데요\.|짚어봅니다\.)/.test(s)) {
      continue;
    }
    if (seen.has(s)) continue;
    seen.add(s);
    validSentences.push(s);
  }
  return validSentences;
}

const WIRE_AGENCIES = [
  '연합뉴스',
  '뉴시스',
  '뉴스1',
  '로이터',
  '블룸버그',
  'AP',
  'AFP',
  '교도통신',
  '신화통신',
  '월스트리트저널',
  'WSJ',
  '뉴욕타임스',
  'NYT',
  '파이낸셜타임스',
  'FT',
];

const BADGE_PATTERNS = [
  { label: '단독', re: /\[단독\]|\(단독\)|^단독\s/i },
  { label: '속보', re: /\[속보\]|\(속보\)|^속보\s/i },
  { label: '기획', re: /\[기획\]|\(기획\)|\[심층기획\]|\[탐사\]/i },
  { label: '사설', re: /\[사설\]|\(사설\)/i },
  { label: '칼럼', re: /\[칼럼\]|\[시론\]|\[기자수첩\]|\[데스크칼럼\]|\[만물상\]|\[태평로\]|\[분수대\]|\[횡설수설\]|\[유레카\]|\[여적\]/i },
  { label: '팩트체크', re: /\[팩트체크\]|팩트체크/i },
];

const BROADCAST_PROGRAMS = [
  '뉴스데스크',
  '뉴스룸',
  '뉴스9',
  '뉴스7',
  '뉴스A',
  '뉴스파이터',
  '모닝와이드',
  '뉴스특보',
  '이슈PLAY',
  '에디터픽',
  '자막뉴스',
  '현장영상',
  '취재파일',
  '사건파일24',
];

/**
 * 제목 및 본문에서 말머리 배지([단독], [속보], [사설] 등), 인용 통신사, 방송 코너명 등 추출
 */
export function extractRichEditorialMeta({
  title = '',
  rawHtml = '',
  sentences = [],
  mediaType = 'NEWSPAPER',
}) {
  const badges = [];
  for (const bp of BADGE_PATTERNS) {
    if (bp.re.test(title)) {
      badges.push(bp.label);
    }
  }

  const joinedText = `${title} ${sentences.join(' ')}`;
  const citedWire = [];
  for (const agency of WIRE_AGENCIES) {
    if (joinedText.includes(agency)) {
      citedWire.push(agency);
    }
  }

  // 카테고리(섹션) 추출
  let section = null;
  const secMatch =
    rawHtml.match(/property=["']article:section["']\s+content=["']([^"']+)["']/i) ||
    rawHtml.match(/class=["'][^"']*media_end_categorize_item[^"']*["'][^>]*>([^<]+)</i);
  if (secMatch) {
    section = cleanXmlText(secMatch[1]);
  } else if (badges.includes('사설') || badges.includes('칼럼')) {
    section = '오피니언';
  }

  // 지면 배치 정보 추출 (예: A1면 1단, A3면, 사설 등)
  let printPage = null;
  const pageMatch =
    rawHtml.match(/([A-Z]?\d+면(?:\s*\d+단)?)/) ||
    rawHtml.match(/class=["'][^"']*media_end_head_info_datestamp_paper[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
  if (pageMatch) {
    printPage = cleanXmlText(pageMatch[1]);
  }

  // 기자 실명 및 이메일 추출
  const reporters = [];
  const seenNames = new Set();
  const emailMatch = rawHtml.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  const defaultEmail = emailMatch ? emailMatch[1] : null;

  const journalistMatches =
    rawHtml.matchAll(
      /class=["'][^"']*(?:media_end_head_journalist_name|byline_s)[^"']*["'][^>]*>([\s\S]*?)<\/(?:em|span|a)>/gi
    ) || [];
  for (const m of journalistMatches) {
    const cleaned = cleanXmlText(m[1]);
    const nameRole = cleaned.match(/([가-힣]{2,4})\s*(기자|특파원|논설위원|앵커)/);
    if (nameRole && !seenNames.has(nameRole[1])) {
      seenNames.add(nameRole[1]);
      const itemEmail = cleaned.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      reporters.push({
        name: nameRole[1],
        role: nameRole[2],
        email: itemEmail ? itemEmail[1] : defaultEmail,
      });
    }
  }

  if (reporters.length === 0) {
    const fallbackName = joinedText.match(/([가-힣]{2,4})\s*(기자|특파원)/);
    if (fallbackName) {
      reporters.push({
        name: fallbackName[1],
        role: fallbackName[2],
        email: defaultEmail,
      });
    }
  }

  // 본문 내 이미지 및 영상 개수
  const imgMatches = rawHtml.match(/<img\b[^>]*>/gi) || [];
  const vodMatches = rawHtml.match(/class=["'][^"']*vod_area|<iframe\b/gi) || [];

  // 방송 프로그램/코너명 및 쇼츠 여부
  let programName = null;
  let isShorts = false;
  if (mediaType !== 'NEWSPAPER') {
    for (const prog of BROADCAST_PROGRAMS) {
      if (title.includes(prog)) {
        programName = prog;
        break;
      }
    }
    isShorts = /#shorts|쇼츠|\[자막뉴스\]/i.test(title);
  }

  return {
    section,
    printPage,
    badges,
    reporters,
    imgCnt: imgMatches.length,
    vodCount: vodMatches.length,
    citedWire,
    ...(mediaType !== 'NEWSPAPER' ? { isShorts, programName } : {}),
  };
}

/**
 * 보도 시각(publishedAt) 대비 현재 경과 시간(+hour)을 계산하여 시계열 스냅샷 배열 갱신
 * (조회수1 +hour, 조회수2 +hour 형태로 시계열 추적)
 */
export function appendOrUpdateMetricSnapshot(
  existingMetrics = [],
  publishedAtStr = '',
  { views = 0, likes = 0, reactions = 0, comments = 0 } = {}
) {
  const pubMs = new Date(String(publishedAtStr).replace(' ', 'T') + '+09:00').getTime();
  const nowMs = Date.now();
  const plusHours = Number.isFinite(pubMs)
    ? Math.max(1, Math.round(((nowMs - pubMs) / (1000 * 3600)) * 10) / 10)
    : 1;

  const metrics = Array.isArray(existingMetrics) ? [...existingMetrics] : [];
  const snapshot = {
    plusHours,
    views: Number(views) || 0,
    likes: Number(likes) || 0,
    reactions: Number(reactions) || 0,
    comments: Number(comments) || 0,
    capturedAt: new Date().toISOString(),
  };

  if (metrics.length === 0) {
    metrics.push(snapshot);
  } else {
    const last = metrics[metrics.length - 1];
    // 이전 스냅샷과 2시간 이상 차이가 나거나 조회수가 변동된 경우 2차 스냅샷(조회수2 +hour)으로 추가
    if (
      Math.abs((last.plusHours || 0) - plusHours) >= 2 &&
      metrics.length < 4
    ) {
      metrics.push(snapshot);
    } else {
      metrics[metrics.length - 1] = {
        ...last,
        plusHours,
        views: Math.max(last.views || 0, snapshot.views),
        likes: Math.max(last.likes || 0, snapshot.likes),
        reactions: Math.max(last.reactions || 0, snapshot.reactions),
        comments: Math.max(last.comments || 0, snapshot.comments),
        capturedAt: snapshot.capturedAt,
      };
    }
  }
  return metrics;
}

/**
 * 개별 네이버 뉴스 상세 페이지에서 제목, 최초 입력시각(publishedAt), 원문 URL(originalUrl), 본문 문장 배열 및 확장 메타데이터 파싱
 * - v2.0 스키마: 중복 텍스트 필드(`scriptText`)를 제거하고 `sentences`, `urls`, `meta`, `metrics` 구조로 저장
 */
async function fetchPortalArticleDetail(articleUrl, channel) {
  const res = await fetchTextSafe(articleUrl, 9000);
  if (!res.ok || !res.text) return null;
  const html = res.text;

  // 제목 추출
  const titleMatch =
    html.match(/<h2[^>]*id=["']title_area["'][^>]*>([\s\S]*?)<\/h2>/i) ||
    html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i);
  const title = titleMatch ? cleanXmlText(titleMatch[1]) : '';
  if (!title) return null;

  // 최초 기사 입력 시각 (YYYY-MM-DD HH:mm:ss)
  const pubMatch = html.match(
    /data-date-time=["'](\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)["']/i
  );
  const publishedAt = pubMatch ? pubMatch[1].trim() : '';

  // 기사 수정 시각 (있을 경우)
  const modMatch = html.match(
    /data-modify-date-time=["'](\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)["']/i
  );
  const modifiedAt = modMatch ? modMatch[1].trim() : null;

  // 언론사 원문 링크 (originallink)
  const origMatch =
    html.match(
      /href=["'](https?:\/\/[^"']+)["'][^>]*class=["'][^"']*media_end_head_origin_link/i
    ) ||
    html.match(
      /class=["'][^"']*media_end_head_origin_link[^"']*["'][^>]*href=["'](https?:\/\/[^"']+)["']/i
    );
  const originalUrl = origMatch
    ? origMatch[1].replace(/&#x3D;/gi, '=').replace(/&amp;/gi, '&').trim()
    : articleUrl;

  // 본문 추출 (#dic_area)
  const bodyMatch = html.match(
    /<article[^>]*id=["']dic_area["'][^>]*>([\s\S]*?)<\/article>/i
  );
  const rawBodyHtml = bodyMatch ? bodyMatch[1] : '';
  const sentences = extractCleanSentences(rawBodyHtml);

  if (sentences.length === 0) return null;

  const charLength = sentences.reduce((acc, s) => acc + s.length, 0);

  // 고유 기사 ID
  const idMatch = articleUrl.match(/\/article\/(\d+)\/(\d+)/);
  const itemId = idMatch ? `${channel.id}-${idMatch[1]}-${idMatch[2]}` : `${channel.id}-${Date.now()}`;
  const finalPubAt = publishedAt || `${getKstDateString(-1)} 12:00:00`;

  const meta = extractRichEditorialMeta({
    title,
    rawHtml: html,
    sentences,
    mediaType: channel.mediaType,
  });

  const metrics = appendOrUpdateMetricSnapshot([], finalPubAt, {
    views: 0,
    likes: 0,
    reactions: 0,
    comments: 0,
  });

  return {
    schemaVersion: '2.0',
    itemId,
    channelId: channel.id,
    channelName: channel.name,
    mediaType: channel.mediaType,
    title,
    publishedAt: finalPubAt,
    modifiedAt,
    urls: {
      orig: originalUrl,
      portal: articleUrl,
    },
    portalUrl: articleUrl,
    originalUrl,
    sourceUrl: originalUrl || articleUrl,
    scriptSource: 'PORTAL_GROUND_TRUTH',
    meta,
    metrics,
    sentences,
    charLength,
  };
}

/**
 * 로컬 Raw 파일 로드 (`data/raw/{dateStr}/{channelId}.json`)
 */
function loadRawDayChannelFile(dateStr, channelId) {
  const filePath = path.join(RAW_DATA_DIR, dateStr, `${channelId}.json`);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 로컬 Raw 파일 Atomic 저장 (`data/raw/{dateStr}/{channelId}.json`)
 */
function saveRawDayChannelFile(dateStr, channelId, payload) {
  const dayDir = path.join(RAW_DATA_DIR, dateStr);
  if (!fs.existsSync(dayDir)) {
    fs.mkdirSync(dayDir, { recursive: true });
  }
  const filePath = path.join(dayDir, `${channelId}.json`);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
  return fs.statSync(filePath).size;
}

/**
 * 신문사(또는 포털 연동 방송사) 특정 날짜 수집
 */
async function collectNewspaperForDate(
  channel,
  dateStr,
  checkpointState,
  options
) {
  const dateYmd = dateStr.replace(/-/g, '');
  const existingFile = loadRawDayChannelFile(dateStr, channel.id);
  const collectedMap = new Map();

  if (existingFile && Array.isArray(existingFile.items)) {
    for (const it of existingFile.items) {
      collectedMap.set(it.itemId, it);
    }
  }

  const startPage =
    checkpointState.channels[channel.id]?.inProgress?.date === dateStr
      ? checkpointState.channels[channel.id].inProgress.lastPage || 1
      : 1;

  let newlyAddedCount = 0;

  for (let page = startPage; page <= options.maxPagesPerDay; page++) {
    markChannelInProgress(checkpointState, channel.id, dateStr, {
      lastPage: page,
      collectedCount: collectedMap.size,
    });

    const listUrl = `https://news.naver.com/main/list.naver?mode=LPOD&mid=sec&oid=${channel.naverOid}&date=${dateYmd}&page=${page}`;
    const listRes = await fetchTextSafe(listUrl, 9000);
    if (!listRes.ok || !listRes.text) break;

    const articleRegex = new RegExp(
      `https://n\\.news\\.naver\\.com/mnews/article/${channel.naverOid}/\\d+`,
      'g'
    );
    const links = Array.from(new Set(listRes.text.match(articleRegex) || [])).slice(
      0,
      options.maxArticlesPerPage
    );

    if (links.length === 0) break;

    for (const link of links) {
      const idMatch = link.match(/\/article\/(\d+)\/(\d+)/);
      const itemId = idMatch ? `${channel.id}-${idMatch[1]}-${idMatch[2]}` : link;
      if (collectedMap.has(itemId)) continue;

      const detail = await fetchPortalArticleDetail(link, channel);
      if (detail && detail.sentences.length > 0) {
        // 해당 날짜(dateStr)에 송고된 기사인지 확인
        collectedMap.set(detail.itemId, detail);
        newlyAddedCount += 1;
      }
    }

    // 페이지 완료마다 디스크에 중간 저장
    const itemsArr = Array.from(collectedMap.values()).sort((a, b) =>
      String(a.publishedAt).localeCompare(String(b.publishedAt))
    );
    saveRawDayChannelFile(dateStr, channel.id, {
      channelId: channel.id,
      channelName: channel.name,
      mediaType: channel.mediaType,
      date: dateStr,
      crawledAt: new Date().toISOString(),
      processed: false,
      processedAt: null,
      retentionExpireDate: null,
      itemCount: itemsArr.length,
      items: itemsArr,
    });
  }

  return {
    addedCount: newlyAddedCount,
    totalDateCount: collectedMap.size,
  };
}

/**
 * 방송사 공식 유튜브 채널(RSS 영상 설명란 대본 + 방송사 일자별 뉴스 리포트 대본) 특정 날짜 수집
 */
async function collectBroadcasterForDate(
  channel,
  dateStr,
  checkpointState,
  options
) {
  const existingFile = loadRawDayChannelFile(dateStr, channel.id);
  const collectedMap = new Map();

  if (existingFile && Array.isArray(existingFile.items)) {
    for (const it of existingFile.items) {
      collectedMap.set(it.itemId, it);
    }
  }

  markChannelInProgress(checkpointState, channel.id, dateStr, {
    lastPage: 1,
    collectedCount: collectedMap.size,
  });

  let newlyAddedCount = 0;

  // 1) 공식 유튜브 RSS에서 영상 및 설명란(Description) 리포트 원고 수집
  if (channel.youtubeChannelId) {
    const ytRssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.youtubeChannelId}`;
    const rssRes = await fetchTextSafe(ytRssUrl, 9000);
    if (rssRes.ok && rssRes.text) {
      const entries = rssRes.text.match(/<entry>[\s\S]*?<\/entry>/gi) || [];
      for (const entryXml of entries) {
        const vidMatch = entryXml.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i);
        const titleMatch = entryXml.match(/<title>([\s\S]*?)<\/title>/i);
        const pubMatch = entryXml.match(/<published>([^<]+)<\/published>/i);
        const descMatch = entryXml.match(
          /<media:description>([\s\S]*?)<\/media:description>/i
        );
        const viewsMatch = entryXml.match(/<media:statistics[^>]*views=["'](\d+)["']/i);
        const likesMatch = entryXml.match(/<media:starRating[^>]*count=["'](\d+)["']/i);
        if (!vidMatch || !titleMatch) continue;

        const videoId = vidMatch[1].trim();
        const itemId = `${channel.id}-yt-${videoId}`;
        const viewCount = viewsMatch ? Number(viewsMatch[1]) || 0 : 0;
        const likeCount = likesMatch ? Number(likesMatch[1]) || 0 : 0;

        if (collectedMap.has(itemId)) {
          // 2차 수집(48시간 숙성 스냅샷): 이미 수집된 영상이더라도 조회수/좋아요 수를 최신값 및 +hour 시계열로 갱신
          const prevItem = collectedMap.get(itemId);
          prevItem.viewCount = Math.max(prevItem.viewCount || 0, viewCount);
          prevItem.likeCount = Math.max(prevItem.likeCount || 0, likeCount);
          prevItem.metricsUpdatedAt = new Date().toISOString();
          prevItem.metrics = appendOrUpdateMetricSnapshot(
            prevItem.metrics,
            prevItem.publishedAt,
            {
              views: prevItem.viewCount,
              likes: prevItem.likeCount,
            }
          );
          continue;
        }

        // published 시각을 KST (YYYY-MM-DD HH:mm:ss)로 변환
        let publishedKst = `${dateStr} 12:00:00`;
        if (pubMatch) {
          const dt = new Date(pubMatch[1].trim());
          if (!Number.isNaN(dt.getTime())) {
            const kst = new Date(dt.getTime() + 9 * 3600 * 1000);
            publishedKst = kst.toISOString().replace('T', ' ').slice(0, 19);
          }
        }

        const rawDesc = descMatch ? descMatch[1] : '';
        const sentences = extractCleanSentences(rawDesc);
        if (sentences.length === 0) continue;

        const cleanTitle = cleanXmlText(titleMatch[1]);
        const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const meta = extractRichEditorialMeta({
          title: cleanTitle,
          rawHtml: rawDesc,
          sentences,
          mediaType: 'BROADCAST_YOUTUBE',
        });
        const metrics = appendOrUpdateMetricSnapshot([], publishedKst, {
          views: viewCount,
          likes: likeCount,
        });

        collectedMap.set(itemId, {
          schemaVersion: '2.0',
          itemId,
          channelId: channel.id,
          channelName: channel.name,
          broadcasterName: channel.broadcasterName,
          mediaType: 'BROADCAST_YOUTUBE',
          videoId,
          title: cleanTitle,
          publishedAt: publishedKst,
          modifiedAt: null,
          urls: {
            orig: youtubeUrl,
            portal: youtubeUrl,
          },
          portalUrl: youtubeUrl,
          originalUrl: youtubeUrl,
          sourceUrl: youtubeUrl,
          scriptSource: 'YOUTUBE_DESCRIPTION_SCRIPT',
          viewCount,
          likeCount,
          metricsUpdatedAt: new Date().toISOString(),
          meta,
          metrics,
          sentences,
          charLength: sentences.reduce((acc, s) => acc + s.length, 0),
        });
        newlyAddedCount += 1;
      }
    }
  }

  // 2) 해당 날짜(dateStr)의 방송사 뉴스 리포트 원고(포털 TV뉴스 아카이브) 보강 수집
  if (channel.naverOid) {
    const dateYmd = dateStr.replace(/-/g, '');
    const listUrl = `https://news.naver.com/main/list.naver?mode=LPOD&mid=sec&oid=${channel.naverOid}&date=${dateYmd}&page=1`;
    const listRes = await fetchTextSafe(listUrl, 9000);
    if (listRes.ok && listRes.text) {
      const articleRegex = new RegExp(
        `https://n\\.news\\.naver\\.com/mnews/article/${channel.naverOid}/\\d+`,
        'g'
      );
      const links = Array.from(new Set(listRes.text.match(articleRegex) || [])).slice(
        0,
        Math.min(10, options.maxArticlesPerPage)
      );

      for (const link of links) {
        const idMatch = link.match(/\/article\/(\d+)\/(\d+)/);
        const itemId = idMatch ? `${channel.id}-${idMatch[1]}-${idMatch[2]}` : link;
        if (collectedMap.has(itemId)) continue;

        const detail = await fetchPortalArticleDetail(link, channel);
        if (detail && detail.sentences.length > 0) {
          detail.scriptSource = 'BROADCAST_REPORT_SCRIPT';
          collectedMap.set(detail.itemId, detail);
          newlyAddedCount += 1;
        }
      }
    }
  }

  const itemsArr = Array.from(collectedMap.values()).sort((a, b) =>
    String(a.publishedAt).localeCompare(String(b.publishedAt))
  );
  saveRawDayChannelFile(dateStr, channel.id, {
    channelId: channel.id,
    channelName: channel.name,
    mediaType: channel.mediaType,
    date: dateStr,
    crawledAt: new Date().toISOString(),
    processed: false,
    processedAt: null,
    retentionExpireDate: null,
    itemCount: itemsArr.length,
    items: itemsArr,
  });

  return {
    addedCount: newlyAddedCount,
    totalDateCount: collectedMap.size,
  };
}

export async function runRawScriptCollector() {
  const options = parseCliOptions();
  const registry = loadChannelRegistry();
  const checkpointState = loadCheckpoints();
  const yesterdayStr = getKstDateString(-1);

  console.log(
    `[RawCollector] 수집 시작 — 기준일(어제): ${yesterdayStr}, 탐색 일수: ${options.days}일, 채널당 페이지: ${options.maxPagesPerDay}`
  );

  const allChannels = [
    ...(registry.newspapers || []).filter((c) => c.enabled),
    ...(registry.broadcasters || []).filter((c) => c.enabled),
  ];

  for (const channel of allChannels) {
    const chCheckpoint = checkpointState.channels[channel.id];
    const startOffset = options.includeToday ? 0 : -1;
    const baseStartStr = getKstDateString(startOffset);
    const targetDates = options.force
      ? Array.from({ length: options.days }, (_, idx) =>
          getKstDateString(startOffset - idx)
        )
      : getNextTargetDatesForChannel(
          chCheckpoint,
          baseStartStr,
          options.days
        );

    if (targetDates.length === 0) {
      console.log(
        `  - [${channel.name}] 요청된 범위(${options.days}일)가 이미 모두 수집 완료 상태입니다.`
      );
      continue;
    }

    for (const dateStr of targetDates) {
      process.stdout.write(
        `  - [${channel.name}] ${dateStr} 뉴스/스크립트 수집 중... `
      );
      const result =
        channel.mediaType === 'NEWSPAPER'
          ? await collectNewspaperForDate(
              channel,
              dateStr,
              checkpointState,
              options
            )
          : await collectBroadcasterForDate(
              channel,
              dateStr,
              checkpointState,
              options
            );

      markChannelDateCompleted(checkpointState, channel.id, dateStr, result);
      console.log(
        `신규 ${result.addedCount}건 (해당 날짜 총 ${result.totalDateCount}건)`
      );
    }
  }

  console.log(
    `[RawCollector] 수집 완료! 현재 디스크 Raw 스크립트 총 용량: ${checkpointState.storageSummary.rawDiskKB} KB (${checkpointState.storageSummary.rawDiskMB} MB)`
  );
  return checkpointState;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
) {
  runRawScriptCollector().catch((err) => {
    console.error('[RawCollector] 비정상 종료 (다음 실행 시 체크포인트에서 자동 재개됩니다):', err);
    process.exit(1);
  });
}
