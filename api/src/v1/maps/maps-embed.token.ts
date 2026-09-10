// api/src/v1/maps/maps-embed.token.ts
//
// #1810 PL レビュー 2番: /v1/maps/embed に認証ガードが無い問題への対応。
//
// WebView / iframe は URL を «文書として» 読むので Authorization ヘッダを付けられない。
// そのため、認証必須（AuthAnonGuard）の POST /v1/maps/embed-token で mode/q/center/zoom/hl を
// 検証・署名した短命トークンへ変換し、ガード無しの GET /v1/maps/embed はそのトークンの
// 署名と有効期限だけを見る。「トークンを持っていること」自体が、直前に認証済みリクエストで
// 発行を受けたことの証明になる。
//
// ## 鍵をここで新設しない
// 署名鍵は既存の `SUPABASE_JWT_SECRET`（HS256 の JWT 検証に使っている HMAC 秘密値）を流用する。
// この用途は Embed API キー（$0・上限なし SKU）の露出面を絞ることが目的で、被害の大きさは
// 限定的なため、新しい optional env を増やして「未設定時の挙動」を別に定義するコストに見合わない。
// 名前空間プレフィックス（`MAPS_EMBED_TOKEN_HMAC_CONTEXT`）を HMAC の入力に混ぜることで、
// 万一 JWT 側の署名データと衝突しても再利用（cross-protocol）攻撃が成立しないようにしてある。

import { createHmac, timingSafeEqual } from 'node:crypto';
import { MAPS_EMBED_MODES, type MapsEmbedMode } from '@shared/v1/dto';

/** 短命トークンの有効期限。長すぎると「盗まれた URL」の悪用余地が伸びる */
export const MAPS_EMBED_TOKEN_TTL_MS = 5 * 60 * 1000;

const TOKEN_PREFIX = 'met1'; // maps embed token, format version 1
const HMAC_CONTEXT = 'nanitabeyo.maps-embed-token.v1';

export type MapsEmbedTokenPayload = {
  mode: MapsEmbedMode;
  q: string;
  center?: string;
  zoom?: number;
  hl?: string;
};

type SignedPayload = MapsEmbedTokenPayload & { exp: number };

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${HMAC_CONTEXT}.${payloadB64}`, 'utf8')
    .digest('base64url');
}

/**
 * トークンを 1 本発行する。`now` は呼び出し側から渡す（テストで期限切れを再現するため）。
 */
export function signMapsEmbedToken(
  payload: MapsEmbedTokenPayload,
  secret: string,
  now: number,
): string {
  const signed: SignedPayload = {
    ...payload,
    exp: now + MAPS_EMBED_TOKEN_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(signed), 'utf8').toString(
    'base64url',
  );
  const signature = sign(payloadB64, secret);
  return `${TOKEN_PREFIX}.${payloadB64}.${signature}`;
}

/**
 * トークンを検証する。署名不一致・期限切れ・形が壊れている場合は null。
 *
 * ⚠️ 検証成功後の payload も、呼び出し側で `mode` が MAPS_EMBED_MODES に含まれるか等の
 * 形はここで再確認する（トークンは自分が発行したものだが、防御的に二重チェックする）。
 */
export function verifyMapsEmbedToken(
  token: string,
  secret: string,
  now: number,
): MapsEmbedTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [prefix, payloadB64, signature] = parts;
  if (prefix !== TOKEN_PREFIX || !payloadB64 || !signature) return null;

  const expectedSignature = sign(payloadB64, secret);
  const actual = Buffer.from(signature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isSignedPayloadShape(parsed)) return null;
  if (parsed.exp <= now) return null;

  const { mode, q, center, zoom, hl } = parsed;
  return { mode, q, center, zoom, hl };
}

function isSignedPayloadShape(value: unknown): value is SignedPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.mode === 'string' &&
    (MAPS_EMBED_MODES as readonly string[]).includes(v.mode) &&
    typeof v.q === 'string' &&
    (v.center === undefined || typeof v.center === 'string') &&
    (v.zoom === undefined || typeof v.zoom === 'number') &&
    (v.hl === undefined || typeof v.hl === 'string') &&
    typeof v.exp === 'number'
  );
}
