import { Request } from 'express';

/**
 * Authorization ヘッダから Bearer トークンだけを取り出す
 * - "Bearer xxxx.yyy.zzz" → "xxxx.yyy.zzz"
 * - 規格外は null を返す（Guard 側で判定）
 */
export const extractBearerToken = (req: Request): string | null => {
  const header = req.headers['authorization'] ?? req.headers['Authorization'];
  if (typeof header !== 'string') return null;

  const [type, token] = header.trim().split(' ');
  return type?.toLowerCase() === 'bearer' && token ? token : null;
};
