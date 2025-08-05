/**
 * Supabase JWT ペイロード仕様 (最低限)
 * https://supabase.com/docs/guides/auth#jwt
 */
export interface JwtPayload {
    sub: string;        // ← UserId (UUID)
    aud?: string;
    exp?: number;
    iat?: number;
    // 他クレームは必要に応じて追加
}

/** Nest Request にマージする user オブジェクト */
export interface RequestUser {
    userId: string;
    token: string;      // Raw JWT (必要なら)
}
