// api/src/v1/restaurants/restaurant-display-address.ts
//
// #1671 【設計】**確認ページの「住所」欄に出す初期値**を addressComponents から組み立てる。
//
// ## なぜ Google の formattedAddress を使わないか
//
// `formattedAddress` を取れば各国の並びで正しく整形された住所が得られるが、それには
// Place Details の fieldMask へ 1 項目足す必要がある。この fieldMask は
// `restaurants.service.spec.ts` が **課金 SKU の根拠として固定している**ので、
// 「たぶん同じ SKU のはず」で足すべきではない（#1780 でそう決めてある）。
//
// ここが作るのは **ユーザーが直せる欄の初期値**である。多少ぎこちなくても、
// 違えばその場で直せる。SKU の判断を賭けてまで完璧な初期値を取りに行く価値は無い。
//
// ⚠️ **完璧な住所を作ろうとしないこと。** 正しさの担保はユーザーの確認であって、
// この関数ではない。ここを賢くしていくと、国ごとの例外が延々と生える。
//
// ## 並び順
//
// Google の addressComponents は **小さい単位から大きい単位の順**で並ぶ
// （番地 → 町 → 市 → 県 → 国）。表示の向きは言語圏で逆になる。
//
//   日本・中国・韓国など : 大 → 小（東京都渋谷区…）
//   それ以外             : 小 → 大（123 Main St, Springfield, IL, USA）

/** addressComponents の 1 要素（Google の型から必要な分だけ） */
export type AddressComponentLike = {
  longText?: string | null;
  shortText?: string | null;
  types?: string[] | null;
};

/**
 * 大 → 小の順で書く国。ISO 3166-1 alpha-2。
 * ⚠️ 網羅を目指さない（→ ファイル冒頭）。外れた国は逆順で出るが、ユーザーが直せる。
 */
const LARGE_TO_SMALL_COUNTRIES = new Set(['JP', 'CN', 'KR', 'TW', 'HU']);

/**
 * 住所として意味を持たない type。これらしか持たない component は捨てる。
 * `political` はほぼ全ての行政区画に付くので、**これ単独のときだけ**除外する。
 */
const NOISE_ONLY_TYPES = new Set(['political', 'plus_code']);

/** 国名そのものは «国» 欄で別に見せるので、住所文字列からは外す */
const COUNTRY_TYPE = 'country';

function isMeaningful(component: AddressComponentLike): boolean {
  const types = component.types ?? [];
  if (types.includes(COUNTRY_TYPE)) return false;
  if (types.length === 0) return false;
  return types.some((t) => !NOISE_ONLY_TYPES.has(t));
}

/**
 * 確認ページの住所欄に入れる初期値を組み立てる。
 * 使える component が 1 つも無ければ空文字（ユーザーが 1 から書く）。
 */
export function buildDisplayAddress(
  addressComponents: AddressComponentLike[] | null | undefined,
  countryCode: string | null,
): string {
  // jsonb 由来の呼び出しでは配列でない値が来ることがある（locations.service.ts と同じ事情）
  const components = Array.isArray(addressComponents) ? addressComponents : [];

  const parts = components
    .filter(isMeaningful)
    .map((c) => c.longText || c.shortText || '')
    .filter((text) => text.length > 0);

  if (parts.length === 0) return '';

  const largeToSmall =
    countryCode !== null && LARGE_TO_SMALL_COUNTRIES.has(countryCode);

  if (largeToSmall) {
    // 大 → 小。区切りは入れない（日本語の住所は続けて書く）
    return [...parts].reverse().join('');
  }
  // 小 → 大。読点区切り
  return parts.join(', ');
}

/**
 * #1671 確認ページの «国» 欄に出す表示名（「日本」「United States」など）。
 *
 * ⚠️ **保存するのは `country_code`（ISO 2 文字）のままで、ここは表示専用**である。
 * ユーザーに `JP` とだけ見せても «確認» にならない（自分の国かどうか判断できない）。
 *
 * Google が現地言語で返した `longText` をそのまま使う。取れなければ null
 * （呼び出し側がコード表示か «不明» へ落とす）。
 */
export function extractCountryName(
  addressComponents: AddressComponentLike[] | null | undefined,
): string | null {
  const components = Array.isArray(addressComponents) ? addressComponents : [];
  const country = components.find((c) =>
    (c.types ?? []).includes(COUNTRY_TYPE),
  );
  return country?.longText || null;
}
