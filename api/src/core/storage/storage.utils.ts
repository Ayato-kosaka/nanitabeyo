import crypto from 'node:crypto';
import { MAX_FILENAME_BYTES } from './storage.constants';
import { env } from '../config/env';
import { ResizeImageDto } from 'src/internal/resize-image/resize-image.dto';

/* -------------------------------------------------------------------------- */
/*                               MIME → ext map                               */
/* -------------------------------------------------------------------------- */
export const EXTENSION_TABLE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/json': 'json',
} as const;

/** 未知の MIME は “bin” 拡張子扱い */
export const getExt = (mime: string): string =>
  EXTENSION_TABLE[mime as keyof typeof EXTENSION_TABLE] || 'bin';

/* -------------------------------------------------------------------------- */
/*                               ファイル名生成                               */
/* -------------------------------------------------------------------------- */
export const buildFileName = (baseName: string, ext: string): string => {
  const slug = baseName
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_\-]/g, '')
    .slice(0, MAX_FILENAME_BYTES);

  return `${Date.now()}_${slug || crypto.randomUUID()}.${ext}`;
};

/* -------------------------------------------------------------------------- */
/*                              GCS パスビルダー                              */
/* -------------------------------------------------------------------------- */
export const buildFullPath = (params: {
  resourceType: string;
  usageType: string;
  finalFileName: string;
}): string =>
  `${env.API_NODE_ENV}/${params.resourceType}/${params.usageType}/${params.finalFileName}`;

/**
 * Build the resized image path based on naming convention
 * ${env}/resized-image/${table}/${column}/${recordId}/${fileName}/${size}.webp
 */
export function buildResizedPath(
  params: ResizeImageDto,
  type: 'gcs' | 'cdn' = 'gcs',
): string {
  const originalFileName = params.originalPath.split('/').pop();
  if (!originalFileName) throw new Error('Invalid originalPath');
  const fileNameWithoutExt = originalFileName
    .replace(/\.[^/.]+$/, '')
    .split('.')[0];
  const gcsPath = `${env.API_NODE_ENV}/resized-image/${params.table}/${params.column}/${params.recordId}/${fileNameWithoutExt}/${params.size}.webp`;
  return type === 'gcs' ? gcsPath : `https://${env.CDN_HOST}/${gcsPath}`;
}

/**
 * Build the transcoded video path based on naming convention
 * ${env}/transcoded-video/${table}/${column}/${recordId}/${fileName}/${format}
 */
export function buildTranscodedPath(
  params: {
    table: string;
    column: string;
    recordId: string;
    originalPath: string;
  },
  type: 'gcs' | 'cdn' = 'gcs',
): string {
  const originalFileName = params.originalPath.split('/').pop();
  if (!originalFileName) throw new Error('Invalid originalPath');
  const fileNameWithoutExt = originalFileName
    .replace(/\.[^/.]+$/, '')
    .split('.')[0];
  const gcsPath = `${env.API_NODE_ENV}/transcoded-video/${params.table}/${params.column}/${params.recordId}/${fileNameWithoutExt}/master.m3u8`;
  return type === 'gcs' ? gcsPath : `https://${env.CDN_HOST}/${gcsPath}`;
}

/**
 * #1511 派生ファイル（リサイズ画像 / トランスコード動画）のレコード単位プレフィクス。
 *
 * `buildResizedPath` / `buildTranscodedPath` は **サイズやフォーマットまで含む 1 本の
 * パス**を返す。アカウント削除で実体を消すときは、どのサイズが生成済みかを
 * 呼び出し側が知らないため、レコード単位で前方一致削除する必要がある。
 *
 * 返す文字列は `/` で終わる（`<id>` と `<id>2` の取り違えを防ぐ）。
 *
 * @example buildDerivedPrefix({ kind: 'resized-image', table: 'users', column: 'avatar_path', recordId })
 *   → 'development/resized-image/users/avatar_path/<recordId>/'
 */
export function buildDerivedPrefix(params: {
  kind: 'resized-image' | 'transcoded-video';
  table: string;
  column: string;
  recordId: string;
}): string {
  return `${env.API_NODE_ENV}/${params.kind}/${params.table}/${params.column}/${params.recordId}/`;
}

/**
 * #1599 トランスコードの «再実行を 1 回だけにする» ための claim ファイルのパス。
 *
 * Transcoder の `CreateJobRequest` には **job 名を指定する欄が無い**
 * （`ICreateJobRequest` は parent と job だけ。GCP が毎回ランダムな名前を採番する）。
 * つまり «同じ id で作り直せば 2 本目にならない» という作り方ができない。
 * 代わりに **作る前に GCS 上のマーカーを排他生成して権利を取る**（claim-then-create）。
 *
 * 置き場所は出力先の prefix の直下にする。守りたい単位が «この出力先へ書くジョブ» そのもの
 * なので、キーは出力先から導けるのが正しい。加えて、アカウント削除の前方一致削除
 * （`buildDerivedPrefix` 配下）に自然に巻き取られる。
 *
 * @param outputUri Transcoder Job の出力先（`gs://<bucket>/<prefix>/`）
 * @param retryGeneration 何回目の再実行か（1 始まり）
 * @example buildTranscodeRetryClaimPath('gs://b/development/transcoded-video/dish_media/media_path/x/y/', 1)
 *   → 'development/transcoded-video/dish_media/media_path/x/y/.retry-1.claim'
 */
export function buildTranscodeRetryClaimPath(
  outputUri: string,
  retryGeneration: number,
): string {
  const matched = /^gs:\/\/([^/]+)\/(.+)$/.exec(outputUri);
  if (!matched) {
    throw new Error(`Invalid transcode outputUri: ${outputUri}`);
  }
  const [, bucket, objectPrefix] = matched;

  // 出力先と claim が別バケットに分かれると «取ったつもりの権利» が別物になる。
  // 取り違えは黙って二重ジョブになるので、ここで落とす
  if (bucket !== env.GCS_BUCKET_NAME) {
    throw new Error(
      `Transcode outputUri points to another bucket: ${bucket} (expected ${env.GCS_BUCKET_NAME})`,
    );
  }

  const normalized = objectPrefix.endsWith('/')
    ? objectPrefix
    : `${objectPrefix}/`;
  return `${normalized}.retry-${retryGeneration}.claim`;
}

/* -------------------------------------------------------------------------- */
/*                          ファイル名チェック                                */
/* -------------------------------------------------------------------------- */
export const isValidUserUploadedPath = (fileName: string, userId): boolean => {
  return fileName.startsWith(`${env.API_NODE_ENV}/user-uploads/${userId}/`);
};
