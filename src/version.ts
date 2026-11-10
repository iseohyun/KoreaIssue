/**
 * 이원화 버전 관리 및 캐시 버스팅 체계
 * - SEMVER: 정식 시맨틱 버전 (사용자 명시적 승인 시 갱신)
 * - BUILD_TAG: 일자 기반 캐시 버스팅 태그 (YYYYMMDDvN 형식, 수정/빌드 시 자동 갱신)
 */
export const SEMVER = '0.1.0';
export const BUILD_TAG = '20261109v6';
export const APP_VERSION_DISPLAY = `v${SEMVER} (${BUILD_TAG})`;
