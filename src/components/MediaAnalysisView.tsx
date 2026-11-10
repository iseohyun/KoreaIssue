import React, { useEffect, useMemo, useState } from 'react';
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Timer,
} from 'lucide-react';
import {
  BROADCASTER_TOP20_TRENDS,
  MediaTrendItem,
  NEWSPAPER_TOP20_TRENDS,
  TREND_YEARS,
} from '../constants/mediaRankHistory';
import { getMediaAlias } from '../constants/mediaAliases';
import type { MediaAnalysisTab } from '../types/issues';
import styles from './MediaAnalysisView.module.css';

interface MediaAnalysisViewProps {
  activeTab: MediaAnalysisTab;
  searchQuery?: string;
  mediaAliases: Record<string, string>;
}

type AxisMaxScaleMode = 'ALL_YEARS_MAX' | 'CURRENT_YEAR_MAX';

function formatSubscriberUnit(val: number): string {
  if (val >= 10000) {
    const man = val / 10000;
    return man >= 100 ? `${Math.round(man)}만` : `${man.toFixed(1)}만`;
  }
  return val.toLocaleString();
}

export const MediaAnalysisView: React.FC<MediaAnalysisViewProps> = ({
  activeTab,
  searchQuery = '',
  mediaAliases,
}) => {
  const [yearIndex, setYearIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  // 기본 재생시간: 0.5초 (500ms), 변경 가능
  const [stepIntervalMs, setStepIntervalMs] = useState<number>(500);
  // 최대값 기준 토글: 전 연도의 1위('ALL_YEARS_MAX') vs 현재 연도의 1위('CURRENT_YEAR_MAX')
  const [axisMaxMode, setAxisMaxMode] =
    useState<AxisMaxScaleMode>('ALL_YEARS_MAX');

  useEffect(() => {
    setYearIndex(0);
    setIsPlaying(true);
  }, [activeTab]);

  useEffect(() => {
    if (!isPlaying) return;
    if (yearIndex >= TREND_YEARS.length - 1) {
      setIsPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setYearIndex((prev) => {
        if (prev >= TREND_YEARS.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, stepIntervalMs);
    return () => window.clearTimeout(timer);
  }, [isPlaying, yearIndex, stepIntervalMs]);

  const currentYear = TREND_YEARS[yearIndex];
  const prevYear = yearIndex > 0 ? TREND_YEARS[yearIndex - 1] : null;

  const rawDataset: MediaTrendItem[] =
    activeTab === 'NEWSPAPER'
      ? NEWSPAPER_TOP20_TRENDS
      : BROADCASTER_TOP20_TRENDS;

  // 전 연도의 1위 최대값 vs 당해 연도의 1위 최대값 계산
  const allYearsMaxVal = useMemo(() => {
    let maxVal = 0;
    for (const item of rawDataset) {
      for (const yr of TREND_YEARS) {
        const v = item.yearlySubscribers[yr] || 0;
        if (v > maxVal) maxVal = v;
      }
    }
    return Math.ceil((maxVal * 1.05) / 50000) * 50000;
  }, [rawDataset]);

  const currentYearMaxVal = useMemo(() => {
    let maxVal = 0;
    for (const item of rawDataset) {
      const v = item.yearlySubscribers[currentYear] || 0;
      if (v > maxVal) maxVal = v;
    }
    return Math.max(50000, Math.ceil((maxVal * 1.05) / 50000) * 50000);
  }, [rawDataset, currentYear]);

  const activeMaxAxis =
    axisMaxMode === 'ALL_YEARS_MAX' ? allYearsMaxVal : currentYearMaxVal;

  const rankedWithPositions = useMemo(() => {
    const sortedCurr = [...rawDataset].sort(
      (a, b) =>
        (b.yearlySubscribers[currentYear] || 0) -
        (a.yearlySubscribers[currentYear] || 0)
    );
    const rankMapCurr = new Map<string, number>();
    sortedCurr.forEach((it, idx) => rankMapCurr.set(it.id, idx + 1));

    const rankMapPrev = new Map<string, number>();
    if (prevYear) {
      const sortedPrev = [...rawDataset].sort(
        (a, b) =>
          (b.yearlySubscribers[prevYear] || 0) -
          (a.yearlySubscribers[prevYear] || 0)
      );
      sortedPrev.forEach((it, idx) => rankMapPrev.set(it.id, idx + 1));
    }

    return rawDataset.map((item) => {
      const rank = rankMapCurr.get(item.id) || 20;
      const prevRank = prevYear ? rankMapPrev.get(item.id) || rank : rank;
      const rankDelta = prevRank - rank;
      const currentVal = item.yearlySubscribers[currentYear] || 0;
      const alias = getMediaAlias(item.name, mediaAliases);
      return {
        ...item,
        alias,
        rank,
        prevRank,
        rankDelta,
        currentVal,
      };
    });
  }, [rawDataset, currentYear, prevYear, mediaAliases]);

  const cutlineRank10Value = useMemo(() => {
    const r10 = rankedWithPositions.find((r) => r.rank === 10);
    return r10 ? r10.currentVal : 0;
  }, [rankedWithPositions]);

  const sortedTableRows = useMemo(() => {
    const rows = [...rankedWithPositions].sort((a, b) => a.rank - b.rank);
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.alias.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.note.toLowerCase().includes(q)
    );
  }, [rankedWithPositions, searchQuery]);

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    ratio,
    value: Math.round(activeMaxAxis * ratio),
  }));

  const handleReplay = () => {
    setYearIndex(0);
    setIsPlaying(true);
  };

  return (
    <div className={styles.wrapper}>
      {/* 1. 가로막대 애니메이션 그래프 카드 (일간지 / 방송사 모두 가로막대 그래프 + 언론사 별명 표시) */}
      <section className={styles.chartCard}>
        <div className={styles.topHeaderRow}>
          <div className={styles.titleBlock}>
            <h2 className={styles.chartTitle}>
              {activeTab === 'NEWSPAPER'
                ? '전국 일간지 최근 10년(2017~2026) 구독자 추이 가로 막대 그래프'
                : '방송사 공식 뉴스 유튜브 최근 10년(2017~2026) 구독자 추이 가로 막대 그래프'}
            </h2>
            <p className={styles.chartSub}>
              최대값 기준:{' '}
              <strong>
                {axisMaxMode === 'ALL_YEARS_MAX'
                  ? `전 연도 1위 고정 (${formatSubscriberUnit(allYearsMaxVal)})`
                  : `현재 연도(${currentYear}년) 1위 기준 (${formatSubscriberUnit(currentYearMaxVal)})`}
              </strong>{' '}
              · 재생 간격:{' '}
              <strong>
                {(stepIntervalMs / 1000).toFixed(2).replace(/\.?0+$/, '')}초/년
              </strong>
            </p>
          </div>

          <div className={styles.controlsBlock}>
            {/* 현재 연도 드롭다운 선택 */}
            <select
              className={styles.yearSelectDropdown}
              value={currentYear}
              aria-label="특정 연도 선택"
              onChange={(e) => {
                const targetYr = Number(e.target.value);
                const idx = TREND_YEARS.indexOf(
                  targetYr as (typeof TREND_YEARS)[number]
                );
                if (idx >= 0) {
                  setIsPlaying(false);
                  setYearIndex(idx);
                }
              }}
            >
              {TREND_YEARS.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}년
                </option>
              ))}
            </select>

            {/* 재생시간(속도) 변경 컨트롤 (기본 0.5초) */}
            <label
              className={styles.speedSelectWrap}
              title="1년당 애니메이션 전환 시간"
            >
              <Timer size={14} />
              <select
                className={styles.speedSelect}
                value={stepIntervalMs}
                aria-label="재생 간격 선택"
                onChange={(e) => setStepIntervalMs(Number(e.target.value))}
              >
                <option value={250}>0.25초</option>
                <option value={500}>0.5초 (기본)</option>
                <option value={1000}>1.0초</option>
                <option value={1500}>1.5초</option>
              </select>
            </label>

            {/* 재생 / 일시정지 아이콘 버튼 */}
            <button
              type="button"
              className={`${styles.iconCtrlBtn} ${
                isPlaying ? styles.iconCtrlBtnActive : ''
              }`}
              title={isPlaying ? '일시정지' : '재생'}
              aria-label={isPlaying ? '일시정지' : '재생'}
              onClick={() => {
                if (yearIndex >= TREND_YEARS.length - 1 && !isPlaying) {
                  handleReplay();
                } else {
                  setIsPlaying((prev) => !prev);
                }
              }}
            >
              {isPlaying ? <Pause size={17} /> : <Play size={17} />}
            </button>

            {/* 다시보기 아이콘 버튼 */}
            <button
              type="button"
              className={styles.iconCtrlBtn}
              title="처음(2017년)부터 다시보기"
              aria-label="처음부터 다시보기"
              onClick={handleReplay}
            >
              <RotateCcw size={17} />
            </button>

            {/* 최대값 기준 토글 아이콘 버튼 (현재 연도 1위 ↔ 전 연도 1위) */}
            <button
              type="button"
              className={`${styles.iconCtrlBtn} ${
                axisMaxMode === 'CURRENT_YEAR_MAX'
                  ? styles.iconCtrlBtnActive
                  : ''
              }`}
              title={
                axisMaxMode === 'ALL_YEARS_MAX'
                  ? '최대값 기준: 전 연도 1위 고정 (클릭 시 현재 연도 1위 기준으로 전환)'
                  : '최대값 기준: 현재 연도 1위 (클릭 시 전 연도 1위 고정으로 전환)'
              }
              aria-label="최대값 기준 토글"
              onClick={() =>
                setAxisMaxMode((prev) =>
                  prev === 'ALL_YEARS_MAX'
                    ? 'CURRENT_YEAR_MAX'
                    : 'ALL_YEARS_MAX'
                )
              }
            >
              {axisMaxMode === 'ALL_YEARS_MAX' ? (
                <Maximize2 size={17} />
              ) : (
                <Minimize2 size={17} />
              )}
            </button>
          </div>
        </div>

        {/* 가로 막대 차트 스테이지 (1~20위 상하 순위 교체 애니메이션 + 가로 막대 길이 애니메이션) */}
        <div className={styles.chartViewport}>
          <div className={styles.horizontalStage}>
            {/* 상단 X축 눈금 */}
            <div className={styles.xAxisHeader}>
              {xTicks.map((tick) => (
                <span
                  key={tick.ratio}
                  className={styles.xAxisTickLabel}
                  style={{ left: `${tick.ratio * 100}%` }}
                >
                  {formatSubscriberUnit(tick.value)}
                </span>
              ))}
            </div>

            <div className={styles.horizontalPlotArea}>
              {/* 수직 눈금 보조선 */}
              {xTicks.map((tick) => (
                <div
                  key={tick.ratio}
                  className={styles.xAxisGridLine}
                  style={{ left: `${tick.ratio * 100}%` }}
                />
              ))}

              {/* 10위와 11위 사이 수평 점선 커트라인 */}
              <div className={styles.cutlineRowHorizontal}>
                <span className={styles.cutlineRowBadge}>
                  ▲ Top 10 수집 채택 커트라인 (10위: {cutlineRank10Value.toLocaleString()})
                </span>
              </div>

              {/* 10위 당해 구독자 수 기준 수직 점선 */}
              <div
                className={styles.cutlineValueVertical}
                style={{
                  left: `${Math.min(
                    100,
                    Math.max(1, (cutlineRank10Value / activeMaxAxis) * 100)
                  )}%`,
                }}
              />

              {rankedWithPositions.map((item) => {
                const widthPct = Math.max(
                  1.5,
                  Math.min(100, (item.currentVal / activeMaxAxis) * 100)
                );
                const topPct = (item.rank - 1) * 5;
                const isWithinTop10 = item.rank <= 10;

                return (
                  <div
                    key={item.id}
                    className={styles.hbarRow}
                    style={{ top: `${topPct}%` }}
                  >
                    <div className={styles.hbarLabelCol} title={item.name}>
                      <span
                        className={`${styles.rankChip} ${
                          isWithinTop10 ? styles.rankChipTop10 : ''
                        }`}
                      >
                        {item.rank}위
                      </span>
                      <span className={styles.mediaAliasLabel}>
                        {item.alias}
                      </span>
                    </div>

                    <div className={styles.hbarTrackCol}>
                      <div
                        className={styles.hbarFill}
                        style={{
                          width: `${widthPct}%`,
                          backgroundColor: isWithinTop10
                            ? item.color
                            : '#cbd5e1',
                        }}
                        title={`${currentYear}년 ${item.rank}위 ${item.name} (${item.alias}): ${item.currentVal.toLocaleString()}`}
                      />
                      <span className={styles.hbarValueText}>
                        {formatSubscriberUnit(item.currentVal)}
                        {item.rankDelta !== 0 && (
                          <em className={styles.hbarRankDelta}>
                            {item.rankDelta > 0
                              ? `▲${item.rankDelta}`
                              : `▼${Math.abs(item.rankDelta)}`}
                          </em>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className={styles.legendRow}>
          <div className={styles.legendItems}>
            <span>
              <i
                className={styles.legendDot}
                style={{ background: '#2563eb' }}
              />
              <strong>1위 ~ 10위 (채택 언론사)</strong>: 뉴스·방송 스크립트 상시 수집 대상
            </span>
            <span>
              <i
                className={styles.legendDot}
                style={{ background: '#cbd5e1' }}
              />
              <strong>11위 ~ 20위 (비채택 비교군)</strong>: 10위 커트라인 하단 매체
            </span>
          </div>
          <span>
            ※ 언론사 별명은 <strong>[설정]</strong> 메뉴에서 자유롭게 변경할 수 있습니다.
          </span>
        </div>
      </section>

      {/* 2. 신문/방송 분리 상세 연도별 표 */}
      <section className={styles.tableCard}>
        <div>
          <h3 className={styles.chartTitle}>
            {activeTab === 'NEWSPAPER'
              ? '종합일간지 1~20위 연도별 구독자 수 상세 표 (신문사 전용)'
              : '방송사 공식 뉴스 유튜브 1~20위 연도별 구독자 수 상세 표 (방송사 전용)'}
          </h3>
          <p className={styles.chartSub}>
            붉은 점선 위쪽(1~10위권)이 현재 KoreaIssues 수집 대상 채널로 채택된 매체입니다.
          </p>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>{currentYear}년 순위</th>
                <th>별명 (정식 명칭)</th>
                <th>채택 상태</th>
                {TREND_YEARS.map((yr) => (
                  <th
                    key={yr}
                    className={yr === currentYear ? styles.activeYearCol : ''}
                  >
                    {yr}년
                  </th>
                ))}
                <th style={{ textAlign: 'left' }}>산정 기준 및 비고</th>
              </tr>
            </thead>
            <tbody>
              {sortedTableRows.map((row) => (
                <tr
                  key={row.id}
                  className={`${row.rank <= 10 ? styles.rowTop10 : ''} ${
                    row.rank === 10 ? styles.rowCutlineBorder : ''
                  }`}
                >
                  <td>
                    <strong>{row.rank}위</strong>
                  </td>
                  <td>
                    <strong>{row.alias}</strong>{' '}
                    <span style={{ color: '#64748b', fontSize: '0.73rem' }}>
                      ({row.name} · {row.category})
                    </span>
                  </td>
                  <td>
                    {row.adopted ? (
                      <span className={styles.adoptedBadge}>수집 채택</span>
                    ) : (
                      <span className={styles.candidateBadge}>커트라인 외</span>
                    )}
                  </td>
                  {TREND_YEARS.map((yr) => (
                    <td
                      key={yr}
                      className={yr === currentYear ? styles.activeYearCol : ''}
                      title={`${(row.yearlySubscribers[yr] || 0).toLocaleString()}명`}
                    >
                      {formatSubscriberUnit(row.yearlySubscribers[yr] || 0)}
                    </td>
                  ))}
                  <td style={{ textAlign: 'left', color: '#475569' }}>
                    {row.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
