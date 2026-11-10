/**
 * 언론사(방송사 20곳 · 일간지 20곳) 기본 별명(Alias) 사전 및 설정 관리 유틸리티
 * - 설정(Settings) 화면에서 사용자가 각 언론사의 별명을 자유롭게 수정·저장·초기화할 수 있습니다.
 */

export interface MediaAliasEntry {
  canonicalName: string;
  defaultAlias: string;
  group: 'BROADCAST' | 'NEWSPAPER';
}

export const MEDIA_ALIAS_ENTRIES: MediaAliasEntry[] = [
  // 방송사 (20곳)
  { canonicalName: 'YTN', defaultAlias: 'YTN', group: 'BROADCAST' },
  { canonicalName: 'MBCNEWS', defaultAlias: 'MBC', group: 'BROADCAST' },
  { canonicalName: 'SBS 뉴스', defaultAlias: 'SBS', group: 'BROADCAST' },
  { canonicalName: 'JTBC News', defaultAlias: 'JTBC', group: 'BROADCAST' },
  { canonicalName: 'KBS News', defaultAlias: 'KBS', group: 'BROADCAST' },
  { canonicalName: '채널A News', defaultAlias: '채널A', group: 'BROADCAST' },
  { canonicalName: '뉴스TVCHOSUN', defaultAlias: '조선', group: 'BROADCAST' },
  { canonicalName: 'MBN News', defaultAlias: 'MBN', group: 'BROADCAST' },
  { canonicalName: '연합뉴스TV', defaultAlias: '연합', group: 'BROADCAST' },
  { canonicalName: '한국경제TV', defaultAlias: '한경', group: 'BROADCAST' },
  { canonicalName: 'MTN 머니투데이방송', defaultAlias: '머니투', group: 'BROADCAST' },
  { canonicalName: 'SBS Biz', defaultAlias: 'SBS경', group: 'BROADCAST' },
  { canonicalName: 'TBS 시민의방송', defaultAlias: 'TBS', group: 'BROADCAST' },
  { canonicalName: '매일경제TV', defaultAlias: '매경', group: 'BROADCAST' },
  { canonicalName: 'Arirang News', defaultAlias: '아리랑', group: 'BROADCAST' },
  { canonicalName: 'KTV 국민방송', defaultAlias: 'KTV', group: 'BROADCAST' },
  { canonicalName: '국회방송 NATV', defaultAlias: '국회', group: 'BROADCAST' },
  { canonicalName: 'KNN News', defaultAlias: 'KNN', group: 'BROADCAST' },
  { canonicalName: 'OBS 뉴스', defaultAlias: 'OBS', group: 'BROADCAST' },
  { canonicalName: 'TBC 뉴스', defaultAlias: 'TBC', group: 'BROADCAST' },

  // 일간지 (20곳)
  { canonicalName: '조선일보', defaultAlias: '조선', group: 'NEWSPAPER' },
  { canonicalName: '중앙일보', defaultAlias: '중앙', group: 'NEWSPAPER' },
  { canonicalName: '동아일보', defaultAlias: '동아', group: 'NEWSPAPER' },
  { canonicalName: '한겨레', defaultAlias: '한겨례', group: 'NEWSPAPER' },
  { canonicalName: '경향신문', defaultAlias: '경향', group: 'NEWSPAPER' },
  { canonicalName: '한국일보', defaultAlias: '한국', group: 'NEWSPAPER' },
  { canonicalName: '서울신문', defaultAlias: '서울', group: 'NEWSPAPER' },
  { canonicalName: '국민일보', defaultAlias: '국민', group: 'NEWSPAPER' },
  { canonicalName: '문화일보', defaultAlias: '문화', group: 'NEWSPAPER' },
  { canonicalName: '세계일보', defaultAlias: '세계', group: 'NEWSPAPER' },
  { canonicalName: '부산일보', defaultAlias: '부산', group: 'NEWSPAPER' },
  { canonicalName: '매일신문', defaultAlias: '매일', group: 'NEWSPAPER' },
  { canonicalName: '아시아투데이', defaultAlias: '아시아', group: 'NEWSPAPER' },
  { canonicalName: '영남일보', defaultAlias: '영남', group: 'NEWSPAPER' },
  { canonicalName: '국제신문', defaultAlias: '국제', group: 'NEWSPAPER' },
  { canonicalName: '강원일보', defaultAlias: '강원', group: 'NEWSPAPER' },
  { canonicalName: '경인일보', defaultAlias: '경인', group: 'NEWSPAPER' },
  { canonicalName: '대전일보', defaultAlias: '대전', group: 'NEWSPAPER' },
  { canonicalName: '내일신문', defaultAlias: '내일', group: 'NEWSPAPER' },
  { canonicalName: '광주일보', defaultAlias: '광주', group: 'NEWSPAPER' },
];

export const DEFAULT_MEDIA_ALIASES: Record<string, string> = {
  // 사용자 지정 기본 별명 매핑
  YTN: 'YTN',
  MBCNEWS: 'MBC',
  MBC: 'MBC',
  SBS: 'SBS',
  'SBS 뉴스': 'SBS',
  'TBC News': 'JTBC',
  'JTBC News': 'JTBC',
  JTBC: 'JTBC',
  'KBS News': 'KBS',
  KBS: 'KBS',
  '채널A News': '채널A',
  채널A: '채널A',
  뉴스TVCHOSUN: '조선',
  TV조선: '조선',
  'MBN News': 'MBN',
  MBN: 'MBN',
  연합뉴스TV: '연합',
  한국경제TV: '한경',
  'MTN 머니투데이방송': '머니투',
  'SBS Biz': 'SBS경',
  'TBS 시민의방송': 'TBS',
  매일경제TV: '매경',
  'Arirang News': '아리랑',
  'KTV 국민방송': 'KTV',
  '국회방송 NATV': '국회',
  'KNN News': 'KNN',
  'OBS 뉴스': 'OBS',
  'TBC 뉴스': 'TBC',
  조선일보: '조선',
  중앙일보: '중앙',
  동아일보: '동아',
  한겨레: '한겨례',
  경향신문: '경향',
  한국일보: '한국',
  서울신문: '서울',
  국민일보: '국민',
  문화일보: '문화',
  세계일보: '세계',
  부산일보: '부산',
  매일신문: '매일',
  아시아투데이: '아시아',
  영남일보: '영남',
  국제신문: '국제',
  강원일보: '강원',
  경인일보: '경인',
  대전일보: '대전',
  내일신문: '내일',
  광주일보: '광주',
};

const STORAGE_KEY = 'koreaIssues.mediaAliases.v1';

export function loadMediaAliases(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MEDIA_ALIASES };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        ...DEFAULT_MEDIA_ALIASES,
        ...parsed,
      };
    }
  } catch {
    // ignore storage errors
  }
  return { ...DEFAULT_MEDIA_ALIASES };
}

export function saveMediaAliases(aliases: Record<string, string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(aliases));
  } catch {
    // ignore storage errors
  }
}

export function resetMediaAliases(): Record<string, string> {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return { ...DEFAULT_MEDIA_ALIASES };
}

export function getMediaAlias(
  rawName: string,
  aliases: Record<string, string> = DEFAULT_MEDIA_ALIASES
): string {
  const trimmed = (rawName || '').trim();
  if (!trimmed) return '';
  if (aliases[trimmed]) return aliases[trimmed];
  if (trimmed === 'SBS' && aliases['SBS 뉴스']) return aliases['SBS 뉴스'];
  if (trimmed === 'SBS 뉴스' && aliases['SBS']) return aliases['SBS'];
  if (trimmed === 'TBC News' && aliases['JTBC News']) return aliases['JTBC News'];
  if (DEFAULT_MEDIA_ALIASES[trimmed]) return DEFAULT_MEDIA_ALIASES[trimmed];
  return trimmed;
}
