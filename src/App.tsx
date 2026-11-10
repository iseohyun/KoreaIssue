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
  MainMenuView,
  MediaAnalysisTab,
  ParserAnalysisReport,
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
  selectedChannelId: 'ALL',
  minMentionCount: 1,
};

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

export function App() {
  const [activeMenu, setActiveMenu] = useState<MainMenuView>('ISSUE_SUMMARY');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  const [mediaTab, setMediaTab] = useState<MediaAnalysisTab>('NEWSPAPER');
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

  // 언론사 별명(Alias) 상태 관리 (설정 화면에서 실시간 변경 및 localStorage 영구 저장)
  const [mediaAliases, setMediaAliases] = useState<Record<string, string>>(() =>
    loadMediaAliases()
  );

  const [retentionDaysSetting, setRetentionDaysSetting] = useState<number>(30);
  const [autoPurgeSetting, setAutoPurgeSetting] = useState<boolean>(true);
  const [engineModeSetting, setEngineModeSetting] = useState<
    'LOCAL_FREE' | 'HYBRID_LLM'
  >('LOCAL_FREE');

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

  // Top10 자격(구체적 사건성 + 복수 매체 보도)을 충족한 이슈만 선별
  const top10Issues = useMemo<IssueCard[]>(() => {
    if (!issuesData?.issues) return [];
    return issuesData.issues
      .filter((it) => it.qualifiesForTop10 !== false)
      .sort((a, b) => b.mentionStats.totalCount - a.mentionStats.totalCount)
      .slice(0, 10);
  }, [issuesData]);

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

  // 개별 기사는 이슈요약에 등장하지 않도록 복수 매체가 교차 보도한 검증된 이슈만 필터링
  const filteredIssues = useMemo(() => {
    if (!issuesData?.issues) return [];
    return issuesData.issues.filter((issue) => {
      // 단일 매체/개별 기사는 이슈 요약에서 원천 제외
      if (
        issue.mentionStats.uniqueChannelsCount < 2 ||
        issue.mentionStats.totalCount < 3
      ) {
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
  }, [issuesData, filters, mediaAliases]);

  const checkpointChannels = useMemo(() => {
    if (!checkpointData?.channels) return [];
    const list = Object.values(checkpointData.channels);
    if (!filters.searchQuery.trim()) return list;
    const q = filters.searchQuery.trim().toLowerCase();
    return list.filter(
      (ch) =>
        ch.name.toLowerCase().includes(q) ||
        getMediaAlias(ch.name, mediaAliases).toLowerCase().includes(q) ||
        ch.channelId.toLowerCase().includes(q)
    );
  }, [checkpointData, filters.searchQuery, mediaAliases]);

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
  const renderInlineFactSentence = (fact: FactItem) => {
    const firstCit = fact.citations[0];
    const followUps = fact.citations.slice(1);
    const cleanSent = fact.sentence.replace(/[.?!]+$/, '').trim();
    const firstAlias = firstCit
      ? getMediaAlias(firstCit.channelName, mediaAliases)
      : '';

    return (
      <span key={fact.factId} className={styles.inlineFactSegment}>
        <span className={styles.inlineSentenceText}>{cleanSent}</span>{' '}
        {firstCit && (
          <a
            href={firstCit.url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.inlineBraceTagFirst}
            title={`최초 보도: ${firstCit.channelName} (${firstCit.publishedAt})`}
          >
            {`{${firstAlias}}`}
          </a>
        )}
        {/* 후속 보도가 정확히 1개인 경우: {외 1} 대신 해당 매체 별명 {연합} 등을 직접 표기 */}
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
              {`{${getMediaAlias(followUps[0].channelName, mediaAliases)}}`}
            </a>
          </>
        )}
        {/* 후속 보도가 2개 이상인 경우: {외 N}으로 표시하고 마우스오버 시 상세 매체·시각 팝오버 노출 */}
        {followUps.length >= 2 && (
          <>
            {' '}
            <span className={styles.followUpHoverWrap}>
              <span className={styles.inlineBraceTagMore}>
                {`{외 ${followUps.length}}`}
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
                      {`{${getMediaAlias(fc.channelName, mediaAliases)}}`}{' '}
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

    return (
      <article key={issue.issueId} className={styles.issueCard}>
        {/* 화면/카드 최상단: 평가 문구 + 하나의 점수 바(언론/대중 게이지) */}
        <div className={styles.issueTopEvalBar}>
          <div className={styles.evalLeftGroup}>
            <span className={styles.evalPrefixLabel}>평가</span>
            <span className={evalInfo.badgeClass}>{evalInfo.label}</span>
            <span className={styles.firstReportUpdatedChip}>
              최초 보도: {`{${firstChannelAlias}}`} (
              {formatShortTimestamp(issue.firstReportedAt)})
            </span>
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

        {/* 요약된 이슈 본문 문단 ({별명} {외 N} / 1개인 경우 {별명2}) */}
        <div className={styles.narrativeSummaryBox}>
          <p className={styles.narrativeParagraph}>
            {issue.facts.map((fact) => renderInlineFactSentence(fact))}
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
        dbTab={dbTab}
        annualTab={annualTab}
        selectedTop10Issue={selectedTop10Issue}
        selectedTop10Rank={selectedTop10Rank}
        filters={filters}
        dbColumns={dbColumns}
        annualColumns={annualColumns}
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        onChangeMediaTab={setMediaTab}
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

        {/* 2. 이슈 요약 (기본 화면: 상단 [순위 | 주제 | 대중 | 언론 | 비고] 비교 표 + 사건 키워드 + 요약 문단 카드, 개별 기사 미노출) */}
        {!loading && activeMenu === 'ISSUE_SUMMARY' && (
          <>
            {/* 상단 비교 표: 순위, 주제, 대중(오른쪽 정렬 왼쪽 성장), 언론(왼쪽 정렬 오른쪽 성장), 비고(언론 과대 / 언론 과소만 체크) */}
            <section className={styles.impactChartCard}>
              <div className={styles.impactChartHeader}>
                <div>
                  <h2 className={styles.sectionTitle}>
                    <BarChart2 size={19} color="#2563eb" />
                    <span>이슈 요약 — 대중 vs 언론 보도 강도 비교 표</span>
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
                    {top10Issues.map((issue, idx) => {
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
                          <td className={styles.cellTopicText}>{labelText}</td>

                          {/* 대중: 중간 기준 오른쪽 정렬, 왼쪽으로 성장 (1위만 대중 텍스트+수치가 그래프와 겹쳐 표시) */}
                          <td className={styles.cellButterflyPublic}>
                            <div className={styles.butterflyTrackPublic}>
                              <div
                                className={styles.butterflyBarPublic}
                                style={{ width: `${pullWidth}%` }}
                              />
                              {isFirstRank && (
                                <span className={styles.butterflyOverlayPublic}>
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
                                <span className={styles.butterflyOverlayMedia}>
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
                      <span key={tr.keyword} className={styles.trendItemChip}>
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
                    onClick={() => handleUpdateFilter('selectedKeyword', null)}
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
                {(issuesData?.recommendedKeywords || [])
                  .slice(0, 24)
                  .map((kw) => {
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
            <section className={styles.issuesGrid}>
              {filteredIssues.map((issue) => renderIssueSummaryCard(issue))}
            </section>
          </>
        )}

        {/* 3. 수집DB 통계 (채널 정보 / 방송사 대본 / RSS분석 3개 탭) */}
        {!loading && activeMenu === 'DB_STATS' && (
          <>
            {dbTab === 'CHANNEL_INFO' && (
              <>
                <section className={styles.summaryStrip}>
                  <div className={styles.statCard}>
                    <span className={styles.statLabel}>
                      수집 관리 채널 (일간지+방송사)
                    </span>
                    <span className={styles.statValue}>
                      {checkpointData?.storageSummary.totalChannels ?? 19}곳
                    </span>
                    <span className={styles.statSub}>
                      전국 종합일간지 Top 10 · 방송사 공식 유튜브 9곳 (1:1)
                    </span>
                  </div>
                  <div className={styles.statCard}>
                    <span className={styles.statLabel}>
                      분석된 뉴스·방송 스크립트
                    </span>
                    <span className={styles.statValue}>
                      {issuesData?.totalScriptsAnalyzed ?? 0}건
                    </span>
                    <span className={styles.statSub}>
                      어제(11/08)~오늘(11/09) 누적 · Top10 적격{' '}
                      {top10Issues.length}개
                    </span>
                  </div>
                  <div className={styles.statCard}>
                    <span className={styles.statLabel}>
                      로컬 Raw 스크립트 용량
                    </span>
                    <span className={styles.statValue}>
                      {checkpointData?.storageSummary.rawDiskKB ?? 0} KB
                    </span>
                    <span className={styles.statSub}>
                      약 {checkpointData?.storageSummary.rawDiskMB ?? 0} MB (파일{' '}
                      {checkpointData?.storageSummary.rawFilesCount ?? 0}개)
                    </span>
                  </div>
                  <div className={styles.statCard}>
                    <span className={styles.statLabel}>
                      원본 스크립트 보관·폐기 정책
                    </span>
                    <span className={styles.statValue}>
                      {issuesData?.retentionPolicy.retentionDays ?? 30}일 보관 후
                      폐기
                    </span>
                    <span className={styles.statSub}>
                      문장 발췌 후 1개월 트레이스 유지 뒤 자동 폐기
                    </span>
                  </div>
                </section>

                <section className={styles.sectionCard}>
                  <div>
                    <h2 className={styles.sectionTitle}>
                      <HardDrive size={20} />
                      <span>채널별 수집 완료 범위 DB</span>
                    </h2>
                    <p className={styles.sectionDesc}>
                      상단 헤더 우측의 <strong>표시열 아이콘</strong>(필터 아이콘
                      왼쪽)을 눌러 `구분`, `ID`, `중단 복구 커서`, `마지막 수집
                      시각` 등의 열을 자유롭게 보이기/숨기기할 수 있습니다.
                    </p>
                  </div>

                  <div className={styles.tableWrapper}>
                    <table className={styles.dataTable}>
                      <thead>
                        <tr>
                          {dbColumns.category && <th>구분</th>}
                          {dbColumns.name && <th>채널명 (별명)</th>}
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
                          const alias = getMediaAlias(ch.name, mediaAliases);
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
                                  <strong>{alias}</strong>{' '}
                                  <span
                                    style={{
                                      color: '#64748b',
                                      fontSize: '0.76rem',
                                    }}
                                  >
                                    ({ch.name})
                                  </span>
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
                    <span>
                      방송사 대본 (방송사 유튜브 설명란 대본 및 기본 자막 활용 분석)
                    </span>
                  </h2>
                  <p className={styles.sectionDesc}>
                    9개 주요 방송사 공식 뉴스 유튜브 채널(1:1 매핑)의 영상 설명란(
                    <code>media:description</code>) 리포트 대본 전문 포함 여부 및 기본
                    자막 트랙 활용성을 분석한 결과입니다.
                  </p>
                </div>

                <div className={styles.tableWrapper}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th>방송사 채널 (별명)</th>
                        <th>유튜브 채널 ID (`1:1`)</th>
                        <th>공식 유튜브 RSS</th>
                        <th>설명란(Description) 대본 평균 길이</th>
                        <th>기본 자막 트랙</th>
                        <th>포털 TV뉴스 대본 (보조)</th>
                        <th>권장 스크립트 수집 방식</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parserReport.broadcasters.map((bc) => (
                        <tr key={bc.channelId}>
                          <td>
                            <strong>
                              {getMediaAlias(bc.name, mediaAliases)}
                            </strong>{' '}
                            <span
                              style={{ color: '#64748b', fontSize: '0.76rem' }}
                            >
                              ({bc.name} · {bc.youtubeHandle})
                            </span>
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
                              <span className={styles.badgeWarn}>확인 필요</span>
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
                                자 (대본 전문 제공)
                              </span>
                            ) : (
                              <span className={styles.badgeWarn}>
                                평균{' '}
                                {
                                  bc.descriptionScriptAnalysis
                                    .avgDescriptionChars
                                }
                                자 (요약문)
                              </span>
                            )}
                          </td>
                          <td>
                            {bc.youtubeCaptionTrackAnalysis.hasCaptionTracks ? (
                              <span className={styles.badgeOk}>자막 트랙 있음</span>
                            ) : (
                              <span
                                style={{ color: '#64748b', fontSize: '0.78rem' }}
                              >
                                설명란 대본 우선 활용
                              </span>
                            )}
                          </td>
                          <td>
                            {bc.portalBroadcastTranscriptFallback.reachable ? (
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
                          <td style={{ fontSize: '0.8rem', color: '#334155' }}>
                            {bc.recommendedTranscriptSource}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {dbTab === 'RSS_ANALYSIS' && parserReport && (
              <section className={styles.sectionCard}>
                <div>
                  <h2 className={styles.sectionTitle}>
                    <Newspaper size={20} />
                    <span>
                      RSS분석 (전국 종합일간지 Top 10: 포털 정답지 vs 공식 RSS 및 원문
                      HTML 파싱 분석)
                    </span>
                  </h2>
                  <p className={styles.sectionDesc}>
                    네이버 언론사별 뉴스 목록(`oid` + 날짜)을 정답지로 삼으면서, 각
                    언론사의 공식 RSS 피드 작동 여부 및 원문 웹페이지의 표준 메타태그(
                    `article:published_time`, `JSON-LD`) 유무를 진단한 결과입니다.
                  </p>
                </div>

                <div className={styles.tableWrapper}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th>순위 · 언론사 (별명)</th>
                        <th>포털 정답지 (입력시각·원문링크)</th>
                        <th>공식 RSS 피드 응답</th>
                        <th>RSS 본문 포함 수준</th>
                        <th>원문 DOM 표준 셀렉터</th>
                        <th>공식 RSS 전환 파싱 전략</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parserReport.newspapers.map((np) => {
                        const workingRss = np.officialRssDiagnostics.filter(
                          (r) => r.reachable
                        );
                        const bestRss =
                          workingRss[0] || np.officialRssDiagnostics[0];
                        return (
                          <tr key={np.channelId}>
                            <td>
                              <strong>
                                {np.rank}위.{' '}
                                {getMediaAlias(np.name, mediaAliases)}
                              </strong>{' '}
                              <span
                                style={{ color: '#64748b', fontSize: '0.75rem' }}
                              >
                                ({np.name} · oid: {np.naverOid})
                              </span>
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
                                  RSS 미제공/변경
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
                            <td
                              style={{ fontSize: '0.76rem', color: '#475569' }}
                            >
                              {np.originalArticleDom?.detectedSelectors?.join(
                                ', '
                              ) || '추가 점검 필요'}
                            </td>
                            <td style={{ fontSize: '0.8rem', color: '#334155' }}>
                              {np.parsingStrategyRecommendation}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
