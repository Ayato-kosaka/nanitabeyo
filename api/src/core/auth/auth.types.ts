/**
 * Supabase JWT ペイロード仕様 (一部抜粋)
 * https://supabase.com/docs/guides/auth/jwt-fields
 */
export interface SupabaseJwtPayload {
  /** Issuer - JWT 発行者 */
  iss: string;
  /** Audience - JWT の想定受信者 */
  aud: JwtAudienceValue | JwtAudienceValue[];
  /** Expiration Time - 有効期限 (Unix タイムスタンプ) */
  exp: number;
  /** Issued At - 発行日時 (Unix タイムスタンプ) */
  iat: number;
  /** Subject - ユーザー ID (UUID) */
  sub: string;
  /** Role - ユーザーのシステム内ロール */
  role: JwtRoleValue;
  /** Authenticator Assurance Level - 認証強度 */
  aal: string;
  /** Session ID - ユニークなセッション識別子 */
  session_id: string;
  /** Email - ユーザーのメールアドレス */
  email?: string;
  /** Phone - ユーザーの電話番号 */
  phone?: string;
  /** Anonymous Flag - ユーザーが匿名かどうか */
  is_anonymous: boolean;

  /** JWT ID - ユニークな JWT トークン識別子 */
  jti?: string;
  /** Not Before - この日時以前はトークンが無効であることを示す (Unix タイムスタンプ) */
  nbf?: number;
  /** App Metadata - アプリケーション固有のユーザーデータ */
  app_metadata?: Record<string, any>;
  /** User Metadata - ユーザー固有のデータ */
  user_metadata?: Record<string, any>;
  /** Authentication Methods Reference - 使用された認証方法のリスト */
  amr?: Array<{ method: string; timestamp: number }>;
}

/** Express Request にマージされる user オブジェクト */
export interface RequestUser {
  /** User ID */
  id: string;
  /** 匿名ユーザーかどうか */
  isAnonymous: boolean;
  email?: string;
  role: string;
  /** 生のクレーム */
  rawClaims?: SupabaseJwtPayload;
}

export type JwtRoleValue =
  | 'anon' // 匿名ユーザー
  | 'authenticated' // 認証済みユーザー
  | 'service_role'; // 管理者 (Supabase のみ使用)

export type JwtAudienceValue =
  | 'authenticated' // 認証済みユーザー向けのトークン
  | 'anon'; // 匿名ユーザー向けのトークン
