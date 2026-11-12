import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Award,
  BarChart2,
  CalendarRange,
  CheckCircle2,
  Clock,
  Flame,
  HardDrive,
  Info,
  Newspaper,
  RotateCcw,
  Search,
  Settings,
  Tag,
  Tv,
} from 'lucide-react';
import { APP_VERSION_DISPLAY } from './version';
import type {
  AnnualIssuesTab,
  AnnualTableColumnVisibility,
  CheckpointState,
  DbChannelColumnVisibility,
  DbStatsTab,
  FactItem,
  ImpactMetrics,
  IssueCard,
  IssueFilterState,
  IssuesSummaryPayload,
  IssueSummaryTab,
  MainMenuView,
  MediaAnalysisTab,
  ParserAnalysisReport,
  RecommendedKeyword,
} from './types/issues';
import {
  getMediaAlias,
  loadMediaAliases,
  MEDIA_ALIAS_ENTRIES,
  resetMediaAliases,
  saveMediaAliases,
} from './constants/mediaAliases';
import { HeaderBar } from './components/HeaderBar';
import { SidebarDrawer } from './components/SidebarDrawer';
import { MediaAnalysisView } from './components/MediaAnalysisView';
import styles from './App.module.css';

const DEFAULT_FILTERS: IssueFilterState = {
  searchQuery: '',
  selectedKeyword: null,
  mediaFilter: 'ALL',
  mediaTypes: ['NEWSPAPER', 'BROADCAST'],
  shortNameView: true,
  selectedChannelId: 'ALL',
  minMentionCount: 1,
};

const ALL_CHANNEL_IDS = [
  'press-chosun',
  'press-joongang',
  'press-donga',
  'press-hani',
  'press-khan',
  'press-hankook',
  'press-seoul',
  'press-kmib',
  'press-segye',
  'press-munhwa',
  'yt-kbs',
  'yt-mbc',
  'yt-sbs',
  'yt-jtbc',
  'yt-tvchosun',
  'yt-channela',
  'yt-mbn',
  'yt-ytn',
  'yt-yonhaptv',
];

const QUICK_CHANNEL_GROUPS: Array<{
  id: string;
  label: string;
  channelIds: string[];
}> = [
  { id: 'ALL', label: '전체', channelIds: ALL_CHANNEL_IDS },
  {
    id: 'NEWSPAPER_ALL',
    label: '일간지 전체',
    channelIds: ALL_CHANNEL_IDS.filter((id) => id.startsWith('press-')),
  },
  {
    id: 'BROADCAST_ALL',
    label: '방송사 전체',
    channelIds: ALL_CHANNEL_IDS.filter((id) => id.startsWith('yt-')),
  },
  {
    id: 'BROADCAST_3',
    label: '방송3사',
    channelIds: ['yt-kbs', 'yt-mbc', 'yt-sbs'],
  },
  {
    id: 'JONGPYEON',
    label: '종편',
    channelIds: ['yt-jtbc', 'yt-tvchosun', 'yt-channela', 'yt-mbn'],
  },
  {
    id: 'NEWS_CH',
    label: '보도전문',
    channelIds: ['yt-ytn', 'yt-yonhaptv'],
  },
  {
    id: 'BIG3_PRESS',
    label: '조중동',
    channelIds: ['press-chosun', 'press-joongang', 'press-donga'],
  },
];

const DB_CHART_PERIOD_TABS: Array<{ key: IssueSummaryTab; label: string }> = [
  { key: 'TODAY', label: '오늘' },
  { key: 'YESTERDAY', label: '어제' },
  { key: 'THIS_WEEK', label: '이번주' },
  { key: 'LAST_WEEK', label: '저번주' },
  { key: 'THIS_MONTH', label: '이번달' },
  { key: 'LAST_MONTH', label: '저번달' },
];

function resolveNewspaperDomSymbols(selectors: string[] = []): string {
  const symbols: string[] = [];
  for (const s of selectors) {
    if (s.includes('article:published_time')) symbols.push('ㄱ');
    else if (s.includes('application/ld+json')) symbols.push('ㄴ');
    else if (s === '<article>') symbols.push('ㄷ');
    else if (s.includes('#article-body')) symbols.push('ㄹ');
    else if (s.includes('.article_body')) symbols.push('ㅁ');
  }
  return symbols.length > 0 ? symbols.join(' + ') : '-';
}

function resolveNewspaperStrategyFormula(
  hasWorkingRss: boolean,
  contentLevel?: string
): string {
  if (hasWorkingRss && contentLevel === 'FULL_TEXT') {
    return 'A + C';
  }
  if (hasWorkingRss) {
    return 'B + D';
  }
  return 'C + D';
}

/**
 * 3번 요구사항 기본값:
 * 구분(생략: false), 채널명(보이기: true), ID(생략: false), 수집 시작(보이기: true), 수집 종료(보이기: true)
 */
const DEFAULT_DB_COLUMNS: DbChannelColumnVisibility = {
  category: false,
  name: true,
  channelId: false,
  startDate: true,
  endDate: true,
  inProgress: false,
  totalCount: true,
  diskSize: true,
  lastCrawledAt: false,
};

const DEFAULT_ANNUAL_COLUMNS: AnnualTableColumnVisibility = {
  date: true,
  title: true,
  keywords: true,
  newspaperCount: true,
  broadcastCount: true,
  totalCount: true,
  firstChannel: true,
  factCount: true,
};

function formatShortTimestamp(ts: string): string {
  if (!ts) return '';
  const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (m) {
    return `${m[2]}/${m[3]} ${m[4]}:${m[5]}`;
  }
  return ts.slice(0, 16);
}

function getChannelDateBounds(
  ranges: Array<{ from: string; to: string }> = []
): { minStart: string; maxEnd: string } {
  if (!ranges || ranges.length === 0) {
    return { minStart: '-', maxEnd: '-' };
  }
  const starts = ranges.map((r) => r.from).sort();
  const ends = ranges.map((r) => r.to).sort();
  return {
    minStart: starts[0] || '-',
    maxEnd: ends[ends.length - 1] || '-',
  };
}

/**
 * 언론 보도 강도와 대중 소비·검색 비교 평가 문구 산출
 * - 언론 과소보도 / 언론 과대보도 / 언론에 관심없음 / 언론 보도 일반 관심
 */
function resolveEvaluationInfo(metrics?: ImpactMetrics): {
  label: string;
  badgeClass: string;
} {
  const push = metrics?.mediaPushScore ?? 50;
  const pull = metrics?.publicPullScore ?? 35;

  if (metrics?.evaluationLabel) {
    const lbl = metrics.evaluationLabel;
    if (lbl === '언론 과소보도') {
      return { label: lbl, badgeClass: styles.evalBadgeUnder };
    }
    if (lbl === '언론 과대보도') {
      return { label: lbl, badgeClass: styles.evalBadgeOver };
    }
    if (lbl === '언론에 관심없음') {
      return { label: lbl, badgeClass: styles.evalBadgeNoInterest };
    }
    return { label: lbl, badgeClass: styles.evalBadgeNormal };
  }

  if (pull - push >= 12) {
    return { label: '언론 과소보도', badgeClass: styles.evalBadgeUnder };
  }
  if (pull < 28) {
    return { label: '언론에 관심없음', badgeClass: styles.evalBadgeNoInterest };
  }
  if (push - pull >= 15) {
    return { label: '언론 과대보도', badgeClass: styles.evalBadgeOver };
  }
  return { label: '언론 보도 일반 관심', badgeClass: styles.evalBadgeNormal };
}

/**
 * 이슈 요약 상단 비교 표의 [비고] 열 전용:
 * '언론 과대', '언론 과소'만 체크하고 나머지는 빈칸 처리
 */
function resolveTableRemark(metrics?: ImpactMetrics): {
  remark: '' | '언론 과대' | '언론 과소';
  badgeClass: string;
} {
  const push = metrics?.mediaPushScore ?? 50;
  const pull = metrics?.publicPullScore ?? 35;

  if (
    metrics?.remarkLabel === '언론 과소' ||
    metrics?.evaluationLabel === '언론 과소보도' ||
    pull - push >= 12
  ) {
    return { remark: '언론 과소', badgeClass: styles.evalBadgeUnder };
  }
  if (
    metrics?.remarkLabel === '언론 과대' ||
    metrics?.evaluationLabel === '언론 과대보도' ||
    push - pull >= 15
  ) {
    return { remark: '언론 과대', badgeClass: styles.evalBadgeOver };
  }
  return { remark: '', badgeClass: '' };
}

function getKstTodayDateStr(): string {
  const kstMs = Date.now() + 9 * 3600 * 1000;
  const d = new Date(kstMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysToYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + deltaDays * 86400 * 1000);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function resolveIssuePeriodBounds(
  tab: IssueSummaryTab,
  baseDateStr: string
): { label: string; from: string; to: string } {
  const [y, m, d] = baseDateStr.split('-').map(Number);
  const baseUtc = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeekMonStart = (baseUtc.getUTCDay() + 6) % 7;
  const thisWeekMonday = addDaysToYmd(baseDateStr, -dayOfWeekMonStart);
  const thisWeekSunday = addDaysToYmd(thisWeekMonday, 6);

  const lastWeekMonday = addDaysToYmd(thisWeekMonday, -7);
  const lastWeekSunday = addDaysToYmd(thisWeekMonday, -1);

  const thisMonthStart = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
  const thisMonthLastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const thisMonthEnd = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(thisMonthLastDay).padStart(2, '0')}`;

  const prevMonthDate = new Date(Date.UTC(y, m - 1, 0));
  const prevY = prevMonthDate.getUTCFullYear();
  const prevM = prevMonthDate.getUTCMonth() + 1;
  const prevLastDay = prevMonthDate.getUTCDate();
  const lastMonthStart = `${String(prevY).padStart(4, '0')}-${String(prevM).padStart(2, '0')}-01`;
  const lastMonthEnd = `${String(prevY).padStart(4, '0')}-${String(prevM).padStart(2, '0')}-${String(prevLastDay).padStart(2, '0')}`;

  const yesterdayStr = addDaysToYmd(baseDateStr, -1);

  switch (tab) {
    case 'TODAY':
      return { label: '오늘', from: baseDateStr, to: baseDateStr };
    case 'THIS_WEEK':
      return { label: '이번주', from: thisWeekMonday, to: thisWeekSunday };
    case 'THIS_MONTH':
      return { label: '이번달', from: thisMonthStart, to: thisMonthEnd };
    case 'YESTERDAY':
      return { label: '어제', from: yesterdayStr, to: yesterdayStr };
    case 'LAST_WEEK':
      return { label: '저번주', from: lastWeekMonday, to: lastWeekSunday };
    case 'LAST_MONTH':
      return { label: '저번달', from: lastMonthStart, to: lastMonthEnd };
    case 'SEARCH':
      return { label: '검색', from: '2025-01-01', to: baseDateStr };
  }
}

/**
 * 날짜가 달라도 비슷한 주제로 이어진 이슈를 하나의 이슈로 통합해 보여주므로,
 * 최초 보도일~최근(추가) 보도일 범위가 조회 기간과 겹치거나 해당 기간에 보도된 기사가 있으면 매칭 처리
 */
function doesIssueMatchPeriod(
  issue: IssueCard,
  from: string,
  to: string
): boolean {
  const firstDate = (issue.firstReportedAt || '').slice(0, 10);
  const latestDate = (
    issue.latestReportedAt ||
    issue.firstReportedAt ||
    ''
  ).slice(0, 10);
  if (!firstDate) return false;
  if (firstDate <= to && latestDate >= from) {
    return true;
  }
  return issue.facts.some((f) =>
    f.citations.some((c) => {
      const cDate = (c.publishedAt || '').slice(0, 10);
      return Boolean(cDate && cDate >= from && cDate <= to);
    })
  );
}

/**
 * 주간/월간 등 다중 일자 탭 조회 시 여러 날에 걸쳐 보도된 동일 사건 이슈 카드를 하나로 병합
 */
function mergeSameEventIssuesForPeriod(issues: IssueCard[]): IssueCard[] {
  const merged: IssueCard[] = [];

  for (const item of issues) {
    const itemTokens = new Set(
      `${item.eventTitle || ''} ${item.representativeKeywords.slice(0, 2).join(' ')}`
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 2)
    );

    const existing = merged.find((m) => {
      const mTokens = `${m.eventTitle || ''} ${m.representativeKeywords.slice(0, 2).join(' ')}`
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 2);
      let shared = 0;
      for (const tk of mTokens) {
        if (itemTokens.has(tk)) shared += 1;
      }
      return shared >= 2;
    });

    if (!existing) {
      merged.push({
        ...item,
        representativeKeywords: [...item.representativeKeywords],
        mentionStats: {
          ...item.mentionStats,
          byChannel: { ...item.mentionStats.byChannel },
        },
        facts: [...item.facts],
      });
    } else {
      existing.mentionStats.totalCount += item.mentionStats.totalCount;
      existing.mentionStats.newspaperCount += item.mentionStats.newspaperCount;
      existing.mentionStats.broadcastCount += item.mentionStats.broadcastCount;
      for (const [ch, cnt] of Object.entries(item.mentionStats.byChannel)) {
        existing.mentionStats.byChannel[ch] =
          (existing.mentionStats.byChannel[ch] || 0) + cnt;
      }
      existing.mentionStats.uniqueChannelsCount = Object.keys(
        existing.mentionStats.byChannel
      ).length;

      if (item.firstReportedAt < existing.firstReportedAt) {
        existing.firstReportedAt = item.firstReportedAt;
        existing.firstReportedChannel = item.firstReportedChannel;
        existing.firstReportedUrl = item.firstReportedUrl;
      }
      if (item.latestReportedAt > existing.latestReportedAt) {
        existing.latestReportedAt = item.latestReportedAt;
      }

      for (const kw of item.representativeKeywords) {
        if (
          existing.representativeKeywords.length < 6 &&
          !existing.representativeKeywords.includes(kw)
        ) {
          existing.representativeKeywords.push(kw);
        }
      }

      for (const f of item.facts) {
        if (
          existing.facts.length < 8 &&
          !existing.facts.some((ef) => ef.sentence === f.sentence)
        ) {
          existing.facts.push(f);
        }
      }
    }
  }

  return merged.sort(
    (a, b) =>
      b.mentionStats.totalCount - a.mentionStats.totalCount ||
      b.latestReportedAt.localeCompare(a.latestReportedAt)
  );
}

export function App() {
  const [activeMenu, setActiveMenu] = useState<MainMenuView>('ISSUE_SUMMARY');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  const [mediaTab, setMediaTab] = useState<MediaAnalysisTab>('NEWSPAPER');
  const [issueSummaryTab, setIssueSummaryTab] =
    useState<IssueSummaryTab>('TODAY');
  const [dbTab, setDbTab] = useState<DbStatsTab>('CHANNEL_INFO');
  const [annualTab, setAnnualTab] = useState<AnnualIssuesTab>('TABLE');

  const [issuesData, setIssuesData] = useState<IssuesSummaryPayload | null>(
    null
  );
  const [checkpointData, setCheckpointData] = useState<CheckpointState | null>(
    null
  );
  const [parserReport, setParserReport] = useState<ParserAnalysisReport | null>(
    null
  );
  const [loading, setLoading] = useState<boolean>(true);

  const [filters, setFilters] = useState<IssueFilterState>(DEFAULT_FILTERS);
  const [dbColumns, setDbColumns] =
    useState<DbChannelColumnVisibility>(DEFAULT_DB_COLUMNS);
  const [annualColumns, setAnnualColumns] =
    useState<AnnualTableColumnVisibility>(DEFAULT_ANNUAL_COLUMNS);

  const [selectedTop10IssueId, setSelectedTop10IssueId] = useState<
    string | null
  >(null);

  // 이슈 요약 - '검색' 탭 전용 검색어 및 선택된 후보 이슈 ID
  const [searchTabQuery, setSearchTabQuery] = useState<string>('');
  const [selectedSearchCandidateId, setSelectedSearchCandidateId] = useState<
    string | null
  >(null);

  // 언론사 별명(Alias) 상태 관리 (설정 화면에서 실시간 변경 및 localStorage 영구 저장)
  const [mediaAliases, setMediaAliases] = useState<Record<string, string>>(() =>
    loadMediaAliases()
  );

  const [retentionDaysSetting, setRetentionDaysSetting] = useState<number>(30);
  const [autoPurgeSetting, setAutoPurgeSetting] = useState<boolean>(true);
  const [engineModeSetting, setEngineModeSetting] = useState<
    'LOCAL_FREE' | 'HYBRID_LLM'
  >('LOCAL_FREE');

  // 수집현황(1번탭) 최상위 세로 막대 그래프(언론사별 기사 수) 전용 필터 상태
  const [chartSelectedChannels, setChartSelectedChannels] =
    useState<string[]>(ALL_CHANNEL_IDS);
  const [chartPeriodTab, setChartPeriodTab] =
    useState<IssueSummaryTab>('THIS_MONTH');
  const [chartSearchInTitle, setChartSearchInTitle] = useState<boolean>(true);
  const [chartSearchInBody, setChartSearchInBody] = useState<boolean>(true);
  const [chartSearchText, setChartSearchText] = useState<string>('');
  const [chartSmartMode, setChartSmartMode] = useState<boolean>(false);
  const [chartSelectedIssueUuid, setChartSelectedIssueUuid] =
    useState<string>('');

  useEffect(() => {
    const base = import.meta.env.BASE_URL || '/';
    Promise.all([
      fetch(`${base}data/issues-summary.json`).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(`${base}data/crawl-checkpoints.json`).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(`${base}data/parser-analysis-report.json`).then((r) =>
        r.ok ? r.json() : null
      ),
    ])
      .then(([iss, chk, prs]) => {
        setIssuesData(iss);
        setCheckpointData(chk);
        setParserReport(prs);
        if (iss?.issues?.length > 0) {
          setSelectedTop10IssueId(iss.issues[0].issueId);
          setChartSelectedIssueUuid(
            iss.issues[0].uuid || iss.issues[0].issueId
          );
        }
        if (iss?.retentionPolicy?.retentionDays) {
          setRetentionDaysSetting(iss.retentionPolicy.retentionDays);
        }
      })
      .catch((err) => {
        console.error('[KoreaIssues] 데이터 로드 실패:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const handleUpdateAlias = (canonicalName: string, nextAlias: string) => {
    setMediaAliases((prev) => {
      const updated = {
        ...prev,
        [canonicalName]: nextAlias,
      };
      if (canonicalName === 'SBS 뉴스') {
        updated['SBS'] = nextAlias;
      }
      if (canonicalName === 'JTBC News') {
        updated['TBC News'] = nextAlias;
        updated['JTBC'] = nextAlias;
      }
      saveMediaAliases(updated);
      return updated;
    });
  };

  const handleResetAliases = () => {
    const defaults = resetMediaAliases();
    setMediaAliases(defaults);
  };

  const handleUpdateFilter = <K extends keyof IssueFilterState>(
    key: K,
    value: IssueFilterState[K]
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleResetFilters = () => {
    setFilters(DEFAULT_FILTERS);
  };

  // 기준 오늘 날짜 산출 (오늘 수집분이 아직 없는 새벽 시간대에는 최신 수집 완료일 기준 폴백)
  const referenceTodayStr = useMemo<string>(() => {
    const todayKst = getKstTodayDateStr();
    if (!issuesData?.issues || issuesData.issues.length === 0) {
      return todayKst;
    }
    const hasTodayIssue = issuesData.issues.some((it) =>
      doesIssueMatchPeriod(it, todayKst, todayKst)
    );
    if (hasTodayIssue) return todayKst;
    return issuesData.storageSummary?.newestRawDate || todayKst;
  }, [issuesData]);

  const currentPeriodBounds = useMemo(
    () => resolveIssuePeriodBounds(issueSummaryTab, referenceTodayStr),
    [issueSummaryTab, referenceTodayStr]
  );

  // 날짜가 달라도 유사한 주제는 하나의 통합 이슈로 먼저 병합
  const unifiedAllIssues = useMemo<IssueCard[]>(() => {
    if (!issuesData?.issues) return [];
    return mergeSameEventIssuesForPeriod(issuesData.issues);
  }, [issuesData]);

  // 선택된 이슈 요약 기간 탭(오늘/이번주/이번달/어제/저번주/저번달)에 해당하는 검증 이슈 목록
  const periodVerifiedIssues = useMemo<IssueCard[]>(() => {
    return unifiedAllIssues.filter((issue) => {
      if (
        issue.mentionStats.uniqueChannelsCount < 2 ||
        issue.mentionStats.totalCount < 3
      ) {
        return false;
      }
      return doesIssueMatchPeriod(
        issue,
        currentPeriodBounds.from,
        currentPeriodBounds.to
      );
    });
  }, [unifiedAllIssues, currentPeriodBounds]);

  // 이슈 요약 '검색' 탭 전용: 검색어와 매칭된 후보 이슈 목록 산출
  const activeSearchQuery = (
    searchTabQuery.trim() || filters.searchQuery.trim()
  ).toLowerCase();

  const searchCandidateIssues = useMemo<IssueCard[]>(() => {
    if (unifiedAllIssues.length === 0) return [];
    if (!activeSearchQuery) {
      return unifiedAllIssues;
    }

    const qTokens = activeSearchQuery
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const records = issuesData?.articleRecords || [];

    return unifiedAllIssues.filter((issue) => {
      const issueUuid = issue.uuid || issue.issueId;
      const searchableText = [
        issue.eventTitle || '',
        issue.title || '',
        ...issue.representativeKeywords,
        ...issue.facts.map((f) => f.sentence),
        ...issue.facts.flatMap((f) =>
          f.citations.map(
            (c) =>
              `${c.articleTitle || ''} ${c.channelName} ${getMediaAlias(
                c.channelName,
                mediaAliases
              )}`
          )
        ),
      ]
        .join(' ')
        .toLowerCase();

      if (qTokens.every((tk) => searchableText.includes(tk))) {
        return true;
      }

      // 연관 기사(articleRecords) 제목·본문 매칭
      return records.some(
        (rec) =>
          rec.u === issueUuid &&
          qTokens.every(
            (tk) =>
              rec.t.toLowerCase().includes(tk) ||
              rec.b.toLowerCase().includes(tk)
          )
      );
    });
  }, [unifiedAllIssues, activeSearchQuery, issuesData, mediaAliases]);

  const selectedSearchCandidateIssue = useMemo<IssueCard | null>(() => {
    if (searchCandidateIssues.length === 0) return null;
    return (
      searchCandidateIssues.find(
        (it) => it.issueId === selectedSearchCandidateId
      ) || searchCandidateIssues[0]
    );
  }, [searchCandidateIssues, selectedSearchCandidateId]);

  // 이슈 요약 상단 비교 표에 표시할 기간별 상위 이슈 (최대 10개)
  const periodSummaryTableIssues = useMemo<IssueCard[]>(() => {
    return periodVerifiedIssues
      .filter((it) => it.qualifiesForTop10 !== false)
      .sort((a, b) => b.mentionStats.totalCount - a.mentionStats.totalCount)
      .slice(0, 10);
  }, [periodVerifiedIssues]);

  // Top10 자격(구체적 사건성 + 복수 매체 보도)을 충족한 이슈만 선별 (현재 선택된 기간 탭 우선 반영)
  const top10Issues = useMemo<IssueCard[]>(() => {
    if (periodSummaryTableIssues.length > 0) {
      return periodSummaryTableIssues;
    }
    if (!issuesData?.issues) return [];
    return issuesData.issues
      .filter((it) => it.qualifiesForTop10 !== false)
      .sort((a, b) => b.mentionStats.totalCount - a.mentionStats.totalCount)
      .slice(0, 10);
  }, [periodSummaryTableIssues, issuesData]);

  const selectedTop10Issue = useMemo<IssueCard | null>(() => {
    if (top10Issues.length === 0) return null;
    return (
      top10Issues.find((it) => it.issueId === selectedTop10IssueId) ||
      top10Issues[0]
    );
  }, [top10Issues, selectedTop10IssueId]);

  const selectedTop10Rank = useMemo<number>(() => {
    if (!selectedTop10Issue) return 1;
    const idx = top10Issues.findIndex(
      (it) => it.issueId === selectedTop10Issue.issueId
    );
    return idx >= 0 ? idx + 1 : 1;
  }, [top10Issues, selectedTop10Issue]);

  // 선택된 기간 탭 내 이슈들의 추천 키워드 동적 산출
  const periodRecommendedKeywords = useMemo<RecommendedKeyword[]>(() => {
    const kwMap = new Map<
      string,
      { articleCount: number; channels: Set<string>; isCompound: boolean }
    >();
    for (const issue of periodVerifiedIssues) {
      const chKeys = Object.keys(issue.mentionStats.byChannel || {});
      for (const kw of issue.representativeKeywords.slice(0, 2)) {
        const entry = kwMap.get(kw) || {
          articleCount: 0,
          channels: new Set<string>(),
          isCompound: kw.includes(' '),
        };
        entry.articleCount += issue.mentionStats.totalCount;
        for (const ch of chKeys) entry.channels.add(ch);
        kwMap.set(kw, entry);
      }
    }
    return Array.from(kwMap.entries())
      .map(([keyword, info]) => ({
        keyword,
        isCompound: info.isCompound,
        articleCount: info.articleCount,
        channelCount: info.channels.size,
        score: info.articleCount * 3 + info.channels.size * 5,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 24);
  }, [periodVerifiedIssues]);

  // 개별 기사는 이슈요약에 등장하지 않도록 복수 매체가 교차 보도한 검증된 이슈만 필터링
  const filteredIssues = useMemo(() => {
    return periodVerifiedIssues.filter((issue) => {
      if (filters.mediaTypes.length === 0) return false;
      const hasNewspaper = filters.mediaTypes.includes('NEWSPAPER');
      const hasBroadcast = filters.mediaTypes.includes('BROADCAST');
      if (!hasNewspaper && issue.mentionStats.broadcastCount === 0) {
        return false;
      }
      if (!hasBroadcast && issue.mentionStats.newspaperCount === 0) {
        return false;
      }

      if (
        filters.mediaFilter === 'NEWSPAPER_ONLY' &&
        issue.mentionStats.newspaperCount === 0
      ) {
        return false;
      }
      if (
        filters.mediaFilter === 'BROADCAST_ONLY' &&
        issue.mentionStats.broadcastCount === 0
      ) {
        return false;
      }
      if (
        filters.mediaFilter === 'CROSS_MEDIA' &&
        (issue.mentionStats.newspaperCount === 0 ||
          issue.mentionStats.broadcastCount === 0)
      ) {
        return false;
      }
      if (issue.mentionStats.totalCount < filters.minMentionCount) {
        return false;
      }

      if (filters.selectedKeyword) {
        const kwParts = filters.selectedKeyword.split(' ');
        const inKeywords = issue.representativeKeywords.some((k) =>
          k.includes(filters.selectedKeyword!)
        );
        const inEventTitle = (issue.eventTitle || '').includes(
          filters.selectedKeyword!
        );
        const inFacts = issue.facts.some((f) =>
          kwParts.every((p) => f.sentence.includes(p))
        );
        if (!inKeywords && !inEventTitle && !inFacts) return false;
      }

      if (filters.searchQuery.trim()) {
        const q = filters.searchQuery.trim().toLowerCase();
        const kwMatched = issue.representativeKeywords.some((k) =>
          k.toLowerCase().includes(q)
        );
        const factMatched = issue.facts.some((f) =>
          f.sentence.toLowerCase().includes(q)
        );
        const aliasMatched = issue.facts.some((f) =>
          f.citations.some((c) =>
            getMediaAlias(c.channelName, mediaAliases).toLowerCase().includes(q)
          )
        );
        if (!kwMatched && !factMatched && !aliasMatched) return false;
      }

      return true;
    });
  }, [periodVerifiedIssues, filters, mediaAliases]);

  // 채널명 표기 헬퍼: 단축보기(shortNameView) 체크 시 단축 이름만, 해제 시 원래 채널명만 단독 표기
  const formatChannelDisplayName = (canonicalName: string): string => {
    if (filters.shortNameView) {
      return getMediaAlias(canonicalName, mediaAliases);
    }
    return canonicalName;
  };

  const checkpointChannels = useMemo(() => {
    if (!checkpointData?.channels) return [];
    const list = Object.values(checkpointData.channels).filter((ch) => {
      if (ch.mediaType === 'NEWSPAPER') {
        return filters.mediaTypes.includes('NEWSPAPER');
      }
      return filters.mediaTypes.includes('BROADCAST');
    });
    if (!filters.searchQuery.trim()) return list;
    const q = filters.searchQuery.trim().toLowerCase();
    return list.filter(
      (ch) =>
        ch.name.toLowerCase().includes(q) ||
        getMediaAlias(ch.name, mediaAliases).toLowerCase().includes(q) ||
        ch.channelId.toLowerCase().includes(q)
    );
  }, [checkpointData, filters.mediaTypes, filters.searchQuery, mediaAliases]);

  const chartPeriodBounds = useMemo(
    () => resolveIssuePeriodBounds(chartPeriodTab, referenceTodayStr),
    [chartPeriodTab, referenceTodayStr]
  );

  // Smart 옵션용: 현재 그래프 선택 기간(또는 전체)의 이슈 목록 (고유 UUID 보유)
  const chartPeriodIssues = useMemo<IssueCard[]>(() => {
    if (!issuesData?.issues) return [];
    const inPeriod = issuesData.issues.filter(
      (iss) =>
        iss.mentionStats.uniqueChannelsCount >= 2 &&
        iss.mentionStats.totalCount >= 3 &&
        doesIssueMatchPeriod(iss, chartPeriodBounds.from, chartPeriodBounds.to)
    );
    return inPeriod.length > 0 ? inPeriod : issuesData.issues.slice(0, 30);
  }, [issuesData, chartPeriodBounds]);

  const activeSmartIssue = useMemo<IssueCard | null>(() => {
    if (!chartSmartMode || chartPeriodIssues.length === 0) return null;
    return (
      chartPeriodIssues.find(
        (iss) => (iss.uuid || iss.issueId) === chartSelectedIssueUuid
      ) || chartPeriodIssues[0]
    );
  }, [chartSmartMode, chartPeriodIssues, chartSelectedIssueUuid]);

  // 수집현황(1번탭) 최상위 세로 막대 그래프 데이터 산출
  const channelArticleChartData = useMemo(() => {
    const countsByChannel: Record<string, number> = {};
    for (const id of ALL_CHANNEL_IDS) {
      countsByChannel[id] = 0;
    }

    const q = chartSearchText.trim().toLowerCase();
    const records = issuesData?.articleRecords || [];

    if (chartSmartMode && activeSmartIssue) {
      const targetUuid = activeSmartIssue.uuid || activeSmartIssue.issueId;
      const matchedRecords = records.filter((rec) => {
        if (rec.u !== targetUuid) return false;
        if (!q) return true;
        const inT = chartSearchInTitle && rec.t.toLowerCase().includes(q);
        const inB = chartSearchInBody && rec.b.toLowerCase().includes(q);
        return inT || inB;
      });

      if (matchedRecords.length > 0) {
        for (const rec of matchedRecords) {
          countsByChannel[rec.ch] = (countsByChannel[rec.ch] || 0) + 1;
        }
      } else {
        for (const [chId, cnt] of Object.entries(
          activeSmartIssue.mentionStats.byChannel || {}
        )) {
          countsByChannel[chId] = (countsByChannel[chId] || 0) + cnt;
        }
      }
    } else {
      for (const rec of records) {
        if (
          rec.dt < chartPeriodBounds.from ||
          rec.dt > chartPeriodBounds.to
        ) {
          continue;
        }
        if (q) {
          const inT = chartSearchInTitle && rec.t.toLowerCase().includes(q);
          const inB = chartSearchInBody && rec.b.toLowerCase().includes(q);
          if (!inT && !inB) continue;
        }
        countsByChannel[rec.ch] = (countsByChannel[rec.ch] || 0) + 1;
      }
    }

    const allChList = checkpointData?.channels
      ? Object.values(checkpointData.channels)
      : [];

    const bars = allChList
      .filter((ch) => {
        const typeAllowed =
          ch.mediaType === 'NEWSPAPER'
            ? filters.mediaTypes.includes('NEWSPAPER')
            : filters.mediaTypes.includes('BROADCAST');
        return typeAllowed && chartSelectedChannels.includes(ch.channelId);
      })
      .map((ch) => ({
        channelId: ch.channelId,
        name: ch.name,
        shortName: getMediaAlias(ch.name, mediaAliases),
        mediaType: ch.mediaType,
        count: countsByChannel[ch.channelId] || 0,
      }));

    const maxCount = Math.max(1, ...bars.map((b) => b.count));
    const totalCount = bars.reduce((acc, b) => acc + b.count, 0);

    return { bars, maxCount, totalCount };
  }, [
    issuesData,
    checkpointData,
    chartSmartMode,
    activeSmartIssue,
    chartPeriodBounds,
    chartSearchText,
    chartSearchInTitle,
    chartSearchInBody,
    chartSelectedChannels,
    filters.mediaTypes,
    mediaAliases,
  ]);

  /**
   * 하나의 점수 바(Unified Single Score Bar)에서 언론 보도 강도와 대중 소비·검색 점수 게이지를 동시에 표시
   */
  const renderSingleScoreGaugeBar = (metrics?: ImpactMetrics) => {
    const pushScore = metrics?.mediaPushScore ?? 50;
    const pullScore = metrics?.publicPullScore ?? 35;

    return (
      <div className={styles.unifiedScoreBarContainer}>
        <div
          className={styles.unifiedScoreBarTrack}
          title={`언론 보도 강도 ${pushScore}점 / 대중 소비·검색 ${pullScore}점`}
        >
          {/* 하나의 점수 바 내부 상단 게이지: 언론 보도 강도 */}
          <div
            className={styles.unifiedGaugeMediaFill}
            style={{ width: `${Math.max(3, Math.min(100, pushScore))}%` }}
          />
          {/* 하나의 점수 바 내부 하단 게이지: 대중 소비·검색 */}
          <div
            className={styles.unifiedGaugePublicFill}
            style={{ width: `${Math.max(3, Math.min(100, pullScore))}%` }}
          />
        </div>
        <div className={styles.unifiedScoreNums}>
          <span className={styles.scoreNumMedia}>언론 {pushScore}</span>
          <span className={styles.scoreNumDivider}>·</span>
          <span className={styles.scoreNumPublic}>대중 {pullScore}</span>
        </div>
      </div>
    );
  };

  /**
   * 사용자 예시 형식의 인라인 문장 + `{별명}` / `{외 N}` (후속이 1개인 경우 `{별명2}`) 렌더링:
   * 예:
   * 젠슨 황 엔비디아 최고경영자(CEO)가 중국 정보기관의 첩자로 의심받는 여성 기업인과의 불륜 관계를 시인했습니다 {조선} {외 4}.
   * 젠슨 황 엔비디아 CEO가 중국 정보기관 연루 의혹을 받는 여성과의 불륜 사실을 인정해 파장이 일고 있습니다 {JTBC}.
   * 국가안보와 회사 기밀 침해 가능성까지 제기되면서 엔비디아는 독립 조사에 착수했는데요 {JTBC}.
   * 미국 국가 안보 우려와 기밀 유출 가능성을 규명하기 위한 독립 이사 위원회의 조사 내용 및 의회의 압박 등 파장을 짚어봅니다 {YTN} {연합}.
   */
  const renderInlineFactSentence = (
    fact: FactItem,
    dateMarker?: string | null
  ) => {
    const firstCit = fact.citations[0];
    const followUps = fact.citations.slice(1);
    const cleanSent = fact.sentence.replace(/[.?!]+$/, '').trim();
    const firstAlias = firstCit
      ? getMediaAlias(firstCit.channelName, mediaAliases)
      : '';

    return (
      <span key={fact.factId} className={styles.inlineFactSegment}>
        {dateMarker && (
          <span className={styles.inlineFollowUpBadge}>{dateMarker}</span>
        )}
        <span className={styles.inlineSentenceText}>{cleanSent}</span>{' '}
        {firstCit && (
          <a
            href={firstCit.url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.inlineBraceTagFirst}
            title={`최초 보도: ${firstCit.channelName} (${firstCit.publishedAt})`}
          >
            {firstAlias}
          </a>
        )}
        {/* 후속 보도가 정확히 1개인 경우: 외 1 대신 해당 매체 별명 연합 등을 직접 표기 */}
        {followUps.length === 1 && (
          <>
            {' '}
            <a
              href={followUps[0].url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.inlineBraceTagSecond}
              title={`후속 보도: ${followUps[0].channelName} (${followUps[0].publishedAt})`}
            >
              {getMediaAlias(followUps[0].channelName, mediaAliases)}
            </a>
          </>
        )}
        {/* 후속 보도가 2개 이상인 경우: 외 N으로 표시하고 마우스오버 시 상세 매체·시각 팝오버 노출 */}
        {followUps.length >= 2 && (
          <>
            {' '}
            <span className={styles.followUpHoverWrap}>
              <span className={styles.inlineBraceTagMore}>
                {`외 ${followUps.length}`}
              </span>
              <span className={styles.followUpPopover}>
                <span className={styles.followUpPopoverTitle}>
                  후속 보도 매체 ({followUps.length}곳 · 시간순)
                </span>
                {followUps.map((fc, idx) => (
                  <a
                    key={`${fc.channelId}-${fc.publishedAt}-${idx}`}
                    href={fc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.followUpLinkItem}
                  >
                    <span>
                      {getMediaAlias(fc.channelName, mediaAliases)}{' '}
                      <small style={{ color: '#94a3b8' }}>
                        ({fc.channelName})
                      </small>
                    </span>
                    <span className={styles.citationTime}>
                      {formatShortTimestamp(fc.publishedAt)}
                    </span>
                  </a>
                ))}
              </span>
            </span>
          </>
        )}
        <span className={styles.inlinePeriod}>. </span>
      </span>
    );
  };

  /**
   * 연중이슈 타임라인 전용 문장 아이템 (최초 보도 기본 표시 + ▼ 마우스오버 + 신규 사실 키워드 표시)
   */
  const renderTimelineFactItem = (fact: FactItem) => {
    const firstCit = fact.citations[0];
    const followUps = fact.citations.slice(1);
    const isNewAngle = Boolean(
      fact.isNewFactAdded && fact.addedKeywords && fact.addedKeywords.length > 0
    );

    return (
      <div
        key={fact.factId}
        className={`${styles.factItem} ${
          isNewAngle ? styles.factItemNewAdded : ''
        }`}
      >
        <p className={styles.factSentence}>
          {renderInlineFactSentence(fact)}
        </p>

        <div className={styles.citationsRow}>
          {firstCit && (
            <span className={styles.timelineFirstMeta}>
              {isNewAngle ? '🆕 추가 보도:' : '🥇 최초 보도:'}{' '}
              <strong>
                {getMediaAlias(firstCit.channelName, mediaAliases)}
              </strong>{' '}
              ({formatShortTimestamp(firstCit.publishedAt)})
            </span>
          )}

          {isNewAngle &&
            fact.addedKeywords?.map((akw) => (
              <span key={akw} className={styles.addedKeywordPill}>
                +키워드: #{akw}
              </span>
            ))}

          {followUps.length > 0 && (
            <div className={styles.followUpHoverWrap}>
              <span className={styles.followUpTrigger}>
                ▼ {followUps.length}곳
              </span>
              <div className={styles.followUpPopover}>
                <span className={styles.followUpPopoverTitle}>
                  후속 보도 ({followUps.length}곳 · 마우스오버)
                </span>
                {followUps.map((fc, idx) => (
                  <a
                    key={`${fc.channelId}-${fc.publishedAt}-${idx}`}
                    href={fc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.followUpLinkItem}
                  >
                    <span>
                      {getMediaAlias(fc.channelName, mediaAliases)} (
                      {fc.channelName})
                    </span>
                    <span className={styles.citationTime}>
                      {formatShortTimestamp(fc.publishedAt)}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  /**
   * 이슈 요약 및 Top10 카드 렌더링:
   * - 화면/카드 상단에 [평가 (언론 과소보도 / 언론 과대보도 / 언론에 관심없음 / 언론 보도 일반 관심)] + [하나의 점수 바(언론·대중 게이지)] 배치
   * - 개별 기사 제목이나 목록은 노출하지 않고, 구체적 사건 키워드와 `{별명}` `{외 N}`이 결합된 요약 문단만 표시
   */
  const renderIssueSummaryCard = (issue: IssueCard, rankBadgeNum?: number) => {
    const specificPhrase =
      issue.eventTitle || issue.representativeKeywords[0] || '주요 이슈';
    const metrics = issue.impactMetrics;
    const evalInfo = resolveEvaluationInfo(metrics);
    const firstChannelAlias = getMediaAlias(
      issue.firstReportedChannel,
      mediaAliases
    );
    const firstDateStr = (issue.firstReportedAt || '').slice(0, 10);
    const latestDateStr = (issue.latestReportedAt || '').slice(0, 10);
    const hasDifferentDayAdditionalReport = Boolean(
      firstDateStr &&
        latestDateStr &&
        latestDateStr > firstDateStr &&
        issue.mentionStats.totalCount > 1
    );

    let lastShownDate = firstDateStr;

    return (
      <article key={issue.issueId} className={styles.issueCard}>
        {/* 화면/카드 최상단: 평가 문구 + 하나의 점수 바(언론/대중 게이지) */}
        <div className={styles.issueTopEvalBar}>
          <div className={styles.evalLeftGroup}>
            <span className={styles.evalPrefixLabel}>평가</span>
            <span className={evalInfo.badgeClass}>{evalInfo.label}</span>
            <span className={styles.firstReportUpdatedChip}>
              최초 보도: {firstChannelAlias} (
              {formatShortTimestamp(issue.firstReportedAt)})
            </span>
            {hasDifferentDayAdditionalReport && (
              <span className={styles.additionalReportChip}>
                + {latestDateStr.slice(5).replace('-', '/')}
              </span>
            )}
          </div>

          <div className={styles.evalRightGaugeGroup}>
            {renderSingleScoreGaugeBar(metrics)}
          </div>
        </div>

        {/* 이슈 사건명 및 키워드 헤더 (개별 기사 제목 미노출) */}
        <div className={styles.issueHeader}>
          <div className={styles.issueTitleGroup}>
            <h2 className={styles.issueTitle}>
              {rankBadgeNum !== undefined && (
                <span className={styles.rankBadgeInline}>
                  Top {rankBadgeNum}위
                </span>
              )}
              {specificPhrase}
            </h2>
            <div className={styles.issueKeywordsRow}>
              {issue.representativeKeywords.map((kw) => (
                <span key={kw} className={styles.issueKwTag}>
                  #{kw}
                </span>
              ))}
            </div>
          </div>

          <div className={styles.mentionBadges}>
            <span className={styles.totalMentionBadge}>
              총 {issue.mentionStats.totalCount}회 보도 (일간지{' '}
              {issue.mentionStats.newspaperCount} · 방송사{' '}
              {issue.mentionStats.broadcastCount})
            </span>
          </div>
        </div>

        {/* 요약된 이슈 본문 문단 (별명 외 N / 1개인 경우 별명2, 다른 날 추가 보도 시 + MM/DD 1회 표기) */}
        <div className={styles.narrativeSummaryBox}>
          <p className={styles.narrativeParagraph}>
            {issue.facts.map((fact) => {
              const factDate = (
                fact.firstMentionedAt ||
                fact.addedAt ||
                ''
              ).slice(0, 10);
              let dateMarker: string | null = null;
              if (
                factDate &&
                firstDateStr &&
                factDate !== firstDateStr &&
                factDate !== lastShownDate
              ) {
                dateMarker = `+ ${factDate.slice(5).replace('-', '/')}`;
                lastShownDate = factDate;
              }
              return renderInlineFactSentence(fact, dateMarker);
            })}
          </p>
        </div>
      </article>
    );
  };

  return (
    <div className={styles.container}>
      <HeaderBar
        activeMenu={activeMenu}
        mediaTab={mediaTab}
        issueSummaryTab={issueSummaryTab}
        dbTab={dbTab}
        annualTab={annualTab}
        selectedTop10Issue={selectedTop10Issue}
        selectedTop10Rank={selectedTop10Rank}
        filters={filters}
        dbColumns={dbColumns}
        annualColumns={annualColumns}
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        onChangeMediaTab={setMediaTab}
        onChangeIssueSummaryTab={(nextTab) => {
          setIssueSummaryTab(nextTab);
          handleUpdateFilter('selectedKeyword', null);
        }}
        onChangeDbTab={setDbTab}
        onChangeAnnualTab={setAnnualTab}
        onUpdateFilter={handleUpdateFilter}
        onResetFilters={handleResetFilters}
        onChangeDbColumns={setDbColumns}
        onChangeAnnualColumns={setAnnualColumns}
      />

      <SidebarDrawer
        open={sidebarOpen}
        activeMenu={activeMenu}
        top10Issues={top10Issues}
        selectedTop10IssueId={selectedTop10Issue?.issueId || null}
        onSelectMenu={setActiveMenu}
        onSelectTop10Issue={setSelectedTop10IssueId}
        onClose={() => setSidebarOpen(false)}
      />

      <main className={styles.main}>
        {loading && (
          <div className={styles.sectionCard}>데이터를 불러오는 중입니다...</div>
        )}

        {/* 1. 언론사 분석 (일간지 / 방송사 2개 탭, 가로 막대 그래프 + 언론사 별명 + 연도 드롭다운 + 0.5초 재생) */}
        {!loading && activeMenu === 'MEDIA_ANALYSIS' && (
          <MediaAnalysisView
            activeTab={mediaTab}
            searchQuery={filters.searchQuery}
            mediaAliases={mediaAliases}
          />
        )}

        {/* 2. 이슈 요약 (기본 화면: 상단 [순위 | 주제 | 대중 | 언론 | 비고] 비교 표 + 사건 키워드 + 요약 문단 카드, 또는 '검색' 탭) */}
        {!loading && activeMenu === 'ISSUE_SUMMARY' && (
          <>
            {issueSummaryTab === 'SEARCH' ? (
              <>
                {/* 검색 탭 상단: 검색어 입력 및 후보 이슈 목록 선택 패널 */}
                <section className={styles.sectionCard}>
                  <div className={styles.searchTabHeaderRow}>
                    <h2 className={styles.sectionTitle}>
                      <Search size={19} color="#2563eb" />
                      <span>
                        이슈 검색 — 검색된 후보 이슈 선택 및 통합 보도(추가 보도 포함) 조회
                      </span>
                    </h2>
                    <span className={styles.rangePill}>
                      후보 이슈 {searchCandidateIssues.length}건
                    </span>
                  </div>

                  <div className={styles.searchTabInputRow}>
                    <input
                      type="search"
                      className={styles.searchTabInputBox}
                      placeholder="사건 키워드, 주제, 본문 문장, 언론사명을 입력하세요 (예: 젠슨 황, 트럼프, 연쇄 추돌, 종부세)..."
                      value={searchTabQuery}
                      onChange={(e) => {
                        setSearchTabQuery(e.target.value);
                        setSelectedSearchCandidateId(null);
                      }}
                    />
                    {searchTabQuery && (
                      <button
                        type="button"
                        className={styles.quickSelectBtn}
                        onClick={() => {
                          setSearchTabQuery('');
                          setSelectedSearchCandidateId(null);
                        }}
                      >
                        검색어 지우기
                      </button>
                    )}
                  </div>

                  {/* 빠른 검색용 추천 키워드 */}
                  {issuesData?.recommendedKeywords &&
                    issuesData.recommendedKeywords.length > 0 && (
                      <div className={styles.keywordCloud}>
                        {issuesData.recommendedKeywords
                          .slice(0, 14)
                          .map((kw) => {
                            const isSelected =
                              searchTabQuery.trim() === kw.keyword;
                            return (
                              <button
                                key={kw.keyword}
                                type="button"
                                className={`${styles.keywordPill} ${
                                  kw.isCompound
                                    ? styles.keywordPillCompound
                                    : ''
                                } ${
                                  isSelected ? styles.keywordPillSelected : ''
                                }`}
                                onClick={() => {
                                  setSearchTabQuery(
                                    isSelected ? '' : kw.keyword
                                  );
                                  setSelectedSearchCandidateId(null);
                                }}
                              >
                                <span>{kw.keyword}</span>
                                <span className={styles.keywordCount}>
                                  {kw.articleCount}건
                                </span>
                              </button>
                            );
                          })}
                      </div>
                    )}

                  {/* 후보 이슈 선택 목록 */}
                  <div className={styles.candidateListSection}>
                    <div className={styles.candidateListTitle}>
                      후보 이슈 목록 (클릭하여 아래에 상세 이슈 및 추가 보도 출력)
                    </div>

                    {searchCandidateIssues.length === 0 ? (
                      <div className={styles.emptyCandidateNotice}>
                        입력하신 검색어(
                        <strong>
                          {searchTabQuery || filters.searchQuery}
                        </strong>
                        )와 일치하는 후보 이슈가 없습니다.
                      </div>
                    ) : (
                      <div className={styles.candidateIssuesGrid}>
                        {searchCandidateIssues.slice(0, 24).map((cand, idx) => {
                          const isSelected =
                            selectedSearchCandidateIssue?.issueId ===
                            cand.issueId;
                          const firstDay = (cand.firstReportedAt || '').slice(
                            5,
                            10
                          );
                          const latestDay = (
                            cand.latestReportedAt ||
                            cand.firstReportedAt ||
                            ''
                          ).slice(5, 10);
                          const dateRangeLabel =
                            firstDay === latestDay
                              ? firstDay
                              : `${firstDay} ~ ${latestDay} (추가보도 포함)`;

                          return (
                            <button
                              key={cand.issueId}
                              type="button"
                              className={`${styles.candidateIssueBtn} ${
                                isSelected
                                  ? styles.candidateIssueBtnActive
                                  : ''
                              }`}
                              onClick={() =>
                                setSelectedSearchCandidateId(cand.issueId)
                              }
                            >
                              <div className={styles.candidateBtnTopRow}>
                                <span className={styles.candidateRankTag}>
                                  후보 {idx + 1}
                                </span>
                                <span className={styles.candidateDateSpan}>
                                  {dateRangeLabel}
                                </span>
                                <span className={styles.candidateCountSpan}>
                                  총 {cand.mentionStats.totalCount}회 보도
                                </span>
                              </div>
                              <div className={styles.candidateTitleText}>
                                {cand.eventTitle ||
                                  cand.representativeKeywords[0] ||
                                  cand.title}
                              </div>
                              <div className={styles.candidateKwPreview}>
                                {cand.representativeKeywords
                                  .slice(0, 3)
                                  .map((k) => `#${k}`)
                                  .join(' · ')}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>

                {/* 선택한 후보 이슈 상세 출력 (통합 이슈 카드 + 시간순 추가 보도 내역) */}
                {selectedSearchCandidateIssue && (
                  <>
                    <section className={styles.issuesGrid}>
                      {renderIssueSummaryCard(selectedSearchCandidateIssue)}
                    </section>

                    <section className={styles.sectionCard}>
                      <h3 className={styles.sectionTitle}>
                        <Clock size={18} color="#2563eb" />
                        <span>
                          선택된 이슈의 시간순 보도 및 추가 보도 내역 (총{' '}
                          {selectedSearchCandidateIssue.facts.length}개 핵심 문장 ·{' '}
                          {selectedSearchCandidateIssue.mentionStats.totalCount}건 기사 통합)
                        </span>
                      </h3>
                      <div className={styles.factsList}>
                        {selectedSearchCandidateIssue.facts.map((fact) =>
                          renderTimelineFactItem(fact)
                        )}
                      </div>
                    </section>
                  </>
                )}
              </>
            ) : (
              <>
                {/* 상단 비교 표: 순위, 주제, 대중(오른쪽 정렬 왼쪽 성장), 언론(왼쪽 정렬 오른쪽 성장), 비고(언론 과대 / 언론 과소만 체크) */}
                <section className={styles.impactChartCard}>
                  <div className={styles.impactChartHeader}>
                    <div>
                      <h2 className={styles.sectionTitle}>
                        <BarChart2 size={19} color="#2563eb" />
                        <span>
                          이슈 요약 ({currentPeriodBounds.label} ·{' '}
                          {currentPeriodBounds.from === currentPeriodBounds.to
                            ? currentPeriodBounds.from
                            : `${currentPeriodBounds.from} ~ ${currentPeriodBounds.to}`}
                          ) — 대중 vs 언론 보도 강도 비교 표
                        </span>
                      </h2>
                    </div>
                  </div>

                  <div className={styles.summaryTableWrap}>
                    <table className={styles.summaryButterflyTable}>
                      <thead>
                        <tr>
                          <th className={styles.colRank}>순위</th>
                          <th className={styles.colTopic}>주제</th>
                          <th className={styles.colPublic}>대중</th>
                          <th className={styles.colMedia}>언론</th>
                          <th className={styles.colRemark}>비고</th>
                        </tr>
                      </thead>
                      <tbody>
                        {periodSummaryTableIssues.map((issue, idx) => {
                          const isFirstRank = idx === 0;
                          const pullScore =
                            issue.impactMetrics?.publicPullScore ?? 35;
                          const pushScore =
                            issue.impactMetrics?.mediaPushScore ?? 50;
                          const pullWidth = Math.max(
                            4,
                            Math.min(100, pullScore)
                          );
                          const pushWidth = Math.max(
                            4,
                            Math.min(100, pushScore)
                          );
                          const remarkInfo = resolveTableRemark(
                            issue.impactMetrics
                          );
                          const labelText =
                            issue.eventTitle ||
                            issue.representativeKeywords[0] ||
                            '주요 이슈';

                          return (
                            <tr
                              key={issue.issueId}
                              className={styles.summaryTableRow}
                              onClick={() => {
                                setSelectedTop10IssueId(issue.issueId);
                                setActiveMenu('TOP10');
                              }}
                              title="클릭 시 해당 Top10 이슈 상세 화면으로 이동"
                            >
                              {/* 순위: 숫자 텍스트로만 출력 */}
                              <td className={styles.cellRankText}>{idx + 1}</td>

                              {/* 주제 */}
                              <td className={styles.cellTopicText}>
                                {labelText}
                              </td>

                              {/* 대중: 중간 기준 오른쪽 정렬, 왼쪽으로 성장 (1위만 대중 텍스트+수치가 그래프와 겹쳐 표시) */}
                              <td className={styles.cellButterflyPublic}>
                                <div className={styles.butterflyTrackPublic}>
                                  <div
                                    className={styles.butterflyBarPublic}
                                    style={{ width: `${pullWidth}%` }}
                                  />
                                  {isFirstRank && (
                                    <span
                                      className={styles.butterflyOverlayPublic}
                                    >
                                      대중 {pullScore}
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* 언론: 중간 기준 왼쪽 정렬, 오른쪽으로 성장 (1위만 언론 텍스트+수치가 그래프와 겹쳐 표시) */}
                              <td className={styles.cellButterflyMedia}>
                                <div className={styles.butterflyTrackMedia}>
                                  <div
                                    className={styles.butterflyBarMedia}
                                    style={{ width: `${pushWidth}%` }}
                                  />
                                  {isFirstRank && (
                                    <span
                                      className={styles.butterflyOverlayMedia}
                                    >
                                      언론 {pushScore}
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* 비고: 언론 과대, 언론 과소만 체크 */}
                              <td className={styles.cellRemarkText}>
                                {remarkInfo.remark ? (
                                  <span className={remarkInfo.badgeClass}>
                                    {remarkInfo.remark}
                                  </span>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* 실시간 대중 급상승 검색어 대조 바 */}
                  {issuesData?.publicSearchTrends &&
                    issuesData.publicSearchTrends.length > 0 && (
                      <div className={styles.trendsStripBox}>
                        <span
                          style={{
                            fontSize: '0.77rem',
                            fontWeight: 800,
                            color: '#0f172a',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Flame size={14} color="#dc2626" />
                          실제 대중 급상승 검색어 (Google Trends KR):
                        </span>
                        {issuesData.publicSearchTrends.map((tr) => (
                          <span
                            key={tr.keyword}
                            className={styles.trendItemChip}
                          >
                            <span>{tr.keyword}</span>
                            <span className={styles.trendTrafficBadge}>
                              {tr.trafficText}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                </section>

                {/* 구체적 사건 추천 키워드 바 */}
                <section className={styles.keywordPanel}>
                  <div className={styles.keywordBarHeader}>
                    <div className={styles.keywordBarTitle}>
                      <Tag size={15} color="#2563eb" />
                      <span>
                        구체적 사건 추천 키워드 (클릭 시 해당 사건 이슈 필터링)
                      </span>
                    </div>
                    {filters.selectedKeyword && (
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateFilter('selectedKeyword', null)
                        }
                        style={{
                          fontSize: '0.76rem',
                          color: '#2563eb',
                          background: 'none',
                          border: 'none',
                          fontWeight: 800,
                        }}
                      >
                        [키워드 필터 해제: #{filters.selectedKeyword}]
                      </button>
                    )}
                  </div>

                  <div className={styles.keywordCloud}>
                    {periodRecommendedKeywords.map((kw) => {
                      const isSelected = filters.selectedKeyword === kw.keyword;
                      return (
                        <button
                          key={kw.keyword}
                          type="button"
                          className={`${styles.keywordPill} ${
                            kw.isCompound ? styles.keywordPillCompound : ''
                          } ${isSelected ? styles.keywordPillSelected : ''}`}
                          onClick={() =>
                            handleUpdateFilter(
                              'selectedKeyword',
                              isSelected ? null : kw.keyword
                            )
                          }
                        >
                          <span>{kw.keyword}</span>
                          <span className={styles.keywordCount}>
                            {kw.channelCount}개 매체 · {kw.articleCount}건
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* 요약된 이슈 카드 목록 (개별 기사는 등장하지 않고 통합 요약 문단만 표시) */}
                {filteredIssues.length === 0 ? (
                  <div className={styles.sectionCard}>
                    선택하신 기간(
                    <strong>
                      {currentPeriodBounds.label}:{' '}
                      {currentPeriodBounds.from === currentPeriodBounds.to
                        ? currentPeriodBounds.from
                        : `${currentPeriodBounds.from} ~ ${currentPeriodBounds.to}`}
                    </strong>
                    ) 또는 필터 조건에 해당하는 이슈가 없습니다.
                  </div>
                ) : (
                  <section className={styles.issuesGrid}>
                    {filteredIssues.map((issue) =>
                      renderIssueSummaryCard(issue)
                    )}
                  </section>
                )}
              </>
            )}
          </>
        )}

        {/* 3. 수집DB 통계 (채널 정보 / 방송사 대본 / RSS분석 3개 탭) */}
        {!loading && activeMenu === 'DB_STATS' && (
          <>
            {dbTab === 'CHANNEL_INFO' && (
              <>
                {/* 수집현황(1번탭) 최상위 세로 막대 그래프: 언론사별 기사 수 */}
                <section className={styles.sectionCard}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                    }}
                  >
                    <h2 className={styles.sectionTitle}>
                      <BarChart2 size={20} color="#2563eb" />
                      <span>언론사별 기사 수</span>
                    </h2>
                    <span className={styles.rangePill}>
                      총 {channelArticleChartData.totalCount}건 (
                      {chartPeriodBounds.label}:{' '}
                      {chartPeriodBounds.from === chartPeriodBounds.to
                        ? chartPeriodBounds.from
                        : `${chartPeriodBounds.from} ~ ${chartPeriodBounds.to}`}
                      )
                    </span>
                  </div>

                  {/* 그래프 필터 패널: 언론사 선택(Quick selector + 개별 복수선택) / 기간 / 제목·내용·Smart(이슈 UUID) */}
                  <div className={styles.chartControlPanel}>
                    {/* 1) 언론사 Quick Selector 및 개별 복수 선택 */}
                    <div className={styles.chartControlRow}>
                      <span className={styles.chartControlLabel}>
                        언론사 선택
                      </span>
                      <div className={styles.chartControlOptions}>
                        {QUICK_CHANNEL_GROUPS.map((grp) => {
                          const isSameSet =
                            grp.channelIds.length ===
                              chartSelectedChannels.length &&
                            grp.channelIds.every((id) =>
                              chartSelectedChannels.includes(id)
                            );
                          return (
                            <button
                              key={grp.id}
                              type="button"
                              className={`${styles.quickSelectBtn} ${
                                isSameSet ? styles.quickSelectBtnActive : ''
                              }`}
                              onClick={() =>
                                setChartSelectedChannels(grp.channelIds)
                              }
                            >
                              {grp.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className={styles.chartControlRow}>
                      <span className={styles.chartControlLabel}>
                        개별 선택
                      </span>
                      <div className={styles.chartControlOptions}>
                        {Object.values(checkpointData?.channels || {}).map(
                          (ch) => {
                            const selected = chartSelectedChannels.includes(
                              ch.channelId
                            );
                            const label = formatChannelDisplayName(ch.name);
                            return (
                              <button
                                key={ch.channelId}
                                type="button"
                                className={`${styles.channelChipBtn} ${
                                  selected ? styles.channelChipBtnSelected : ''
                                }`}
                                onClick={() => {
                                  setChartSelectedChannels((prev) =>
                                    prev.includes(ch.channelId)
                                      ? prev.filter((id) => id !== ch.channelId)
                                      : [...prev, ch.channelId]
                                  );
                                }}
                                title={`${ch.name} 선택/해제 (복수 선택 가능)`}
                              >
                                {label}
                              </button>
                            );
                          }
                        )}
                      </div>
                    </div>

                    {/* 2) 기간 필터: 오늘, 어제, 이번주, 저번주, 이번달, 저번달 */}
                    <div className={styles.chartControlRow}>
                      <span className={styles.chartControlLabel}>기간</span>
                      <div className={styles.chartControlOptions}>
                        {DB_CHART_PERIOD_TABS.map((pt) => (
                          <button
                            key={pt.key}
                            type="button"
                            className={`${styles.quickSelectBtn} ${
                              chartPeriodTab === pt.key
                                ? styles.quickSelectBtnActive
                                : ''
                            }`}
                            onClick={() => setChartPeriodTab(pt.key)}
                          >
                            {pt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 3) 기사제목 / 기사내용 포함 검색 + Smart 옵션 (이슈 UUID 기반 연관 기사 추리기) */}
                    <div className={styles.chartControlRow}>
                      <span className={styles.chartControlLabel}>
                        조건 / Smart
                      </span>
                      <div className={styles.chartControlOptions}>
                        <label
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={chartSearchInTitle}
                            onChange={(e) =>
                              setChartSearchInTitle(e.target.checked)
                            }
                          />
                          <span>기사제목</span>
                        </label>

                        <label
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={chartSearchInBody}
                            onChange={(e) =>
                              setChartSearchInBody(e.target.checked)
                            }
                          />
                          <span>기사내용</span>
                        </label>

                        <input
                          type="text"
                          className={styles.smartFilterInput}
                          placeholder="제목/내용 포함 단어 입력..."
                          value={chartSearchText}
                          onChange={(e) => setChartSearchText(e.target.value)}
                        />

                        <label
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.78rem',
                            fontWeight: 800,
                            color: '#1d4ed8',
                            cursor: 'pointer',
                            marginLeft: '0.35rem',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={chartSmartMode}
                            onChange={(e) =>
                              setChartSmartMode(e.target.checked)
                            }
                          />
                          <span>Smart 옵션 (특정 이슈 연관 기사만)</span>
                        </label>

                        {chartSmartMode && (
                          <select
                            className={styles.smartIssueSelect}
                            value={
                              activeSmartIssue?.uuid ||
                              activeSmartIssue?.issueId ||
                              ''
                            }
                            onChange={(e) =>
                              setChartSelectedIssueUuid(e.target.value)
                            }
                          >
                            {chartPeriodIssues.map((iss) => {
                              const u = iss.uuid || iss.issueId;
                              const shortUuid = u.slice(0, 8);
                              const titleLabel =
                                iss.eventTitle ||
                                iss.representativeKeywords[0] ||
                                iss.title.slice(0, 20);
                              return (
                                <option key={u} value={u}>
                                  [{shortUuid}] {titleLabel} (
                                  {iss.mentionStats.totalCount}건 ·{' '}
                                  {iss.firstReportedAt.slice(0, 10)})
                                </option>
                              );
                            })}
                          </select>
                        )}
                      </div>
                    </div>

                    {chartSmartMode && activeSmartIssue && (
                      <div
                        style={{
                          fontSize: '0.76rem',
                          color: '#1e40af',
                          background: '#eff6ff',
                          border: '1px solid #bfdbfe',
                          borderRadius: '6px',
                          padding: '0.38rem 0.65rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: '0.4rem',
                        }}
                      >
                        <span>
                          <strong>선택된 이슈 문서:</strong>{' '}
                          {activeSmartIssue.eventTitle ||
                            activeSmartIssue.representativeKeywords[0]}{' '}
                          (연관 보도 매체{' '}
                          {activeSmartIssue.mentionStats.uniqueChannelsCount}곳 ·
                          총 {activeSmartIssue.mentionStats.totalCount}건)
                        </span>
                        <span style={{ fontFamily: 'monospace' }}>
                          UUID: {activeSmartIssue.uuid || activeSmartIssue.issueId}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 세로: 기사 수 / 가로: 언론사(줄인 이름 세로 출력) 막대 그래프 */}
                  <div className={styles.verticalChartLayout}>
                    <div className={styles.yAxisTitleCol}>기사 수</div>

                    <div className={styles.yAxisScaleCol}>
                      <span>{channelArticleChartData.maxCount}</span>
                      <span>
                        {Math.round(channelArticleChartData.maxCount * 0.75)}
                      </span>
                      <span>
                        {Math.round(channelArticleChartData.maxCount * 0.5)}
                      </span>
                      <span>
                        {Math.round(channelArticleChartData.maxCount * 0.25)}
                      </span>
                      <span>0</span>
                    </div>

                    <div className={styles.verticalBarsStage}>
                      <div className={styles.verticalBarsPlotArea}>
                        {channelArticleChartData.bars.map((bar) => {
                          const heightPct =
                            bar.count > 0
                              ? Math.max(
                                  4,
                                  Math.round(
                                    (bar.count /
                                      channelArticleChartData.maxCount) *
                                      100
                                  )
                                )
                              : 0;
                          return (
                            <div
                              key={bar.channelId}
                              className={styles.verticalBarCol}
                              title={`${bar.name} (${bar.shortName}): ${bar.count}건`}
                            >
                              <span className={styles.verticalBarCountNum}>
                                {bar.count}
                              </span>
                              <div
                                className={
                                  bar.mediaType === 'NEWSPAPER'
                                    ? styles.verticalBarFillPress
                                    : styles.verticalBarFillBroadcast
                                }
                                style={{ height: `${heightPct}%` }}
                              />
                            </div>
                          );
                        })}
                      </div>

                      <div className={styles.verticalXAxisLabelsRow}>
                        {channelArticleChartData.bars.map((bar) => (
                          <div
                            key={bar.channelId}
                            className={styles.verticalMediaNameCell}
                            title={bar.name}
                          >
                            <span className={styles.verticalMediaText}>
                              {bar.shortName}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className={styles.xAxisBottomCaption}>언론사</div>
                    </div>
                  </div>
                </section>

                <section className={styles.sectionCard}>
                  <div>
                    <h2 className={styles.sectionTitle}>
                      <HardDrive size={20} />
                      <span>채널별 수집 완료 범위 DB</span>
                    </h2>
                  </div>

                  <div className={styles.tableWrapper}>
                    <table className={styles.dataTable}>
                      <thead>
                        <tr>
                          {dbColumns.category && <th>구분</th>}
                          {dbColumns.name && <th>채널명</th>}
                          {dbColumns.channelId && <th>ID</th>}
                          {dbColumns.startDate && <th>수집 시작</th>}
                          {dbColumns.endDate && <th>수집 종료</th>}
                          {dbColumns.inProgress && <th>중단 복구 커서</th>}
                          {dbColumns.totalCount && <th>누적 스크립트</th>}
                          {dbColumns.diskSize && <th>로컬 용량</th>}
                          {dbColumns.lastCrawledAt && <th>마지막 수집 시각</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {checkpointChannels.map((ch) => {
                          const bounds = getChannelDateBounds(
                            ch.completedRanges
                          );
                          return (
                            <tr key={ch.channelId}>
                              {dbColumns.category && (
                                <td>
                                  {ch.mediaType === 'NEWSPAPER' ? (
                                    <span className={styles.badgeOk}>
                                      종합일간지
                                    </span>
                                  ) : (
                                    <span className={styles.rangePill}>
                                      방송사 유튜브
                                    </span>
                                  )}
                                </td>
                              )}
                              {dbColumns.name && (
                                <td>
                                  <strong>
                                    {formatChannelDisplayName(ch.name)}
                                  </strong>
                                </td>
                              )}
                              {dbColumns.channelId && (
                                <td
                                  style={{
                                    fontFamily: 'monospace',
                                    fontSize: '0.78rem',
                                    color: '#475569',
                                  }}
                                >
                                  {ch.channelId}
                                </td>
                              )}
                              {dbColumns.startDate && (
                                <td>
                                  <span className={styles.rangePill}>
                                    {bounds.minStart}
                                  </span>
                                </td>
                              )}
                              {dbColumns.endDate && (
                                <td>
                                  <span className={styles.rangePill}>
                                    {bounds.maxEnd}
                                  </span>
                                </td>
                              )}
                              {dbColumns.inProgress && (
                                <td>
                                  {ch.inProgress ? (
                                    <span className={styles.badgeWarn}>
                                      {ch.inProgress.date} (
                                      {ch.inProgress.lastPage}p 진행중)
                                    </span>
                                  ) : (
                                    <span
                                      style={{
                                        color: '#64748b',
                                        fontSize: '0.78rem',
                                      }}
                                    >
                                      정상 완료
                                    </span>
                                  )}
                                </td>
                              )}
                              {dbColumns.totalCount && (
                                <td>
                                  <strong>{ch.totalCollectedCount}</strong>건
                                </td>
                              )}
                              {dbColumns.diskSize && (
                                <td>
                                  {(ch.rawBytesOnDisk / 1024).toFixed(1)} KB
                                </td>
                              )}
                              {dbColumns.lastCrawledAt && (
                                <td
                                  style={{
                                    fontSize: '0.78rem',
                                    color: '#475569',
                                  }}
                                >
                                  {ch.lastCrawledAt
                                    ? ch.lastCrawledAt
                                        .replace('T', ' ')
                                        .slice(0, 19)
                                    : '-'}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}

            {dbTab === 'BROADCAST_SCRIPT' && parserReport && (
              <section className={styles.sectionCard}>
                <div>
                  <h2 className={styles.sectionTitle}>
                    <Tv size={20} />
                    <span>방송사 대본</span>
                  </h2>
                </div>

                <div className={styles.tableWrapper}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th>채널명</th>
                        <th>채널ID</th>
                        <th>공식RSS</th>
                        <th>설명란</th>
                        <th>기본 자막</th>
                        <th>뉴스대본</th>
                        <th>스크립트 수집방식</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parserReport.broadcasters
                        .filter(() => filters.mediaTypes.includes('BROADCAST'))
                        .filter((bc) => {
                          if (!filters.searchQuery.trim()) return true;
                          const q = filters.searchQuery.trim().toLowerCase();
                          return (
                            bc.name.toLowerCase().includes(q) ||
                            getMediaAlias(bc.name, mediaAliases)
                              .toLowerCase()
                              .includes(q) ||
                            bc.channelId.toLowerCase().includes(q)
                          );
                        })
                        .map((bc) => {
                          const scriptFormula = bc.descriptionScriptAnalysis
                            .providesScriptInDescription
                            ? 'A + B + C'
                            : 'B + C';
                          return (
                            <tr key={bc.channelId}>
                              <td>
                                <strong>
                                  {formatChannelDisplayName(bc.name)}
                                </strong>
                              </td>
                              <td
                                style={{
                                  fontFamily: 'monospace',
                                  fontSize: '0.78rem',
                                }}
                              >
                                {bc.verifiedYoutubeChannelId}
                              </td>
                              <td>
                                {bc.youtubeRssReachable ? (
                                  <span className={styles.badgeOk}>
                                    정상 ({bc.rssVideoCount}건)
                                  </span>
                                ) : (
                                  <span className={styles.badgeWarn}>
                                    확인 필요
                                  </span>
                                )}
                              </td>
                              <td>
                                {bc.descriptionScriptAnalysis
                                  .providesScriptInDescription ? (
                                  <span className={styles.badgeOk}>
                                    평균{' '}
                                    {
                                      bc.descriptionScriptAnalysis
                                        .avgDescriptionChars
                                    }
                                    자 (전문)
                                  </span>
                                ) : (
                                  <span className={styles.badgeWarn}>
                                    평균{' '}
                                    {
                                      bc.descriptionScriptAnalysis
                                        .avgDescriptionChars
                                    }
                                    자 (요약)
                                  </span>
                                )}
                              </td>
                              <td>
                                {bc.youtubeCaptionTrackAnalysis
                                  .hasCaptionTracks ? (
                                  <span className={styles.badgeOk}>제공</span>
                                ) : (
                                  <span
                                    style={{
                                      color: '#64748b',
                                      fontSize: '0.78rem',
                                    }}
                                  >
                                    보조 활용
                                  </span>
                                )}
                              </td>
                              <td>
                                {bc.portalBroadcastTranscriptFallback
                                  .reachable ? (
                                  <span>
                                    정상 (1p{' '}
                                    {
                                      bc.portalBroadcastTranscriptFallback
                                        .page1TranscriptCount
                                    }
                                    건)
                                  </span>
                                ) : (
                                  <span>-</span>
                                )}
                              </td>
                              <td>
                                <span className={styles.codeFormulaBadge}>
                                  {scriptFormula}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>

                {/* 스크립트 수집방식 A, B, C 설명란 */}
                <div className={styles.remarkLegendBox}>
                  <span className={styles.remarkLegendTitle}>
                    스크립트 수집방식 설명 (A · B · C)
                  </span>
                  <div className={styles.remarkLegendGrid}>
                    <div className={styles.remarkLegendItem}>
                      <span className={styles.remarkCodeKey}>A</span>
                      <span>
                        <strong>유튜브 설명란(Description) 대본 파싱:</strong>{' '}
                        공식 유튜브 RSS의 <code>media:description</code>에 수록된
                        뉴스 리포트 원고 전문을 1순위로 추출합니다.
                      </span>
                    </div>
                    <div className={styles.remarkLegendItem}>
                      <span className={styles.remarkCodeKey}>B</span>
                      <span>
                        <strong>유튜브 기본 자막 트랙 추출:</strong> 설명란에
                        리포트 전문이 없거나 짧은 영상의 경우 유튜브 기본 제공
                        한국어 자막 트랙(<code>captionTracks</code>)을 보조로
                        활용합니다.
                      </span>
                    </div>
                    <div className={styles.remarkLegendItem}>
                      <span className={styles.remarkCodeKey}>C</span>
                      <span>
                        <strong>포털 TV뉴스 리포트 원고 보강:</strong> 방송사별
                        일자별 포털 TV뉴스 아카이브(<code>LPOD</code>)의 리포트
                        대본을 결합하여 누락 없는 당일·과거 보도 스크립트를
                        완성합니다.
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {dbTab === 'RSS_ANALYSIS' && parserReport && (
              <section className={styles.sectionCard}>
                <div>
                  <h2 className={styles.sectionTitle}>
                    <Newspaper size={20} />
                    <span>RSS분석</span>
                  </h2>
                </div>

                <div className={styles.tableWrapper}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th style={{ width: '58px' }}>순위</th>
                        <th>언론사</th>
                        <th>포털정답지</th>
                        <th>RSS응답</th>
                        <th>본문포함</th>
                        <th>DOM 선택자</th>
                        <th>파싱 전략</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parserReport.newspapers
                        .filter(() => filters.mediaTypes.includes('NEWSPAPER'))
                        .filter((np) => {
                          if (!filters.searchQuery.trim()) return true;
                          const q = filters.searchQuery.trim().toLowerCase();
                          return (
                            np.name.toLowerCase().includes(q) ||
                            getMediaAlias(np.name, mediaAliases)
                              .toLowerCase()
                              .includes(q) ||
                            np.channelId.toLowerCase().includes(q)
                          );
                        })
                        .map((np) => {
                          const workingRss = np.officialRssDiagnostics.filter(
                            (r) => r.reachable
                          );
                          const bestRss =
                            workingRss[0] || np.officialRssDiagnostics[0];
                          const domFormula = resolveNewspaperDomSymbols(
                            np.originalArticleDom?.detectedSelectors || []
                          );
                          const strategyFormula =
                            resolveNewspaperStrategyFormula(
                              workingRss.length > 0,
                              bestRss?.contentProvideLevel
                            );

                          return (
                            <tr key={np.channelId}>
                              <td>
                                <strong>{np.rank}</strong>
                              </td>
                              <td>
                                <strong>
                                  {formatChannelDisplayName(np.name)}
                                </strong>
                              </td>
                              <td>
                                {np.portalGroundTruth.reachable ? (
                                  <span className={styles.badgeOk}>
                                    <CheckCircle2
                                      size={12}
                                      style={{ verticalAlign: '-2px' }}
                                    />{' '}
                                    정상 (
                                    {np.portalGroundTruth.samplePublishedAt.slice(
                                      5,
                                      16
                                    )}
                                    )
                                  </span>
                                ) : (
                                  <span className={styles.badgeWarn}>오류</span>
                                )}
                              </td>
                              <td>
                                {workingRss.length > 0 ? (
                                  <span className={styles.badgeOk}>
                                    작동 ({workingRss.length}/
                                    {np.officialRssDiagnostics.length}개 ·{' '}
                                    {bestRss?.itemCount ?? 0}건)
                                  </span>
                                ) : (
                                  <span className={styles.badgeWarn}>
                                    <AlertCircle
                                      size={12}
                                      style={{ verticalAlign: '-2px' }}
                                    />{' '}
                                    미제공/변경
                                  </span>
                                )}
                              </td>
                              <td>
                                {bestRss ? (
                                  <span>
                                    {bestRss.contentProvideLevel} (평균{' '}
                                    {bestRss.avgDescriptionChars}자)
                                  </span>
                                ) : (
                                  <span>-</span>
                                )}
                              </td>
                              <td>
                                <span className={styles.codeFormulaBadgeDom}>
                                  {domFormula}
                                </span>
                              </td>
                              <td>
                                <span className={styles.codeFormulaBadge}>
                                  {strategyFormula}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>

                {/* 비고: DOM 선택자(ㄱ~ㅁ) 및 파싱 전략(A~D) 서술 */}
                <div className={styles.remarkLegendBox}>
                  <span className={styles.remarkLegendTitle}>
                    비고 — DOM 선택자 (ㄱ ~ ㅁ)
                  </span>
                  <div className={styles.remarkLegendGrid}>
                    <div className={styles.remarkLegendItem}>
                      <span className={styles.remarkCodeKey}>ㄱ</span>
                      <span>
                        <code>meta[property=&quot;article:published_time&quot;]</code>{' '}
                        (OpenGraph 기사 최초 입력 시각 메타태그)
                      </span>
                    </div>
                    <div className={styles.remarkLegendItem}>
                      <span className={styles.remarkCodeKey}>ㄴ</span>
                      <span>
                        <code>script[type=&quot;application/ld+json&quot;]</code>{' '}
                        (구조화 데이터 JSON-LD 뉴스 기사 스키마)
                      </span>
                    </div>
                    <div className={styles.remarkLegendItem}>
                      <span className={styles.remarkCodeKey}>ㄷ</span>
                      <span>
                        <code>&lt;article&gt;</code> (HTML5 시맨틱 기사 본문
                        컨테이너 태그)
                      </span>
                    </div>
                    <div className={styles.remarkLegendItem}>
                      <span className={styles.remarkCodeKey}>ㄹ</span>
                      <span>
                        <code>#article-body</code> (ID 기반 기사 본문 영역
                        셀렉터)
                      </span>
                    </div>
                    <div className={styles.remarkLegendItem}>
                      <span className={styles.remarkCodeKey}>ㅁ</span>
                      <span>
                        <code>.article_body / .article_view</code> (클래스 기반
                        기사 본문 영역 셀렉터)
                      </span>
                    </div>
                  </div>

                  <span
                    className={styles.remarkLegendTitle}
                    style={{ marginTop: '0.4rem' }}
                  >
                    비고 — 파싱 전략 (A ~ D)
                  </span>
                  <div className={styles.remarkLegendGrid}>
                    <div className={styles.remarkLegendItem}>
                      <span className={styles.remarkCodeKey}>A</span>
                      <span>
                        <strong>공식 RSS 본문 전문 단독 수집:</strong> 공식 RSS에
                        기사 본문 전문(<code>FULL_TEXT</code>)이 포함되어 있어
                        RSS 단독 파싱이 가능합니다.
                      </span>
                    </div>
                    <div className={styles.remarkLegendItem}>
                      <span className={styles.remarkCodeKey}>B</span>
                      <span>
                        <strong>공식 RSS / Sitemap URL 수집:</strong> 공식 RSS가
                        요약문 또는 링크만 제공하므로 최신 기사 원문 URL 목록을
                        수집합니다.
                      </span>
                    </div>
                    <div className={styles.remarkLegendItem}>
                      <span className={styles.remarkCodeKey}>C</span>
                      <span>
                        <strong>포털 정답지(LPOD) 일자별 수집:</strong> 언론사별
                        일자별 목록(<code>oid + date</code>)에서 기사 입력 시각과
                        원문 링크(<code>originallink</code>)를 수집합니다.
                      </span>
                    </div>
                    <div className={styles.remarkLegendItem}>
                      <span className={styles.remarkCodeKey}>D</span>
                      <span>
                        <strong>원문 웹페이지 DOM 직접 파싱 결합:</strong> 원문
                        URL에 접속하여 표준 DOM 선택자(<code>ㄱ~ㅁ</code>)로
                        메타데이터 및 본문을 직접 추출·결합합니다.
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </>
        )}

        {/* 4. Top10 (사이드바 하위 이슈 선택 시 특별 홍보관 방식 집중 뷰) */}
        {!loading && activeMenu === 'TOP10' && (
          <>
            <section className={styles.top10QuickStrip}>
              {top10Issues.map((issue, idx) => {
                const isSelected =
                  selectedTop10Issue?.issueId === issue.issueId;
                return (
                  <button
                    key={issue.issueId}
                    type="button"
                    className={`${styles.top10QuickBtn} ${
                      isSelected ? styles.top10QuickBtnActive : ''
                    }`}
                    onClick={() => setSelectedTop10IssueId(issue.issueId)}
                  >
                    <span>{idx + 1}위.</span>
                    <span>
                      {issue.eventTitle ||
                        issue.representativeKeywords[0] ||
                        '주요 이슈'}
                    </span>
                    <span style={{ opacity: 0.8, fontSize: '0.72rem' }}>
                      ({issue.mentionStats.totalCount}회)
                    </span>
                  </button>
                );
              })}
            </section>

            {selectedTop10Issue && (
              <section className={styles.issuesGrid}>
                {renderIssueSummaryCard(selectedTop10Issue, selectedTop10Rank)}
              </section>
            )}
          </>
        )}

        {/* 5. 연중이슈 (표로 보기 / 타임라인 2개 탭) */}
        {!loading && activeMenu === 'ANNUAL_ISSUES' && (
          <>
            {annualTab === 'TABLE' && (
              <section className={styles.sectionCard}>
                <div>
                  <h2 className={styles.sectionTitle}>
                    <CalendarRange size={20} />
                    <span>연중이슈 — 표로 보기 ({filteredIssues.length}건)</span>
                  </h2>
                  <p className={styles.sectionDesc}>
                    상단 헤더의 <strong>표시열 아이콘</strong>을 눌러 열 구성을
                    조절할 수 있습니다.
                  </p>
                </div>

                <div className={styles.tableWrapper}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        {annualColumns.date && <th>최초 보도일시</th>}
                        {annualColumns.title && <th>이슈명 / 평가</th>}
                        {annualColumns.keywords && <th>구체적 사건 키워드</th>}
                        {annualColumns.newspaperCount && <th>신문 보도</th>}
                        {annualColumns.broadcastCount && <th>방송 보도</th>}
                        {annualColumns.totalCount && <th>총 보도수</th>}
                        {annualColumns.firstChannel && (
                          <th>최초 보도 매체 (별명)</th>
                        )}
                        {annualColumns.factCount && <th>요약 문장 수</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredIssues.map((issue) => {
                        const evalInfo = resolveEvaluationInfo(
                          issue.impactMetrics
                        );
                        return (
                          <tr
                            key={issue.issueId}
                            style={{ cursor: 'pointer' }}
                            onClick={() => {
                              setSelectedTop10IssueId(issue.issueId);
                              setActiveMenu('TOP10');
                            }}
                            title="클릭 시 해당 이슈 상세 카드로 이동"
                          >
                            {annualColumns.date && (
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <span className={styles.rangePill}>
                                  {issue.firstReportedAt.slice(0, 16)}
                                </span>
                              </td>
                            )}
                            {annualColumns.title && (
                              <td>
                                <strong>
                                  {issue.eventTitle ||
                                    issue.representativeKeywords[0]}
                                </strong>{' '}
                                <span className={evalInfo.badgeClass}>
                                  {evalInfo.label}
                                </span>
                              </td>
                            )}
                            {annualColumns.keywords && (
                              <td>
                                <div className={styles.issueKeywordsRow}>
                                  {issue.representativeKeywords
                                    .slice(0, 3)
                                    .map((kw) => (
                                      <span
                                        key={kw}
                                        className={styles.issueKwTag}
                                      >
                                        #{kw}
                                      </span>
                                    ))}
                                </div>
                              </td>
                            )}
                            {annualColumns.newspaperCount && (
                              <td>{issue.mentionStats.newspaperCount}건</td>
                            )}
                            {annualColumns.broadcastCount && (
                              <td>{issue.mentionStats.broadcastCount}건</td>
                            )}
                            {annualColumns.totalCount && (
                              <td>
                                <strong>{issue.mentionStats.totalCount}회</strong>
                              </td>
                            )}
                            {annualColumns.firstChannel && (
                              <td>
                                <span className={styles.badgeOk}>
                                  {`{${getMediaAlias(
                                    issue.firstReportedChannel,
                                    mediaAliases
                                  )}}`}
                                </span>
                              </td>
                            )}
                            {annualColumns.factCount && (
                              <td>{issue.facts.length}문장</td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {annualTab === 'TIMELINE' && (
              <section className={styles.sectionCard}>
                <div>
                  <h2 className={styles.sectionTitle}>
                    <Clock size={20} />
                    <span>
                      연중이슈 — 타임라인 (최초 보도 별명 표시 · 후속 보도 ▼ 마우스오버 ·
                      신규 사실 추가 시 키워드 명시)
                    </span>
                  </h2>
                  <p className={styles.sectionDesc}>
                    어제(11/08)부터 오늘(11/09)까지 시간순으로 최초 보도 매체가 자동
                    갱신되며, 후속 보도는 <code>{`{외 N}`}</code> 및 <code>▼</code>{' '}
                    마우스오버로 확인할 수 있습니다.
                  </p>
                </div>

                <div className={styles.timelineList}>
                  {[...filteredIssues]
                    .sort((a, b) =>
                      b.firstReportedAt.localeCompare(a.firstReportedAt)
                    )
                    .map((issue) => {
                      const evalInfo = resolveEvaluationInfo(
                        issue.impactMetrics
                      );
                      return (
                        <div key={issue.issueId} className={styles.timelineNode}>
                          <div className={styles.timelineHeaderBar}>
                            <span className={styles.timelineDateBadge}>
                              🥇 최초 보도:{' '}
                              {`{${getMediaAlias(
                                issue.firstReportedChannel,
                                mediaAliases
                              )}}`}{' '}
                              ({issue.firstReportedAt})
                            </span>
                            <span className={evalInfo.badgeClass}>
                              평가: {evalInfo.label}
                            </span>
                            {renderSingleScoreGaugeBar(issue.impactMetrics)}
                          </div>
                          <h3 className={styles.issueTitle}>
                            {issue.eventTitle ||
                              issue.representativeKeywords[0]}
                          </h3>
                          <div className={styles.factsList}>
                            {issue.facts.map((fact) =>
                              renderTimelineFactItem(fact)
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </section>
            )}
          </>
        )}

        {/* 6. 설정 (언론사 별명 변경 기능 + 파이프라인 설정) */}
        {!loading && activeMenu === 'SETTINGS' && (
          <>
            <section className={styles.sectionCard}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                }}
              >
                <div>
                  <h2 className={styles.sectionTitle}>
                    <Settings size={20} />
                    <span>
                      언론사 별명(Alias) 설정 (방송사 20곳 · 일간지 20곳)
                    </span>
                  </h2>
                  <p className={styles.sectionDesc}>
                    언론사 분석 가로 막대 그래프와 이슈 요약 문장 꼬리표(
                    <code>{`{조선}`}</code>, <code>{`{JTBC}`}</code>,{' '}
                    <code>{`{연합}`}</code> 등)에 사용되는 언론사 별명을 자유롭게
                    변경할 수 있습니다.
                  </p>
                </div>

                <button
                  type="button"
                  className={styles.aliasResetBtn}
                  onClick={handleResetAliases}
                >
                  <RotateCcw size={14} />
                  <span>기본 별명으로 초기화</span>
                </button>
              </div>

              <div className={styles.aliasGroupColumns}>
                {/* 방송사 별명 편집 표 */}
                <div className={styles.aliasGroupBox}>
                  <h3 className={styles.aliasGroupTitle}>
                    방송사 공식 채널 별명 (20곳)
                  </h3>
                  <div className={styles.aliasListGrid}>
                    {MEDIA_ALIAS_ENTRIES.filter(
                      (e) => e.group === 'BROADCAST'
                    ).map((entry) => (
                      <label
                        key={entry.canonicalName}
                        className={styles.aliasEditRow}
                      >
                        <span className={styles.aliasCanonicalLabel}>
                          {entry.canonicalName}
                        </span>
                        <input
                          type="text"
                          className={styles.aliasInput}
                          value={
                            mediaAliases[entry.canonicalName] ??
                            entry.defaultAlias
                          }
                          onChange={(e) =>
                            handleUpdateAlias(
                              entry.canonicalName,
                              e.target.value
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>

                {/* 일간지 별명 편집 표 */}
                <div className={styles.aliasGroupBox}>
                  <h3 className={styles.aliasGroupTitle}>
                    전국·지역 일간지 별명 (20곳)
                  </h3>
                  <div className={styles.aliasListGrid}>
                    {MEDIA_ALIAS_ENTRIES.filter(
                      (e) => e.group === 'NEWSPAPER'
                    ).map((entry) => (
                      <label
                        key={entry.canonicalName}
                        className={styles.aliasEditRow}
                      >
                        <span className={styles.aliasCanonicalLabel}>
                          {entry.canonicalName}
                        </span>
                        <input
                          type="text"
                          className={styles.aliasInput}
                          value={
                            mediaAliases[entry.canonicalName] ??
                            entry.defaultAlias
                          }
                          onChange={(e) =>
                            handleUpdateAlias(
                              entry.canonicalName,
                              e.target.value
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className={styles.sectionCard}>
              <div>
                <h2 className={styles.sectionTitle}>
                  <HardDrive size={20} />
                  <span>수집 파이프라인 및 스크립트 보관주기 설정</span>
                </h2>
                <p className={styles.sectionDesc}>
                  원본 스크립트 보관 기간(TTL), 자동 폐기 정책, 키워드 추출 엔진
                  모드(무료 로컬 vs 유료 LLM)를 관리합니다.
                </p>
              </div>

              <div className={styles.settingsGrid}>
                <div className={styles.settingBox}>
                  <span className={styles.settingTitle}>
                    1. 원본 스크립트 로컬 보관 기간 (TTL)
                  </span>
                  <p className={styles.settingDesc}>
                    이슈 카드에 신규 문장 발췌가 끝난 원본 스크립트를 역추적(Trace)
                    용도로 보관하는 기간입니다. 기한 경과 시 자동 폐기됩니다.
                  </p>
                  <div className={styles.settingControlRow}>
                    <select
                      value={retentionDaysSetting}
                      onChange={(e) =>
                        setRetentionDaysSetting(Number(e.target.value))
                      }
                      style={{
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                        fontWeight: 700,
                      }}
                    >
                      <option value={7}>7일 (1주)</option>
                      <option value={14}>14일 (2주)</option>
                      <option value={30}>30일 (1개월 - 권장)</option>
                      <option value={60}>60일 (2개월)</option>
                    </select>
                    <span className={styles.badgeOk}>
                      현재 적용: {retentionDaysSetting}일
                    </span>
                  </div>
                </div>

                <div className={styles.settingBox}>
                  <span className={styles.settingTitle}>
                    2. 문장 발췌 확인 후 자동 폐기 (Auto-Purge)
                  </span>
                  <p className={styles.settingDesc}>
                    <code>npm.cmd run purge:expired</code> (30일 경과분 폐기) 또는{' '}
                    <code>npm.cmd run purge:processed</code> (확인 즉시 처분) 명령과
                    연동됩니다.
                  </p>
                  <div className={styles.settingControlRow}>
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={autoPurgeSetting}
                        onChange={(e) => setAutoPurgeSetting(e.target.checked)}
                      />
                      <span>보관 기한 만료 시 자동 폐기 활성화</span>
                    </label>
                  </div>
                </div>

                <div className={styles.settingBox}>
                  <span className={styles.settingTitle}>
                    3. 키워드 결합 및 문장 발췌 엔진 모드
                  </span>
                  <p className={styles.settingDesc}>
                    초기에는 토큰 비용이 없는 로컬 한국어 결합단어 알고리즘 + 원문
                    문장 통째 발췌 방식을 사용하며, 추후 유료 LLM API로 확장할 수
                    있습니다.
                  </p>
                  <div className={styles.settingControlRow}>
                    <select
                      value={engineModeSetting}
                      onChange={(e) =>
                        setEngineModeSetting(
                          e.target.value as 'LOCAL_FREE' | 'HYBRID_LLM'
                        )
                      }
                      style={{
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                        fontWeight: 700,
                      }}
                    >
                      <option value="LOCAL_FREE">
                        무료 로컬 엔진 (구체적 사건어 통계 + 원문 문장 통째 발췌)
                      </option>
                      <option value="HYBRID_LLM">
                        하이브리드 유료 엔진 (로컬 1차 필터 + LLM 정제)
                      </option>
                    </select>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {/* 7. 소개 */}
        {!loading && activeMenu === 'ABOUT' && (
          <section className={styles.sectionCard}>
            <div>
              <h2 className={styles.sectionTitle}>
                <Info size={20} />
                <span>KoreaIssues 프로젝트 소개 ({APP_VERSION_DISPLAY})</span>
              </h2>
              <p className={styles.sectionDesc}>
                대한민국 주요 종합일간지 Top 10 및 방송사 공식 뉴스 유튜브 채널의
                보도 내용과 보도 횟수를 수집·분석하여 언론사 별명 기반의 시간순 출처
                꼬리표(<code>{`{조선}`}</code>, <code>{`{외 4}`}</code> 등)와 함께
                이슈를 요약·공유하는 웹 애플리케이션입니다.
              </p>
            </div>

            <div className={styles.settingsGrid}>
              <div className={styles.settingBox}>
                <span className={styles.settingTitle}>
                  <Award size={16} style={{ verticalAlign: '-2px' }} /> 0단계:
                  채택 정당성 가로 막대 그래프 & 언론사 별명 관리
                </span>
                <p className={styles.settingDesc}>
                  최근 10년 구독자 추이 기준 상위 10대 종합일간지와 방송사 공식
                  유튜브 채널을 가로 막대 애니메이션으로 비교하며, 설정에서 각
                  언론사의 별명을 자유롭게 지정할 수 있습니다.
                </p>
              </div>

              <div className={styles.settingBox}>
                <span className={styles.settingTitle}>
                  <HardDrive size={16} style={{ verticalAlign: '-2px' }} /> 1단계:
                  어제~과거 순차 수집 & 최초 보도 자동 갱신
                </span>
                <p className={styles.settingDesc}>
                  어제 날짜의 이전 보도가 추가로 수집되면 시간순 정렬을 통해 해당
                  이슈와 문장의 최초 보도 매체 꼬리표가 자동으로 갱신됩니다.
                </p>
              </div>

              <div className={styles.settingBox}>
                <span className={styles.settingTitle}>
                  <Newspaper size={16} style={{ verticalAlign: '-2px' }} /> 2~3단계:
                  단일 점수 바(언론·대중 게이지) & 상단 평가
                </span>
                <p className={styles.settingDesc}>
                  하나의 점수 바 안에 언론 보도 강도와 대중 소비·검색 게이지를 함께
                  표시하고 상단에 <code>언론 과소보도</code>,{' '}
                  <code>언론 과대보도</code>, <code>언론에 관심없음</code>,{' '}
                  <code>언론 보도 일반 관심</code> 평가를 배치합니다.
                </p>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
