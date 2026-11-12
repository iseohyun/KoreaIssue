import React, { useEffect, useRef, useState } from 'react';
import {
  Columns,
  Menu,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type {
  AnnualIssuesTab,
  AnnualTableColumnVisibility,
  DbChannelColumnVisibility,
  DbStatsTab,
  IssueCard,
  IssueFilterState,
  IssueSummaryTab,
  MainMenuView,
  MediaAnalysisTab,
} from '../types/issues';
import styles from './HeaderBar.module.css';

interface HeaderBarProps {
  activeMenu: MainMenuView;
  mediaTab: MediaAnalysisTab;
  issueSummaryTab: IssueSummaryTab;
  dbTab: DbStatsTab;
  annualTab: AnnualIssuesTab;
  selectedTop10Issue: IssueCard | null;
  selectedTop10Rank: number;
  filters: IssueFilterState;
  dbColumns: DbChannelColumnVisibility;
  annualColumns: AnnualTableColumnVisibility;
  onToggleSidebar: () => void;
  onChangeMediaTab: (tab: MediaAnalysisTab) => void;
  onChangeIssueSummaryTab: (tab: IssueSummaryTab) => void;
  onChangeDbTab: (tab: DbStatsTab) => void;
  onChangeAnnualTab: (tab: AnnualIssuesTab) => void;
  onUpdateFilter: <K extends keyof IssueFilterState>(
    key: K,
    value: IssueFilterState[K]
  ) => void;
  onResetFilters: () => void;
  onChangeDbColumns: (next: DbChannelColumnVisibility) => void;
  onChangeAnnualColumns: (next: AnnualTableColumnVisibility) => void;
}

const ISSUE_SUMMARY_TABS: Array<{ key: IssueSummaryTab; label: string }> = [
  { key: 'TODAY', label: '오늘' },
  { key: 'THIS_WEEK', label: '이번주' },
  { key: 'THIS_MONTH', label: '이번달' },
  { key: 'YESTERDAY', label: '어제' },
  { key: 'LAST_WEEK', label: '저번주' },
  { key: 'LAST_MONTH', label: '저번달' },
  { key: 'SEARCH', label: '검색' },
];

const MENU_TITLES: Record<MainMenuView, string> = {
  MEDIA_ANALYSIS: '언론사 분석',
  ISSUE_SUMMARY: '이슈 요약',
  DB_STATS: '수집DB 통계',
  TOP10: 'Top10 이슈',
  ANNUAL_ISSUES: '연중이슈',
  SETTINGS: '설정',
  ABOUT: '소개',
};

const DB_CHANNEL_COLUMN_OPTIONS: Array<{
  key: keyof DbChannelColumnVisibility;
  label: string;
}> = [
  { key: 'category', label: '구분' },
  { key: 'name', label: '채널명' },
  { key: 'channelId', label: 'ID' },
  { key: 'startDate', label: '수집 시작' },
  { key: 'endDate', label: '수집 종료' },
  { key: 'inProgress', label: '중단 복구 커서' },
  { key: 'totalCount', label: '누적 스크립트' },
  { key: 'diskSize', label: '로컬 용량' },
  { key: 'lastCrawledAt', label: '마지막 수집 시각' },
];

const ANNUAL_COLUMN_OPTIONS: Array<{
  key: keyof AnnualTableColumnVisibility;
  label: string;
}> = [
  { key: 'date', label: '최초 보도일' },
  { key: 'title', label: '이슈 제목' },
  { key: 'keywords', label: '대표 키워드' },
  { key: 'newspaperCount', label: '신문 보도수' },
  { key: 'broadcastCount', label: '방송 보도수' },
  { key: 'totalCount', label: '총 보도수' },
  { key: 'firstChannel', label: '최초 보도 매체' },
  { key: 'factCount', label: '팩트 문장 수' },
];

export const HeaderBar: React.FC<HeaderBarProps> = ({
  activeMenu,
  mediaTab,
  issueSummaryTab,
  dbTab,
  annualTab,
  selectedTop10Issue,
  selectedTop10Rank,
  filters,
  dbColumns,
  annualColumns,
  onToggleSidebar,
  onChangeMediaTab,
  onChangeIssueSummaryTab,
  onChangeDbTab,
  onChangeAnnualTab,
  onUpdateFilter,
  onResetFilters,
  onChangeDbColumns,
  onChangeAnnualColumns,
}) => {
  const [columnsOpen, setColumnsOpen] = useState<boolean>(false);
  const [filterOpen, setFilterOpen] = useState<boolean>(false);
  const tabsContainerRef = useRef<HTMLDivElement | null>(null);

  // 탭이 활성화될 때 해당 탭으로 자동 스크롤
  useEffect(() => {
    const container = tabsContainerRef.current;
    if (!container) return;
    const activeTabEl = container.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]'
    );
    if (activeTabEl) {
      activeTabEl.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    }
  }, [activeMenu, mediaTab, issueSummaryTab, dbTab, annualTab, selectedTop10Issue]);

  const showColumnsBtn =
    (activeMenu === 'DB_STATS' && dbTab === 'CHANNEL_INFO') ||
    (activeMenu === 'ANNUAL_ISSUES' && annualTab === 'TABLE');

  const showFilterBtn =
    activeMenu !== 'SETTINGS' && activeMenu !== 'ABOUT';

  const hasActiveFilters =
    Boolean(filters.searchQuery.trim()) ||
    Boolean(filters.selectedKeyword) ||
    filters.mediaFilter !== 'ALL' ||
    filters.mediaTypes.length < 2 ||
    !filters.shortNameView ||
    filters.minMentionCount > 1;

  const pageTitle =
    activeMenu === 'TOP10' && selectedTop10Issue
      ? `Top10 · [${selectedTop10Rank}위] ${
          selectedTop10Issue.eventTitle ||
          selectedTop10Issue.representativeKeywords[0] ||
          selectedTop10Issue.title.slice(0, 16)
        }`
      : MENU_TITLES[activeMenu];

  return (
    <header className={styles.header}>
      {/* 상단 menu-header: 좌측(삼선 메뉴 + 페이지명, 웹앱 아이콘 미노출) - 중앙(바닥 연결 사다리꼴 탭) - 우측(표시열 + 필터) */}
      <div className={styles.topBar}>
        <div className={styles.leftSection}>
          <button
            type="button"
            className={styles.hamburgerBtn}
            onClick={onToggleSidebar}
            title="사이드바 메뉴 열기"
            aria-label="사이드바 메뉴 열기"
          >
            <Menu size={19} />
          </button>
          <h1 className={styles.pageTitle}>{pageTitle}</h1>
        </div>

        {/* 중앙: 헤더 바닥과 연결된 사다리꼴 페이지별 탭 (스크롤바 숨김, 활성화 시 자동 스크롤) */}
        <div
          ref={tabsContainerRef}
          className={styles.pageTabsCenter}
          role="tablist"
          aria-label="페이지별 탭"
        >
          {activeMenu === 'MEDIA_ANALYSIS' && (
            <>
              <button
                type="button"
                role="tab"
                aria-selected={mediaTab === 'NEWSPAPER'}
                className={`${styles.pageTabBtn} ${
                  mediaTab === 'NEWSPAPER' ? styles.pageTabBtnActive : ''
                }`}
                onClick={() => onChangeMediaTab('NEWSPAPER')}
              >
                일간지
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mediaTab === 'BROADCAST'}
                className={`${styles.pageTabBtn} ${
                  mediaTab === 'BROADCAST' ? styles.pageTabBtnActive : ''
                }`}
                onClick={() => onChangeMediaTab('BROADCAST')}
              >
                방송사
              </button>
            </>
          )}

          {activeMenu === 'ISSUE_SUMMARY' &&
            ISSUE_SUMMARY_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={issueSummaryTab === t.key}
                className={`${styles.pageTabBtn} ${
                  issueSummaryTab === t.key ? styles.pageTabBtnActive : ''
                }`}
                onClick={() => onChangeIssueSummaryTab(t.key)}
              >
                {t.label}
              </button>
            ))}

          {activeMenu === 'DB_STATS' && (
            <>
              <button
                type="button"
                role="tab"
                aria-selected={dbTab === 'CHANNEL_INFO'}
                className={`${styles.pageTabBtn} ${
                  dbTab === 'CHANNEL_INFO' ? styles.pageTabBtnActive : ''
                }`}
                onClick={() => onChangeDbTab('CHANNEL_INFO')}
              >
                채널 정보
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={dbTab === 'BROADCAST_SCRIPT'}
                className={`${styles.pageTabBtn} ${
                  dbTab === 'BROADCAST_SCRIPT' ? styles.pageTabBtnActive : ''
                }`}
                onClick={() => onChangeDbTab('BROADCAST_SCRIPT')}
              >
                방송사 대본
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={dbTab === 'RSS_ANALYSIS'}
                className={`${styles.pageTabBtn} ${
                  dbTab === 'RSS_ANALYSIS' ? styles.pageTabBtnActive : ''
                }`}
                onClick={() => onChangeDbTab('RSS_ANALYSIS')}
              >
                RSS분석
              </button>
            </>
          )}

          {activeMenu === 'TOP10' && (
            <button
              type="button"
              role="tab"
              aria-selected={true}
              className={`${styles.pageTabBtn} ${styles.pageTabBtnActive}`}
            >
              {selectedTop10Issue
                ? `${selectedTop10Rank}위 · ${
                    selectedTop10Issue.eventTitle ||
                    selectedTop10Issue.representativeKeywords[0] ||
                    '이슈 집중 분석'
                  }`
                : 'Top10 이슈'}
            </button>
          )}

          {activeMenu === 'ANNUAL_ISSUES' && (
            <>
              <button
                type="button"
                role="tab"
                aria-selected={annualTab === 'TABLE'}
                className={`${styles.pageTabBtn} ${
                  annualTab === 'TABLE' ? styles.pageTabBtnActive : ''
                }`}
                onClick={() => onChangeAnnualTab('TABLE')}
              >
                표로 보기
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={annualTab === 'TIMELINE'}
                className={`${styles.pageTabBtn} ${
                  annualTab === 'TIMELINE' ? styles.pageTabBtnActive : ''
                }`}
                onClick={() => onChangeAnnualTab('TIMELINE')}
              >
                타임라인
              </button>
            </>
          )}

          {activeMenu === 'SETTINGS' && (
            <button
              type="button"
              role="tab"
              aria-selected={true}
              className={`${styles.pageTabBtn} ${styles.pageTabBtnActive}`}
            >
              설정
            </button>
          )}

          {activeMenu === 'ABOUT' && (
            <button
              type="button"
              role="tab"
              aria-selected={true}
              className={`${styles.pageTabBtn} ${styles.pageTabBtnActive}`}
            >
              소개
            </button>
          )}
        </div>

        {/* 우측: 표시열 아이콘 (필터 왼쪽) + 필터 아이콘 */}
        <div className={styles.rightToolbar}>
          {showColumnsBtn && (
            <button
              type="button"
              className={`${styles.iconOnlyBtn} ${
                columnsOpen ? styles.iconOnlyBtnActive : ''
              }`}
              onClick={() => setColumnsOpen((prev) => !prev)}
              title="표시열 선택 펼치기/접기"
              aria-label="표시열 선택 펼치기/접기"
            >
              <Columns size={17} />
            </button>
          )}

          {showFilterBtn && (
            <button
              type="button"
              className={`${styles.iconOnlyBtn} ${
                filterOpen || hasActiveFilters ? styles.iconOnlyBtnActive : ''
              }`}
              onClick={() => setFilterOpen((prev) => !prev)}
              title="필터 펼치기/접기"
              aria-label="필터 펼치기/접기"
            >
              <SlidersHorizontal size={17} />
              {hasActiveFilters && <span className={styles.filterBadgeDot} />}
            </button>
          )}
        </div>
      </div>

      {/* 표시열 아이콘 클릭 시 애니메이션으로 펼쳐지는 열 선택 div */}
      {showColumnsBtn && (
        <div
          className={`${styles.drawerAnimWrapper} ${
            columnsOpen ? styles.drawerAnimWrapperOpen : ''
          }`}
        >
          <div className={styles.drawerAnimInner}>
            <div className={styles.drawerContent}>
              <div className={styles.columnsCheckBar}>
                <div className={styles.columnsCheckGroup}>
                  <span className={styles.columnsBarTitle}>
                    {activeMenu === 'DB_STATS'
                      ? '채널 수집 범위 표 표시열 선택:'
                      : '연중이슈 표 표시열 선택:'}
                  </span>

                  {activeMenu === 'DB_STATS'
                    ? DB_CHANNEL_COLUMN_OPTIONS.map((col) => {
                        const checked = dbColumns[col.key];
                        return (
                          <label
                            key={col.key}
                            className={`${styles.checkLabel} ${
                              checked ? styles.checkLabelChecked : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                onChangeDbColumns({
                                  ...dbColumns,
                                  [col.key]: e.target.checked,
                                })
                              }
                            />
                            <span>{col.label}</span>
                          </label>
                        );
                      })
                    : ANNUAL_COLUMN_OPTIONS.map((col) => {
                        const checked = annualColumns[col.key];
                        return (
                          <label
                            key={col.key}
                            className={`${styles.checkLabel} ${
                              checked ? styles.checkLabelChecked : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                onChangeAnnualColumns({
                                  ...annualColumns,
                                  [col.key]: e.target.checked,
                                })
                              }
                            />
                            <span>{col.label}</span>
                          </label>
                        );
                      })}
                </div>

                <button
                  type="button"
                  className={styles.resetBtn}
                  onClick={() => setColumnsOpen(false)}
                >
                  <X size={13} />
                  <span>닫기</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 필터 아이콘 클릭 시 애니메이션으로 펼쳐지는 필터 div */}
      {showFilterBtn && (
        <div
          className={`${styles.drawerAnimWrapper} ${
            filterOpen ? styles.drawerAnimWrapperOpen : ''
          }`}
        >
          <div className={styles.drawerAnimInner}>
            <div className={styles.drawerContent}>
              <div className={styles.topicRow}>
                <span className={styles.topicLabel}>매체 구분</span>
                <div className={styles.controlsLine}>
                  {(
                    [
                      { id: 'NEWSPAPER', label: '일간지' },
                      { id: 'BROADCAST', label: '방송사' },
                    ] as const
                  ).map((opt) => {
                    const checked = filters.mediaTypes.includes(opt.id);
                    return (
                      <label
                        key={opt.id}
                        className={`${styles.checkLabel} ${
                          checked ? styles.checkLabelChecked : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? Array.from(
                                  new Set([...filters.mediaTypes, opt.id])
                                )
                              : filters.mediaTypes.filter((t) => t !== opt.id);
                            onUpdateFilter('mediaTypes', next);
                          }}
                        />
                        <span>{opt.label}</span>
                      </label>
                    );
                  })}

                  <label
                    className={`${styles.checkLabel} ${
                      filters.shortNameView ? styles.checkLabelChecked : ''
                    }`}
                    style={{ marginLeft: '0.4rem' }}
                  >
                    <input
                      type="checkbox"
                      checked={filters.shortNameView}
                      onChange={(e) =>
                        onUpdateFilter('shortNameView', e.target.checked)
                      }
                    />
                    <span>단축보기</span>
                  </label>
                </div>
              </div>

              {activeMenu !== 'DB_STATS' && (
                <div className={styles.topicRow}>
                  <span className={styles.topicLabel}>보도 빈도</span>
                  <div className={styles.controlsLine}>
                    {[1, 3, 5, 10].map((minCnt) => (
                      <button
                        key={minCnt}
                        type="button"
                        className={`${styles.filterPillBtn} ${
                          filters.minMentionCount === minCnt
                            ? styles.filterPillBtnActive
                            : ''
                        }`}
                        onClick={() =>
                          onUpdateFilter('minMentionCount', minCnt)
                        }
                      >
                        {minCnt === 1 ? '전체 이슈' : `${minCnt}건 이상 보도`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.topicRow}>
                <span className={styles.topicLabel}>세부 검색</span>
                <div className={styles.controlsLine}>
                  <div className={styles.searchInputWrap}>
                    <Search size={14} className={styles.searchIcon} />
                    <input
                      type="text"
                      className={styles.searchInput}
                      placeholder="이슈 키워드, 발췌 문장, 언론사 별명 검색..."
                      value={filters.searchQuery}
                      onChange={(e) =>
                        onUpdateFilter('searchQuery', e.target.value)
                      }
                    />
                  </div>

                  {filters.selectedKeyword && (
                    <button
                      type="button"
                      className={`${styles.filterPillBtn} ${styles.filterPillBtnActive}`}
                      onClick={() => onUpdateFilter('selectedKeyword', null)}
                    >
                      키워드: #{filters.selectedKeyword} ✕
                    </button>
                  )}

                  <button
                    type="button"
                    className={styles.resetBtn}
                    onClick={onResetFilters}
                  >
                    <RotateCcw size={13} />
                    <span>필터 초기화</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
