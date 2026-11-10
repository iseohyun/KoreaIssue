/**
 * Stage 0: 언론사 포털(정답지) vs 공식 RSS/원문 파싱 비교 분석기 & 방송사 유튜브 자막/대본 활용성 진단 도구
 * - 출력 파일: `public/data/parser-analysis-report.json`
 * - 기능:
 *   1) 종합일간지 Top 10:
 *      - 네이버 언론사별 목록(정답지) 수집 및 원문 링크(`originallink`), 기사 입력 시각(`publishedAt`) 추출 검증
 *      - 언론사 공식 RSS 피드 응답 상태, 아이템 수, RSS 내 본문 포함 수준(전문/요약/없음),
 *        그리고 언론사 원문 웹페이지 직접 파싱 시 사용할 메타태그(`article:published_time`, JSON-LD, 본문 컨테이너) 자동 진단
 *   2) 주요 방송사 9곳 (유튜브 공식 채널 1:1):
 *      - 유튜브 채널 ID 및 공식 RSS(`feeds/videos.xml`) 정상 작동 여부 확인 (핸들 기반 자동 보정 포함)
 *      - 영상 설명란(`media:description`)에 뉴스 리포트 대본 전문이 포함되어 있는지 비율/길이 측정
 *      - 유튜브 영상 페이지 내 기본 제공 자막 트랙(`captionTracks` 한국어 수동/자동자막) 존재 및 즉시 추출 가능 여부 확인
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT_DIR,
  REGISTRY_PATH,
  loadChannelRegistry,
  getKstDateString,
} from './crawl-checkpoint-manager.mjs';

export const PARSER_REPORT_PATH = path.join(
  ROOT_DIR,
  'public',
  'data',
  'parser-analysis-report.json'
);

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/**
 * 타임아웃 및 인코딩(UTF-8 / EUC-KR 자동 감지)을 지원하는 HTTP 텍스트 Fetcher
 */
export async function fetchTextSafe(url, timeoutMs = 10000, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        ...extraHeaders,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const headAscii = buf.subarray(0, 1024).toString('latin1').toLowerCase();

    let encoding = 'utf-8';
    if (
      contentType.includes('euc-kr') ||
      contentType.includes('ks_c_5601') ||
      headAscii.includes('charset=euc-kr') ||
      headAscii.includes('encoding="euc-kr"')
    ) {
      encoding = 'euc-kr';
    }

    const decoder = new TextDecoder(encoding, { fatal: false });
    const text = decoder.decode(buf);
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url,
      contentType,
      encoding,
      text,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      contentType: '',
      encoding: 'utf-8',
      text: '',
      error: err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HTML 엔티티 및 CDATA 제거 유틸리티
 */
export function cleanXmlText(raw = '') {
  return String(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#039;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 원문 웹페이지 HTML에서 날짜/본문 파싱을 위한 구조(JSON-LD, OpenGraph, 시맨틱 태그) 진단
 */
function inspectOriginalArticleDom(html = '') {
  const hasOgPublishedTime =
    /property=["']article:published_time["']/i.test(html) ||
    /name=["']article:published_time["']/i.test(html);
  const hasJsonLd = /<script[^>]*type=["']application\/ld\+json["']/i.test(
    html
  );
  const hasArticleTag = /<article[\s>]/i.test(html);

  const detectedSelectors = [];
  if (hasOgPublishedTime) detectedSelectors.push('meta[property="article:published_time"]');
  if (hasJsonLd) detectedSelectors.push('script[type="application/ld+json"]');
  if (hasArticleTag) detectedSelectors.push('<article>');
  if (/id=["']article[_-]?body["']/i.test(html)) detectedSelectors.push('#article-body');
  if (/class=["'][^"']*article[_-]?(body|view|txt|content)/i.test(html)) {
    detectedSelectors.push('.article_body / .article_view');
  }

  return {
    hasOgPublishedTime,
    hasJsonLd,
    hasArticleTag,
    detectedSelectors,
    directParseDifficulty:
      hasJsonLd || (hasOgPublishedTime && hasArticleTag) ? 'EASY' : 'MEDIUM',
  };
}

/**
 * 신문사 1곳에 대한 포털(정답지) vs 공식 RSS 비교 분석
 */
async function analyzeNewspaperChannel(newspaper, targetDateYmd) {
  const portalUrl = `https://news.naver.com/main/list.naver?mode=LPOD&mid=sec&oid=${newspaper.naverOid}&date=${targetDateYmd}&page=1`;
  const portalRes = await fetchTextSafe(portalUrl);

  // 포털 목록에서 기사 링크 추출
  const articleUrlRegex = new RegExp(
    `https://n\\.news\\.naver\\.com/mnews/article/${newspaper.naverOid}/\\d+`,
    'g'
  );
  const portalLinks = Array.from(
    new Set(portalRes.text.match(articleUrlRegex) || [])
  );

  // 샘플 기사 1건에서 원문 URL(originallink) 및 입력 시각 확인
  let sampleOriginalUrl = '';
  let samplePublishedAt = '';
  let originDomInspection = null;

  if (portalLinks.length > 0) {
    const sampleArtRes = await fetchTextSafe(portalLinks[0]);
    const dateMatch = sampleArtRes.text.match(
      /data-date-time=["'](\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})["']/i
    );
    if (dateMatch) samplePublishedAt = dateMatch[1];

    const origMatch = sampleArtRes.text.match(
      /href=["'](https?:\/\/[^"']+)["'][^>]*class=["'][^"']*media_end_head_origin_link/i
    ) ||
      sampleArtRes.text.match(
        /class=["'][^"']*media_end_head_origin_link[^"']*["'][^>]*href=["'](https?:\/\/[^"']+)["']/i
      );
    if (origMatch) {
      sampleOriginalUrl = origMatch[1];
      const origRes = await fetchTextSafe(sampleOriginalUrl, 8000);
      if (origRes.ok && origRes.text) {
        originDomInspection = inspectOriginalArticleDom(origRes.text);
      }
    }
  }

  // 공식 RSS 피드 점검
  const rssDiagnostics = [];
  for (const rssEntry of newspaper.officialRssUrls || []) {
    const rssRes = await fetchTextSafe(rssEntry.url, 8000);
    const itemMatches = rssRes.text.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    const urlMatches = rssRes.text.match(/<url[\s>][\s\S]*?<\/url>/gi) || [];
    const totalItems = itemMatches.length || urlMatches.length;

    let hasPubDate = false;
    let avgDescLength = 0;
    let contentProvideLevel = 'NONE';

    if (itemMatches.length > 0) {
      const sampleItems = itemMatches.slice(0, 5);
      hasPubDate = sampleItems.some((it) => /<(pubDate|dc:date)>/i.test(it));
      const lengths = sampleItems.map((it) => {
        const descMatch =
          it.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i) ||
          it.match(/<description>([\s\S]*?)<\/description>/i);
        return descMatch ? cleanXmlText(descMatch[1]).length : 0;
      });
      avgDescLength = Math.round(
        lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length)
      );
      if (avgDescLength >= 350) contentProvideLevel = 'FULL_TEXT';
      else if (avgDescLength >= 40) contentProvideLevel = 'SUMMARY_ONLY';
      else contentProvideLevel = 'TITLE_AND_LINK_ONLY';
    } else if (urlMatches.length > 0) {
      contentProvideLevel = 'SITEMAP_URLS_ONLY';
    }

    rssDiagnostics.push({
      section: rssEntry.section,
      url: rssEntry.url,
      reachable: rssRes.ok && totalItems > 0,
      httpStatus: rssRes.status,
      encoding: rssRes.encoding,
      itemCount: totalItems,
      hasPubDate,
      avgDescriptionChars: avgDescLength,
      contentProvideLevel,
    });
  }

  const workingRss = rssDiagnostics.filter((r) => r.reachable);
  let parsingStrategyRecommendation = '';
  if (workingRss.some((r) => r.contentProvideLevel === 'FULL_TEXT')) {
    parsingStrategyRecommendation =
      '공식 RSS에 본문 전문이 포함되어 있어 RSS 단독 수집 가능 (과거 날짜 백필 시에만 포털 정답지 병행)';
  } else if (workingRss.length > 0) {
    parsingStrategyRecommendation =
      '공식 RSS는 요약/링크만 제공하므로, RSS에서 URL 수집 후 원문 페이지의 JSON-LD / <article> 본문 파싱 결합 필요';
  } else {
    parsingStrategyRecommendation =
      '공식 RSS 접근 불가 또는 Sitemap 전용 — 포털 정답지 수집 후 원문 링크(originallink) 메타데이터 매핑 권장';
  }

  return {
    channelId: newspaper.id,
    name: newspaper.name,
    rank: newspaper.rank,
    naverOid: newspaper.naverOid,
    portalGroundTruth: {
      reachable: portalRes.ok && portalLinks.length > 0,
      page1ArticleCount: portalLinks.length,
      samplePublishedAt,
      sampleOriginalUrl,
    },
    officialRssDiagnostics: rssDiagnostics,
    originalArticleDom: originDomInspection,
    parsingStrategyRecommendation,
  };
}

/**
 * 유튜브 핸들 페이지(`@handle`)에서 실제 `channelId` (`UC...`) 추출
 */
async function resolveYoutubeChannelIdFromHandle(handleUrl) {
  const res = await fetchTextSafe(handleUrl, 10000);
  if (!res.ok || !res.text) return null;
  const m =
    res.text.match(/"externalId":"(UC[a-zA-Z0-9_-]{22})"/) ||
    res.text.match(/channel_id=(UC[a-zA-Z0-9_-]{22})/) ||
    res.text.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
  return m ? m[1] : null;
}

/**
 * 유튜브 단일 영상 페이지에서 기본 제공 자막 트랙(`captionTracks`) 및 설명란 대본 확인
 */
async function inspectYoutubeVideoCaptions(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=ko`;
  const res = await fetchTextSafe(watchUrl, 10000);
  if (!res.ok || !res.text) {
    return { watchPageReachable: false, hasCaptionTracks: false, tracks: [] };
  }

  const tracksMatch = res.text.match(/"captionTracks":(\[[\s\S]*?\])/);
  if (!tracksMatch) {
    return {
      watchPageReachable: true,
      hasCaptionTracks: false,
      tracks: [],
    };
  }

  try {
    const rawTracks = JSON.parse(tracksMatch[1]);
    const tracks = rawTracks.map((t) => ({
      languageCode: t.languageCode,
      kind: t.kind || 'manual',
      name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode,
      hasBaseUrl: Boolean(t.baseUrl),
    }));
    return {
      watchPageReachable: true,
      hasCaptionTracks: tracks.length > 0,
      tracks,
    };
  } catch {
    return {
      watchPageReachable: true,
      hasCaptionTracks: false,
      tracks: [],
    };
  }
}

/**
 * 방송사 공식 유튜브 채널 1곳에 대한 RSS·설명란 대본·자막 트랙 진단
 */
async function analyzeBroadcasterChannel(broadcaster, targetDateYmd) {
  let channelId = broadcaster.youtubeChannelId;
  let rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  let rssRes = await fetchTextSafe(rssUrl, 10000);

  // 만약 기본 등록된 channelId로 RSS가 열리지 않으면 @handle 페이지에서 실제 channelId 역추적
  if (!rssRes.ok || !/<entry>/i.test(rssRes.text)) {
    const resolvedId = await resolveYoutubeChannelIdFromHandle(
      broadcaster.youtubeChannelUrl
    );
    if (resolvedId && resolvedId !== channelId) {
      channelId = resolvedId;
      rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
      rssRes = await fetchTextSafe(rssUrl, 10000);
    }
  }

  const entryMatches = rssRes.text.match(/<entry>[\s\S]*?<\/entry>/gi) || [];
  let sampleVideoId = '';
  let sampleTitle = '';
  let samplePublishedAt = '';
  let avgDescriptionChars = 0;
  let descriptionHasFullScriptCount = 0;

  const sampleEntries = entryMatches.slice(0, 5);
  const descLengths = [];

  for (const entryXml of sampleEntries) {
    const vidMatch = entryXml.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i);
    const titleMatch = entryXml.match(/<title>([\s\S]*?)<\/title>/i);
    const pubMatch = entryXml.match(/<published>([^<]+)<\/published>/i);
    const descMatch = entryXml.match(
      /<media:description>([\s\S]*?)<\/media:description>/i
    );

    if (!sampleVideoId && vidMatch) {
      sampleVideoId = vidMatch[1].trim();
      sampleTitle = titleMatch ? cleanXmlText(titleMatch[1]) : '';
      samplePublishedAt = pubMatch ? pubMatch[1].trim() : '';
    }

    const descText = descMatch ? cleanXmlText(descMatch[1]) : '';
    descLengths.push(descText.length);
    if (descText.length >= 200) {
      descriptionHasFullScriptCount += 1;
    }
  }

  avgDescriptionChars =
    descLengths.length > 0
      ? Math.round(descLengths.reduce((a, b) => a + b, 0) / descLengths.length)
      : 0;

  // 샘플 영상의 자막 트랙 존재 여부 점검
  let captionCheck = {
    watchPageReachable: false,
    hasCaptionTracks: false,
    tracks: [],
  };
  if (sampleVideoId) {
    captionCheck = await inspectYoutubeVideoCaptions(sampleVideoId);
  }

  // 포털 방송뉴스(네이버 TV뉴스 oid) 보조 확인
  const portalUrl = `https://news.naver.com/main/list.naver?mode=LPOD&mid=sec&oid=${broadcaster.naverOid}&date=${targetDateYmd}&page=1`;
  const portalRes = await fetchTextSafe(portalUrl, 8000);
  const portalArticleRegex = new RegExp(
    `https://n\\.news\\.naver\\.com/mnews/article/${broadcaster.naverOid}/\\d+`,
    'g'
  );
  const portalArticles = Array.from(
    new Set(portalRes.text.match(portalArticleRegex) || [])
  );

  return {
    channelId: broadcaster.id,
    name: broadcaster.name,
    broadcasterName: broadcaster.broadcasterName,
    verifiedYoutubeChannelId: channelId,
    youtubeHandle: broadcaster.youtubeHandle,
    youtubeRssReachable: rssRes.ok && entryMatches.length > 0,
    rssVideoCount: entryMatches.length,
    sampleVideoId,
    sampleTitle,
    samplePublishedAt,
    descriptionScriptAnalysis: {
      avgDescriptionChars,
      fullScriptInDescriptionRatio: `${descriptionHasFullScriptCount}/${sampleEntries.length}`,
      providesScriptInDescription: avgDescriptionChars >= 200,
    },
    youtubeCaptionTrackAnalysis: captionCheck,
    portalBroadcastTranscriptFallback: {
      naverOid: broadcaster.naverOid,
      reachable: portalRes.ok && portalArticles.length > 0,
      page1TranscriptCount: portalArticles.length,
    },
    recommendedTranscriptSource:
      avgDescriptionChars >= 200
        ? '유튜브 영상 설명란(Description) 대본 전문 + 부족 시 자막 트랙/방송사 뉴스 포털 원고 결합'
        : captionCheck.hasCaptionTracks
          ? '유튜브 기본 자막 트랙(TimedText) + 방송사 뉴스 포털 원고 결합'
          : '유튜브 메타데이터 + 방송사 뉴스 원고(포털/홈페이지) 결합',
  };
}

export async function runMediaParserAnalysis() {
  const registry = loadChannelRegistry();
  const yesterdayStr = getKstDateString(-1);
  const targetDateYmd = yesterdayStr.replace(/-/g, '');

  console.log(
    `[ParserAnalyzer] 기준일(${yesterdayStr}) 종합일간지 Top 10 및 방송사 유튜브 9곳 파싱 진단 시작...`
  );

  const newspaperReports = [];
  for (const np of registry.newspapers || []) {
    process.stdout.write(`  - [신문사] ${np.name} (${np.id}) 분석 중... `);
    const rep = await analyzeNewspaperChannel(np, targetDateYmd);
    newspaperReports.push(rep);
    const workingRssCount = rep.officialRssDiagnostics.filter(
      (r) => r.reachable
    ).length;
    console.log(
      `포털기사(1p): ${rep.portalGroundTruth.page1ArticleCount}건 | 유효 RSS: ${workingRssCount}/${rep.officialRssDiagnostics.length}`
    );
  }

  const broadcasterReports = [];
  let registryUpdated = false;
  for (const bc of registry.broadcasters || []) {
    process.stdout.write(`  - [방송사] ${bc.name} (${bc.id}) 분석 중... `);
    const rep = await analyzeBroadcasterChannel(bc, targetDateYmd);
    broadcasterReports.push(rep);

    // 만약 핸들에서 보정된 실제 youtubeChannelId가 다르면 레지스트리도 자동 업데이트
    if (
      rep.verifiedYoutubeChannelId &&
      rep.verifiedYoutubeChannelId !== bc.youtubeChannelId
    ) {
      bc.youtubeChannelId = rep.verifiedYoutubeChannelId;
      bc.youtubeRssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${rep.verifiedYoutubeChannelId}`;
      registryUpdated = true;
    }

    console.log(
      `유튜브RSS: ${rep.rssVideoCount}건 | 설명란대본평균: ${rep.descriptionScriptAnalysis.avgDescriptionChars}자 | 자막트랙: ${rep.youtubeCaptionTrackAnalysis.hasCaptionTracks ? '있음' : '없음'}`
    );
  }

  if (registryUpdated) {
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf-8');
    console.log(
      `[ParserAnalyzer] 보정된 유튜브 channelId를 media-channel-registry.json에 반영했습니다.`
    );
  }

  const report = {
    analyzedAt: new Date().toISOString(),
    targetDate: yesterdayStr,
    summary: {
      newspapersAnalyzed: newspaperReports.length,
      newspapersWithWorkingRss: newspaperReports.filter((n) =>
        n.officialRssDiagnostics.some((r) => r.reachable)
      ).length,
      broadcastersAnalyzed: broadcasterReports.length,
      broadcastersWithYoutubeRss: broadcasterReports.filter(
        (b) => b.youtubeRssReachable
      ).length,
      broadcastersWithDescriptionScript: broadcasterReports.filter(
        (b) => b.descriptionScriptAnalysis.providesScriptInDescription
      ).length,
      broadcastersWithCaptionTracks: broadcasterReports.filter(
        (b) => b.youtubeCaptionTrackAnalysis.hasCaptionTracks
      ).length,
    },
    newspapers: newspaperReports,
    broadcasters: broadcasterReports,
  };

  fs.mkdirSync(path.dirname(PARSER_REPORT_PATH), { recursive: true });
  fs.writeFileSync(PARSER_REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
  console.log(
    `[ParserAnalyzer] 파서 분석 리포트 저장 완료 -> ${PARSER_REPORT_PATH}`
  );
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
) {
  runMediaParserAnalysis().catch((err) => {
    console.error('[ParserAnalyzer] 오류:', err);
    process.exit(1);
  });
}
