import React, { useEffect, useState } from 'react';
import {
  Award,
  BarChart3,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  Info,
  Settings,
  X,
} from 'lucide-react';
import type { IssueCard, MainMenuView } from '../types/issues';
import { AppBrandIcon } from './AppBrandIcon';
import styles from './SidebarDrawer.module.css';

interface SidebarDrawerProps {
  open: boolean;
  activeMenu: MainMenuView;
  top10Issues: IssueCard[];
  selectedTop10IssueId: string | null;
  onSelectMenu: (menu: MainMenuView) => void;
  onSelectTop10Issue: (issueId: string) => void;
  onClose: () => void;
}

export const SidebarDrawer: React.FC<SidebarDrawerProps> = ({
  open,
  activeMenu,
  top10Issues,
  selectedTop10IssueId,
  onSelectMenu,
  onSelectTop10Issue,
  onClose,
}) => {
  const [top10Expanded, setTop10Expanded] = useState<boolean>(true);

  useEffect(() => {
    if (activeMenu === 'TOP10') {
      setTop10Expanded(true);
    }
  }, [activeMenu]);

  if (!open) return null;

  const handlePickMenu = (menu: MainMenuView) => {
    onSelectMenu(menu);
    onClose();
  };

  const handlePickTop10Item = (issueId: string) => {
    onSelectTop10Issue(issueId);
    onSelectMenu('TOP10');
    onClose();
  };

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.drawer} aria-label="메인 메뉴 사이드바">
        <div className={styles.topBlock}>
          <div className={styles.drawerHeader}>
            <span className={styles.drawerTitle}>
              <AppBrandIcon size={26} />
              <span>대한민국 이슈 요약</span>
            </span>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="사이드바 닫기"
            >
              <X size={16} />
            </button>
          </div>

          <nav className={styles.navList}>
            {/* 1. 언론사 분석 */}
            <button
              type="button"
              className={`${styles.navItem} ${
                activeMenu === 'MEDIA_ANALYSIS' ? styles.navItemActive : ''
              }`}
              onClick={() => handlePickMenu('MEDIA_ANALYSIS')}
            >
              <BarChart3 size={18} />
              <span>언론사 분석</span>
            </button>

            {/* 2. 이슈 요약 (기본, 키워드 제공) */}
            <button
              type="button"
              className={`${styles.navItem} ${
                activeMenu === 'ISSUE_SUMMARY' ? styles.navItemActive : ''
              }`}
              onClick={() => handlePickMenu('ISSUE_SUMMARY')}
            >
              <FileText size={18} />
              <span>이슈 요약</span>
            </button>

            {/* 3. 수집DB 통계 */}
            <button
              type="button"
              className={`${styles.navItem} ${
                activeMenu === 'DB_STATS' ? styles.navItemActive : ''
              }`}
              onClick={() => handlePickMenu('DB_STATS')}
            >
              <Database size={18} />
              <span>수집DB 통계</span>
            </button>

            {/* 4. Top10: 그때그때 선정되는 이슈 하위 10개 펼치기/접기 (특별 홍보관과 동일한 방식) */}
            <div className={styles.navGroup}>
              <button
                type="button"
                className={`${styles.navItem} ${styles.navGroupHeader} ${
                  activeMenu === 'TOP10' ? styles.navGroupHeaderActive : ''
                }`}
                onClick={() => setTop10Expanded((prev) => !prev)}
                aria-expanded={top10Expanded}
              >
                <span className={styles.navGroupLabel}>
                  <Award size={18} />
                  <span>Top10</span>
                </span>
                {top10Expanded ? (
                  <ChevronDown size={15} />
                ) : (
                  <ChevronRight size={15} />
                )}
              </button>

              <div
                className={`${styles.subNavAnimWrapper} ${
                  top10Expanded ? styles.subNavAnimWrapperOpen : ''
                }`}
              >
                <div className={styles.subNavAnimInner}>
                  <div className={styles.subNavList}>
                    {top10Issues.slice(0, 10).map((issue, idx) => {
                      const isSelected =
                        activeMenu === 'TOP10' &&
                        selectedTop10IssueId === issue.issueId;
                      const shortLabel =
                        issue.representativeKeywords[0] ||
                        issue.title.slice(0, 18);
                      return (
                        <button
                          key={issue.issueId}
                          type="button"
                          className={`${styles.subNavItem} ${
                            isSelected ? styles.subNavItemActive : ''
                          }`}
                          onClick={() => handlePickTop10Item(issue.issueId)}
                          title={`${idx + 1}위: ${issue.title} (보도 ${issue.mentionStats.totalCount}회)`}
                        >
                          <span
                            className={`${styles.rankBadge} ${
                              idx < 3 ? styles.rankBadgeTop3 : ''
                            }`}
                          >
                            {idx + 1}
                          </span>
                          <span className={styles.subNavTitleText}>
                            {shortLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* 5. 연중이슈 */}
            <button
              type="button"
              className={`${styles.navItem} ${
                activeMenu === 'ANNUAL_ISSUES' ? styles.navItemActive : ''
              }`}
              onClick={() => handlePickMenu('ANNUAL_ISSUES')}
            >
              <CalendarRange size={18} />
              <span>연중이슈</span>
            </button>
          </nav>
        </div>

        {/* 사이드바 하단: 설정 -> 소개 */}
        <div className={styles.bottomBlock}>
          <button
            type="button"
            className={`${styles.navItem} ${
              activeMenu === 'SETTINGS' ? styles.navItemActive : ''
            }`}
            onClick={() => handlePickMenu('SETTINGS')}
          >
            <Settings size={18} />
            <span>설정</span>
          </button>

          <button
            type="button"
            className={`${styles.navItem} ${
              activeMenu === 'ABOUT' ? styles.navItemActive : ''
            }`}
            onClick={() => handlePickMenu('ABOUT')}
          >
            <Info size={18} />
            <span>소개</span>
          </button>
        </div>
      </aside>
    </>
  );
};
