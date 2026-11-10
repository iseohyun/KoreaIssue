/**
 * KoreaIssues 증분·역방향(어제 -> 과거) 수집 체크포인트 및 Raw 스크립트 보관주기 매니저
 * - 저장 경로: `public/data/crawl-checkpoints.json`
 * - 설계 핵심:
 *   1) 어제(D-1)부터 과거 날짜로 순차 검색하되, 이미 수집 완료된 날짜 범위(`completedRanges`)는 건너뛰고
 *      비정상 종료 시 `inProgress` 커서(진행 중인 날짜·페이지·수집 건수)부터 이어서 수집
 *   2) Atomic Write(`.tmp` 기록 후 rename)로 강제 종료 시에도 JSON 손상 방지
 *   3) 로컬 `data/raw/{YYYY-MM-DD}/{channelId}.json`의 용량(Bytes) 및 처리 여부(`processedAt`),
 *      1개월(30일) 경과 여부를 추적하여 확인 후 처분 및 자동 폐기 지원
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');

export const REGISTRY_PATH = path.join(
  ROOT_DIR,
  'public',
  'data',
  'media-channel-registry.json'
);
export const CHECKPOINT_PATH = path.join(
  ROOT_DIR,
  'public',
  'data',
  'crawl-checkpoints.json'
);
export const RAW_DATA_DIR = path.join(ROOT_DIR, 'data', 'raw');

/**
 * KST(UTC+9) 기준 어제 날짜(YYYY-MM-DD) 또는 N일 전 날짜 반환
 */
export function getKstDateString(daysOffset = -1, baseDate = new Date()) {
  const kstMs = baseDate.getTime() + 9 * 60 * 60 * 1000 + daysOffset * 86400 * 1000;
  const d = new Date(kstMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * YYYY-MM-DD 문자열에서 하루씩 빼거나 더한 날짜 반환
 */
export function addDaysToDateStr(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + deltaDays * 86400 * 1000);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 연속되거나 겹치는 날짜 구간 배열(`[{ from, to }]`)을 병합·정렬
 */
export function mergeDateRanges(ranges = []) {
  const valid = ranges
    .filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.from) && /^\d{4}-\d{2}-\d{2}$/.test(r.to))
    .map((r) => (r.from <= r.to ? { from: r.from, to: r.to } : { from: r.to, to: r.from }))
    .sort((a, b) => a.from.localeCompare(b.from));

  if (valid.length <= 1) return valid;

  const merged = [valid[0]];
  for (let i = 1; i < valid.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = valid[i];
    const prevNextDay = addDaysToDateStr(prev.to, 1);
    if (curr.from <= prevNextDay) {
      if (curr.to > prev.to) {
        prev.to = curr.to;
      }
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

/**
 * 특정 날짜(YYYY-MM-DD)가 이미 완료 구간(`completedRanges`)에 속하는지 확인
 */
export function isDateCompleted(channelCheckpoint, dateStr) {
  if (!channelCheckpoint || !Array.isArray(channelCheckpoint.completedRanges)) {
    return false;
  }
  return channelCheckpoint.completedRanges.some(
    (r) => dateStr >= r.from && dateStr <= r.to
  );
}

/**
 * 어제(yesterdayStr)부터 과거로 내려가면서 아직 수집되지 않은 날짜 목록(targetCount일 분량)을 반환
 * - 진행 중 중단된 날짜(`inProgress.date`)가 있으면 최우선으로 포함
 */
export function getNextTargetDatesForChannel(
  channelCheckpoint,
  yesterdayStr = getKstDateString(-1),
  maxDaysToFetch = 1,
  minHorizonDate = '2025-01-01'
) {
  const targets = [];

  if (
    channelCheckpoint?.inProgress?.date &&
    !isDateCompleted(channelCheckpoint, channelCheckpoint.inProgress.date)
  ) {
    targets.push(channelCheckpoint.inProgress.date);
  }

  let cursorDate = yesterdayStr;
  while (targets.length < maxDaysToFetch && cursorDate >= minHorizonDate) {
    if (
      !targets.includes(cursorDate) &&
      !isDateCompleted(channelCheckpoint, cursorDate)
    ) {
      targets.push(cursorDate);
    }
    cursorDate = addDaysToDateStr(cursorDate, -1);
  }

  return targets;
}

/**
 * 마스터 채널 레지스트리 로드
 */
export function loadChannelRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    throw new Error(`채널 레지스트리 파일이 없습니다: ${REGISTRY_PATH}`);
  }
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
}

/**
 * 체크포인트 파일 로드 (없으면 레지스트리 기준으로 초기 구조 생성)
 */
export function loadCheckpoints() {
  let state = null;
  if (fs.existsSync(CHECKPOINT_PATH)) {
    try {
      state = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf-8'));
    } catch (err) {
      console.warn('[Checkpoint] 기존 파일 파싱 실패, 초기 상태를 생성합니다:', err.message);
    }
  }

  if (!state || typeof state !== 'object') {
    state = {
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      description:
        '채널별 어제(D-1)부터 과거 날짜 역방향 순차 수집 범위(completedRanges) 및 비정상 종료 복구 커서(inProgress) DB',
      retentionDays: 30,
      channels: {},
      storageSummary: {
        totalChannels: 0,
        totalArticlesAndVideos: 0,
        rawFilesCount: 0,
        rawDiskBytes: 0,
        rawDiskMB: 0,
        oldestRawDate: null,
        newestRawDate: null,
      },
    };
  }

  // 레지스트리 채널 동기화
  try {
    const reg = loadChannelRegistry();
    const allChannels = [
      ...(reg.newspapers || []),
      ...(reg.broadcasters || []),
    ];
    for (const ch of allChannels) {
      if (!state.channels[ch.id]) {
        state.channels[ch.id] = {
          channelId: ch.id,
          name: ch.name,
          mediaType: ch.mediaType,
          category: ch.category,
          completedRanges: [],
          inProgress: null,
          totalCollectedCount: 0,
          rawBytesOnDisk: 0,
          lastCrawledAt: null,
          lastProcessedAt: null,
        };
      }
    }
  } catch (err) {
    console.warn('[Checkpoint] 레지스트리 동기화 경고:', err.message);
  }

  return state;
}

/**
 * Atomic Save: 임시 파일에 먼저 기록한 뒤 원본 파일로 교체하여 비정상 종료 시 파일 깨짐 방지
 */
export function saveCheckpoints(state) {
  state.updatedAt = new Date().toISOString();
  state.storageSummary = computeRawStorageSummary(state);

  const dir = path.dirname(CHECKPOINT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${CHECKPOINT_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpPath, CHECKPOINT_PATH);
}

/**
 * 수집 도중 페이지/배치 진행 상태 기록 (비정상 종료 대비)
 */
export function markChannelInProgress(state, channelId, dateStr, cursorInfo = {}) {
  const entry = state.channels[channelId];
  if (!entry) return;
  entry.inProgress = {
    date: dateStr,
    lastPage: cursorInfo.lastPage ?? 1,
    collectedCount: cursorInfo.collectedCount ?? 0,
    updatedAt: new Date().toISOString(),
  };
  saveCheckpoints(state);
}

/**
 * 특정 채널의 특정 날짜(dateStr) 수집 완료 처리 및 구간 병합
 */
export function markChannelDateCompleted(
  state,
  channelId,
  dateStr,
  { addedCount = 0, totalDateCount = 0 } = {}
) {
  const entry = state.channels[channelId];
  if (!entry) return;

  entry.completedRanges = mergeDateRanges([
    ...(entry.completedRanges || []),
    { from: dateStr, to: dateStr },
  ]);

  if (entry.inProgress && entry.inProgress.date === dateStr) {
    entry.inProgress = null;
  }

  entry.totalCollectedCount = (entry.totalCollectedCount || 0) + addedCount;
  entry.lastCrawledAt = new Date().toISOString();
  entry.lastCompletedDate = dateStr;
  entry.lastDateItemCount = totalDateCount;

  saveCheckpoints(state);
}

/**
 * 로컬 `data/raw/` 폴더 내 스크립트 파일들의 용량과 날짜 범위를 스캔하여 요약 반환
 */
export function computeRawStorageSummary(state) {
  let rawFilesCount = 0;
  let rawDiskBytes = 0;
  const dateDirs = [];
  const perChannelBytes = {};

  if (fs.existsSync(RAW_DATA_DIR)) {
    const entries = fs.readdirSync(RAW_DATA_DIR, { withFileTypes: true });
    for (const d of entries) {
      if (d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name)) {
        dateDirs.push(d.name);
        const dayDir = path.join(RAW_DATA_DIR, d.name);
        const files = fs.readdirSync(dayDir).filter((f) => f.endsWith('.json'));
        for (const f of files) {
          const fullPath = path.join(dayDir, f);
          const stat = fs.statSync(fullPath);
          rawFilesCount += 1;
          rawDiskBytes += stat.size;
          const chId = f.replace(/\.json$/, '');
          perChannelBytes[chId] = (perChannelBytes[chId] || 0) + stat.size;
        }
      }
    }
  }

  dateDirs.sort();

  let totalArticlesAndVideos = 0;
  for (const [chId, chEntry] of Object.entries(state.channels || {})) {
    chEntry.rawBytesOnDisk = perChannelBytes[chId] || 0;
    totalArticlesAndVideos += chEntry.totalCollectedCount || 0;
  }

  return {
    totalChannels: Object.keys(state.channels || {}).length,
    totalArticlesAndVideos,
    rawFilesCount,
    rawDiskBytes,
    rawDiskKB: Number((rawDiskBytes / 1024).toFixed(2)),
    rawDiskMB: Number((rawDiskBytes / (1024 * 1024)).toFixed(3)),
    oldestRawDate: dateDirs[0] || null,
    newestRawDate: dateDirs[dateDirs.length - 1] || null,
  };
}
