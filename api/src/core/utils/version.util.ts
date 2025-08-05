// api/src/core/utils/version.util.ts
// ----------------------------------

import { Request } from 'express';

/** バージョンが入る想定ヘッダー名 */
const VERSION_HEADER = 'x-app-version';

/**
 * 🔍 リクエストからバージョン文字列を取得
 */
export const getCurrentVersionFromRequest = (req: Request): string => {
  const raw =
    (req.headers[VERSION_HEADER] as string | undefined) ??
    (req.query?.version as string | undefined) ??
    (req.body?.version as string | undefined);

  if (!raw || typeof raw !== 'string') {
    throw new Error('Missing or invalid x-app-version header');
  }
  return raw;
};

/**
 * 🔢 メジャーバージョンを整数で取得
 */
export const getCurrentVersionMajorFromRequest = (req: Request): number => {
  const version = getCurrentVersionFromRequest(req);
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);

  if (Number.isNaN(major) || major < 0) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return major;
};

/**
 * ⬆️ 現在バージョンが minimumVersion 以上か判定
 */
export const isVersionGreaterOrEqual = (
  currentVersion: string,
  minimumVersion: string,
): boolean => {
  const toTuple = (v: string) => v.split('.').map(Number);
  const [cMaj = 0, cMin = 0, cPat = 0] = toTuple(currentVersion);
  const [mMaj = 0, mMin = 0, mPat = 0] = toTuple(minimumVersion);

  if (cMaj !== mMaj) return cMaj > mMaj;
  if (cMin !== mMin) return cMin > mMin;
  return cPat >= mPat;
};
