/**
 * Supabase JWT ペイロード仕様 (一部抜粋)
 * https://supabase.com/docs/guides/auth#jwt
 */
export interface JwtPayload {
  /** User ID (UUID) */
  sub: string;
  /** 匿名ログインかどうか */
  is_anonymous: boolean;
  /** 任意の追加クレーム */
  aud?: string;
  exp?: number;
  iat?: number;
  email?: string;
  role?: string | string[];
  provider?: string;
  [key: string]: unknown;
}

/** Express Request にマージされる user オブジェクト */
export interface RequestUser {
  /** User ID */
  id: string;
  /** 匿名ユーザーかどうか */
  isAnonymous: boolean;
  email?: string;
  roles?: string[];
  provider?: string;
  /** 生のクレーム */
  rawClaims?: JwtPayload;
}
