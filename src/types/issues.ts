export type MainMenuView =
  | 'MEDIA_ANALYSIS' // 언론사 분석
  | 'ISSUE_SUMMARY' // 이슈 요약 (기본, 키워드 제공)
  | 'DB_STATS' // 수집DB 통계
  | 'TOP10' // Top10 (그때그때 선정되는 이슈 하위 최대 10개 펼치기/접기)
  | 'ANNUAL_ISSUES' // 연중이슈
  | 'SETTINGS' // 설정
  | 'ABOUT'; // 소개

export type MediaAnalysisTab = 'NEWSPAPER' | 'BROADCAST';
export type IssueSummaryTab =
  | 'TODAY' // 오늘
  | 'THIS_WEEK' // 이번주
  | 'THIS_MONTH' // 이번달
  | 'YESTERDAY' // 어제
  | 'LAST_WEEK' // 저번주
  | 'LAST_MONTH' // 저번달
  | 'SEARCH'; // 검색
export type DbStatsTab = 'CHANNEL_INFO' | 'BROADCAST_SCRIPT' | 'RSS_ANALYSIS';
export type AnnualIssuesTab = 'TABLE' | 'TIMELINE';

export interface DbChannelColumnVisibility {
  category: boolean; // 구분 (기본: false 생략)
  name: boolean; // 채널명 (기본: true 보이기)
  channelId: boolean; // ID (기본: false 생략)
  startDate: boolean; // 수집 시작 (기본: true 보이기)
  endDate: boolean; // 수집 종료 (기본: true 보이기)
  inProgress: boolean; // 중단 복구 커서
  totalCount: boolean; // 누적 수집 건수
  diskSize: boolean; // 로컬 디스크 용량
  lastCrawledAt: boolean; // 마지막 수집 시각
}

export interface AnnualTableColumnVisibility {
  date: boolean;
  title: boolean;
  keywords: boolean;
  newspaperCount: boolean;
  broadcastCount: boolean;
  totalCount: boolean;
  firstChannel: boolean;
  factCount: boolean;
}

export interface IssueFilterState {
  searchQuery: string;
  selectedKeyword: string | null;
  mediaFilter: 'ALL' | 'CROSS_MEDIA' | 'NEWSPAPER_ONLY' | 'BROADCAST_ONLY';
  mediaTypes: Array<'NEWSPAPER' | 'BROADCAST'>;
  shortNameView: boolean;
  selectedChannelId: string;
  minMentionCount: number;
}

export interface ReporterMeta {
  name: string;
  role?: string;
  email: string | null;
}

export interface ArticleEditorialMeta {
  section?: string | null;
  printPage?: string | null;
  badges?: string[];
  reporters?: ReporterMeta[];
  imgCnt?: number;
  vodCount?: number;
  citedWire?: string[];
  isShorts?: boolean;
  programName?: string | null;
}

export interface MetricSnapshot {
  plusHours: number;
  views: number;
  likes: number;
  reactions?: number;
  comments?: number;
  capturedAt: string;
}

export interface CitationItem {
  channelId: string;
  channelName: string;
  mediaType: 'NEWSPAPER' | 'BROADCAST_YOUTUBE' | string;
  publishedAt: string;
  url: string;
  portalUrl?: string;
  articleTitle?: string;
  viewCount?: number;
  likeCount?: number;
  meta?: ArticleEditorialMeta;
  metrics?: MetricSnapshot[];
  isFirstMention?: boolean;
  order?: number;
}

export interface FactItem {
  factId: string;
  sentence: string;
  addedAt: string;
  firstMentionedAt: string;
  firstMentionChannel: string;
  isNewFactAdded?: boolean;
  addedKeywords?: string[];
  citations: CitationItem[];
}

export interface ImpactMetrics {
  mediaPushScore: number;
  publicPullScore: number;
  gapScore: number;
  gapType: 'BIG_ISSUE' | 'MEDIA_PUSH' | 'PUBLIC_VIRAL' | 'BALANCED' | string;
  evaluationLabel?: string;
  remarkLabel?: string;
  rawYoutubeViews: number;
  matured48hViews: number;
  youtubeLikes: number;
  matchedTrendKeyword: string | null;
  matchedTrendTraffic: string | null;
}

export interface IssueCard {
  uuid?: string;
  issueId: string;
  eventTitle?: string;
  title: string;
  representativeKeywords: string[];
  qualifiesForTop10?: boolean;
  firstReportedAt: string;
  firstReportedChannel: string;
  firstReportedUrl?: string;
  latestReportedAt: string;
  mentionStats: {
    totalCount: number;
    newspaperCount: number;
    broadcastCount: number;
    uniqueChannelsCount: number;
    byChannel: Record<string, number>;
  };
  impactMetrics?: ImpactMetrics;
  facts: FactItem[];
}

export interface PublicSearchTrendItem {
  keyword: string;
  trafficText: string;
  trafficVolume: number;
  sampleNewsTitle: string;
}

export interface RecommendedKeyword {
  keyword: string;
  isCompound: boolean;
  articleCount: number;
  channelCount: number;
  score: number;
}

export interface StorageSummary {
  totalChannels: number;
  totalArticlesAndVideos: number;
  rawFilesCount: number;
  rawDiskBytes: number;
  rawDiskKB: number;
  rawDiskMB: number;
  oldestRawDate: string | null;
  newestRawDate: string | null;
}

export interface ArticleIndexRecord {
  id: string;
  ch: string;
  dt: string;
  t: string;
  b: string;
  u: string | null;
}

export interface IssuesSummaryPayload {
  version: string;
  generatedAt: string;
  retentionPolicy: {
    retentionDays: number;
    autoPurgeEnabled: boolean;
    purgedFilesInLastRun: number;
    purgedBytesInLastRun: number;
  };
  storageSummary: StorageSummary;
  totalScriptsAnalyzed: number;
  totalIssuesCount: number;
  qualifiedTop10Count?: number;
  publicSearchTrends?: PublicSearchTrendItem[];
  recommendedKeywords: RecommendedKeyword[];
  issues: IssueCard[];
  articleRecords?: ArticleIndexRecord[];
}

export interface DateRangeItem {
  from: string;
  to: string;
}

export interface ChannelCheckpointEntry {
  channelId: string;
  name: string;
  mediaType: string;
  category: string;
  completedRanges: DateRangeItem[];
  inProgress: {
    date: string;
    lastPage: number;
    collectedCount: number;
    updatedAt: string;
  } | null;
  totalCollectedCount: number;
  rawBytesOnDisk: number;
  lastCrawledAt: string | null;
  lastProcessedAt: string | null;
  lastCompletedDate?: string;
  lastDateItemCount?: number;
}

export interface CheckpointState {
  version: string;
  updatedAt: string;
  retentionDays: number;
  channels: Record<string, ChannelCheckpointEntry>;
  storageSummary: StorageSummary;
}

export interface NewspaperParserDiagnostic {
  channelId: string;
  name: string;
  rank: number;
  naverOid: string;
  portalGroundTruth: {
    reachable: boolean;
    page1ArticleCount: number;
    samplePublishedAt: string;
    sampleOriginalUrl: string;
  };
  officialRssDiagnostics: Array<{
    section: string;
    url: string;
    reachable: boolean;
    httpStatus: number;
    encoding: string;
    itemCount: number;
    hasPubDate: boolean;
    avgDescriptionChars: number;
    contentProvideLevel: string;
  }>;
  originalArticleDom: {
    hasOgPublishedTime: boolean;
    hasJsonLd: boolean;
    hasArticleTag: boolean;
    detectedSelectors: string[];
    directParseDifficulty: string;
  } | null;
  parsingStrategyRecommendation: string;
}

export interface BroadcasterParserDiagnostic {
  channelId: string;
  name: string;
  broadcasterName: string;
  verifiedYoutubeChannelId: string;
  youtubeHandle: string;
  youtubeRssReachable: boolean;
  rssVideoCount: number;
  sampleVideoId: string;
  sampleTitle: string;
  samplePublishedAt: string;
  descriptionScriptAnalysis: {
    avgDescriptionChars: number;
    fullScriptInDescriptionRatio: string;
    providesScriptInDescription: boolean;
  };
  youtubeCaptionTrackAnalysis: {
    watchPageReachable: boolean;
    hasCaptionTracks: boolean;
    tracks: Array<{
      languageCode: string;
      kind: string;
      name: string;
      hasBaseUrl: boolean;
    }>;
  };
  portalBroadcastTranscriptFallback: {
    naverOid: string;
    reachable: boolean;
    page1TranscriptCount: number;
  };
  recommendedTranscriptSource: string;
}

export interface ParserAnalysisReport {
  analyzedAt: string;
  targetDate: string;
  summary: {
    newspapersAnalyzed: number;
    newspapersWithWorkingRss: number;
    broadcastersAnalyzed: number;
    broadcastersWithYoutubeRss: number;
    broadcastersWithDescriptionScript: number;
    broadcastersWithCaptionTracks: number;
  };
  newspapers: NewspaperParserDiagnostic[];
  broadcasters: BroadcasterParserDiagnostic[];
}
