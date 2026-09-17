// api/src/v1/restaurants/restaurant-draft.token.ts
//
// #1671 【設計】**ユーザーが «Google の既定値を書き換えたか» を、Google を呼び直さずに知る。**
//
// このチケットの要件はこうである。
//
// > 確認画面の既定値は Google 由来。ユーザーが書き換えたかどうかをサーバが知る必要がある。
// > **既定値と確定値の両方をリクエストに含め、サーバで比較して記録する。**
// > （既定値をそのまま送り返させる作りでは検知にならない）
//
// 素直に「既定値も一緒に送ってもらう」と、**その既定値自体をクライアントが自由に作れる**ので
// 検知にならない（要件の括弧書きはこれを言っている）。かといって作成時に Place Details を
// もう一度叩くと、#843（Google Places 依存を減らす）の趣旨に逆行して呼び出しが 2 倍になる。
//
// そこで **下読み（POST /v1/restaurants/draft）の時点でサーバが署名したトークン**に
// Google 由来の既定値を封じ込め、作成時はその署名を検証するだけにする。
//
//     下読み  : Google を 2 回叩く → 既定値 + 署名トークンを返す
//     確認画面: ユーザーが直す（トークンはそのまま持ち回る）
//     作成    : トークンの署名を検証 → 封じた既定値と、送られた確定値を比較
//               → **Google は 1 回も叩かない**
//
// これで «サーバが知っている既定値» が改ざん不能になり、かつ Google の呼び出し回数は
// 下読みへ前倒しされるだけで増えない（ユーザーがキャンセルした場合はむしろ行が減る）。
//
// ⚠️ **差分を «どう扱うか» はここでは決めない。** 荒らしの入口でもあり欲しい UGC でもあるので、
// 扱いは #1827 で決める。ここが提供するのは «正しく差分を出せる» という仕組みだけである。
//
// ## 鍵をここで新設しない
// `maps-embed.token.ts` と同じ理由・同じ方式で、既存の `SUPABASE_JWT_SECRET` を流用する。
// HMAC の入力へ専用の名前空間（`HMAC_CONTEXT`）を混ぜてあるので、他用途の署名データと
// 衝突しても再利用（cross-protocol）攻撃は成立しない。

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 下読みしてから確認画面を出し終えるまでの猶予。
 * 長すぎると「古い Google の値を持ったまま作る」余地が伸びるが、
 * 短すぎると確認の途中で失効してユーザーが作れなくなる。
 */
export const RESTAURANT_DRAFT_TOKEN_TTL_MS = 30 * 60 * 1000;

const TOKEN_PREFIX = 'rdt1'; // restaurant draft token, format version 1
const HMAC_CONTEXT = 'nanitabeyo.restaurant-draft-token.v1';

/**
 * 下読みで得た **Google 由来の既定値**。確認画面の初期値そのもの。
 *
 * ⚠️ `nameLanguageCode` を含めているのは、作成時に Google を呼び直さないためである。
 * これが無いと現地言語の判定のためだけに Place Details をもう 1 回叩くことになる。
 */
export type RestaurantDraftTokenPayload = {
  googlePlaceId: string;
  name: string;
  nameLanguageCode: string;
  latitude: number;
  longitude: number;
  /** Google の addressComponents をそのまま JSON 文字列で封じる（比較と保存に使う） */
  addressComponentsJson: string;
  /** Google の plusCode。無い店があるので null 可 */
  plusCodeJson: string | null;
  /** addressComponents から組み立てた表示用住所。確認ページの住所欄の初期値 */
  address: string;
  /** ISO 3166-1 alpha-2。判定できなければ null */
  countryCode: string | null;
  /**
   * #1671 州・県の識別子。判定できなければ null。
   *
   * ⚠️ **ISO 3166-2 とは限らない**（`JP-Oita` のような値が入る）。
   * ⚠️ **ユーザーは編集できない。** 画面に出しても意味が分からない機械用の鍵であり、
   *    自由入力させると `subterritory_overrides.json` と一致しなくなるだけである。
   *    それでもトークンへ封じるのは、`countryCode` と同じく **Google 由来の値が
   *    確定までの間に差し替えられないこと**を保証するためである。
   */
  subterritoryCode: string | null;
};

type SignedPayload = RestaurantDraftTokenPayload & { exp: number };

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${HMAC_CONTEXT}.${payloadB64}`, 'utf8')
    .digest('base64url');
}

/**
 * 下読みの結果へ署名して 1 本発行する。
 * `now` は呼び出し側から渡す（テストで期限切れを再現するため）。
 */
export function signRestaurantDraftToken(
  payload: RestaurantDraftTokenPayload,
  secret: string,
  now: number,
): string {
  const signed: SignedPayload = {
    ...payload,
    exp: now + RESTAURANT_DRAFT_TOKEN_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(signed), 'utf8').toString(
    'base64url',
  );
  return `${TOKEN_PREFIX}.${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * トークンを検証する。署名不一致・期限切れ・形が壊れている場合は null。
 *
 * ⚠️ 自分が発行したトークンでも、復号後の形は防御的に再確認する
 * （`maps-embed.token.ts` と同じ方針）。
 */
export function verifyRestaurantDraftToken(
  token: string,
  secret: string,
  now: number,
): RestaurantDraftTokenPayload | null {
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

  const {
    googlePlaceId,
    name,
    nameLanguageCode,
    latitude,
    longitude,
    addressComponentsJson,
    plusCodeJson,
    address,
    countryCode,
    subterritoryCode,
  } = parsed;
  return {
    googlePlaceId,
    name,
    nameLanguageCode,
    latitude,
    longitude,
    addressComponentsJson,
    plusCodeJson,
    address,
    countryCode,
    subterritoryCode,
  };
}

function isSignedPayloadShape(value: unknown): value is SignedPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.googlePlaceId === 'string' &&
    typeof v.name === 'string' &&
    typeof v.nameLanguageCode === 'string' &&
    typeof v.latitude === 'number' &&
    typeof v.longitude === 'number' &&
    typeof v.addressComponentsJson === 'string' &&
    (v.plusCodeJson === null || typeof v.plusCodeJson === 'string') &&
    typeof v.address === 'string' &&
    (v.countryCode === null || typeof v.countryCode === 'string') &&
    (v.subterritoryCode === null ||
      typeof v.subterritoryCode === 'string') &&
    typeof v.exp === 'number'
  );
}

/** ユーザーが確認画面で確定させた値。既定値と突き合わせる対象。 */
export type ConfirmedRestaurantValues = {
  name: string;
  latitude: number;
  longitude: number;
  address: string;
  countryCode: string | null;
  /**
   * #1671 ⚠️ **ユーザーは触れない。常にトークンの値がそのまま入る。**
   * したがって `diffConfirmedRestaurantValues` の «変更された項目» にも出てこない。
   * 画面に出さない理由は `RestaurantDraftTokenPayload` 側のコメントを参照。
   */
  subterritoryCode: string | null;
};

/**
 * 座標の «書き換え» と «同じ場所を指す丸め誤差» を分ける閾値。
 *
 * ⚠️ 確認画面は地図に既定の座標を出すだけで、ユーザーは動かせない（→ #1671 の受け入れ条件）。
 * それでも往復で float の桁が落ちることはあるので、**1e-6 度（緯度で約 0.11m）** 未満は
 * 「同じ値が返ってきた」とみなす。ここを 0 にすると、書き換えていない端末まで
 * «書き換えた» と記録され、#1827 で見るべき信号が埋もれる。
 */
export const COORDINATE_EQUALITY_EPSILON = 1e-6;

/**
 * 既定値（署名済み）と確定値を比べ、**書き換えられた項目名**を返す。
 * 何も変わっていなければ空配列。
 */
export function diffConfirmedRestaurantValues(
  baseline: RestaurantDraftTokenPayload,
  confirmed: ConfirmedRestaurantValues,
): string[] {
  const changed: string[] = [];
  if (confirmed.name !== baseline.name) changed.push('name');
  if (
    Math.abs(confirmed.latitude - baseline.latitude) >=
    COORDINATE_EQUALITY_EPSILON
  ) {
    changed.push('latitude');
  }
  if (
    Math.abs(confirmed.longitude - baseline.longitude) >=
    COORDINATE_EQUALITY_EPSILON
  ) {
    changed.push('longitude');
  }
  if (confirmed.address !== baseline.address) changed.push('address');
  if (confirmed.countryCode !== baseline.countryCode) {
    changed.push('countryCode');
  }
  return changed;
}
