import crypto from 'node:crypto';
import { MAX_FILENAME_BYTES } from './storage.constants';

/* -------------------------------------------------------------------------- */
/*                               MIME → ext map                               */
/* -------------------------------------------------------------------------- */
export const EXTENSION_TABLE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
};

/** 未知の MIME は “bin” 拡張子扱い */
export const getExt = (mime: keyof typeof EXTENSION_TABLE): string => EXTENSION_TABLE[mime];

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
  env: string;
  resourceType: string;
  usageType: string;
  finalFileName: string;
}): string =>
  `${params.env}/${params.resourceType}/${params.usageType}/${params.finalFileName}`;
