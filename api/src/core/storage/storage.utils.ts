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
  const fileNameWithoutExt = originalFileName.replace(/\.[^/.]+$/, '').split('.')[0];
  const gcsPath = `${env.API_NODE_ENV}/resized-image/${params.table}/${params.column}/${params.recordId}/${fileNameWithoutExt}/${params.size}.webp`;
  return type === 'gcs' ? gcsPath : `https://${env.CDN_HOST}/${gcsPath}`;
}

/** 
 * Build the transcoded video path based on naming convention
 * ${env}/transcoded-video/${table}/${column}/${recordId}/${fileName}/${format}
 */
export function buildTranscodedPath(
  params: { table: string; column: string; recordId: string; originalPath: string },
  type: 'gcs' | 'cdn' = 'gcs',
): string {
  const originalFileName = params.originalPath.split('/').pop();
  if (!originalFileName) throw new Error('Invalid originalPath');
  const fileNameWithoutExt = originalFileName.replace(/\.[^/.]+$/, '').split('.')[0];
  const gcsPath = `${env.API_NODE_ENV}/transcoded-video/${params.table}/${params.column}/${params.recordId}/${fileNameWithoutExt}/master.m3u8`;
  return type === 'gcs' ? gcsPath : `https://${env.CDN_HOST}/${gcsPath}`;
}

/* -------------------------------------------------------------------------- */
/*                          ファイル名チェック                                */
/* -------------------------------------------------------------------------- */
export const isValidUserUploadedPath = (fileName: string, userId): boolean => {
  return fileName.startsWith(`${env.API_NODE_ENV}/user-uploads/${userId}/`);
};
