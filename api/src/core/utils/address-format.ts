// api/src/core/utils/address-format.ts
//
// #1196 【仕様】クライアントから届く `address` の形式判定
//

const COUNTRY_TOKEN_PREFIX = 'country:';

/**
 * #1196 【設計】国コードは ISO 3166-1 alpha-2 の**大文字 2 文字**であること。
 *
 * ゲートの照合は `dish-categories.repository.ts` の
 * `dcf.feature_key = ANY(p.region_tokens)` — Postgres の `=` なので**大小文字区別あり**である。
 * ホワイトリストに投入されている key は `region:country:JP`（`infra/supabase/migrations/
 * 20251224T0003_create_dish_category_features.sql` のコメント、および
 * `scripts/20251213T0000_wikidata_food_graph/557_region_gate` の投入仕様を参照）。
 * したがって `country:jp` を送ると `region:country:jp` となり、どのゲートにも当たらない。
 *
 * 「country トークンさえあればゲートは必ず成立する」という下の前提が成り立つのは大文字のときだけなので、
 * 形式判定でも大小文字まで見る。
 */
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

/**
 * #1196 【仕様】`address` が料理カテゴリ推薦 API の期待する正規形式かどうかを判定する。
 *
 * 正規形式は `api/src/v1/locations/locations.service.ts` の `buildAddressFromComponents` が
 * 生成する、カンマ区切りの機械可読トークン列:
 *
 *   "country:JP, administrative_area_level_1:Osaka, locality:Osaka"
 *
 * 判定はクライアント側 (`app-expo/lib/addressFormat.ts` の `isCanonicalAddress`) と揃えてあり、
 * 「いずれかのトークンが `country:<大文字 2 文字>` であること」を最小要件とする。
 * `dish_category_features(feature_type='gate')` のホワイトリストは国単位で投入されているため
 * (日本向けは `region:country:JP` のみ)、この形の `country:` トークンがあれば地域ゲートは必ず成立する。
 *
 * 逆にこれが false になる address(例: 市区町村名単体の "大阪市")は、どのゲートにも当たらず
 * `region:scope:global` を持つカテゴリしか残らない。これは仕様ではなく**クライアント側のバグの兆候**である。
 *
 * #1196 【判断】小文字の国コード(`country:jp`)を「サーバ側で救う」ことはしない。
 *
 * 旧ビルドが `country:jp` を送ってきた場合、`normalizeInput` で region_tokens を組むときに
 * 国コードを大文字化すれば確かに救済できる。それでもここでは救済せず **warn を出すだけ**にした:
 *
 * - 救済すると `MalformedAddressFormat` が出なくなり、「クライアントが壊れた値を送っている」という
 *   事実そのものが観測できなくなる。#1196 の教訓は「黙って Claude へ落ちていたので気づけなかった」
 *   ことなので、検知を潰す方向の変更は本 PR の目的と正面から矛盾する。
 * - region_tokens は `regionFallbackKeys` 経由で market_salience / dine_out_orderability の
 *   探索キーにもなる(`dish-categories.service.ts` / repository の LATERAL 参照)。サーバ側で値を
 *   書き換えると、ゲート以外のスコアリングまで巻き込んで挙動が変わる。どのトークン種別にどんな
 *   大小文字規約でデータが入っているかは確かめていないため、ここで一律の正規化を入れるのは危険側。
 * - クライアント側 (`buildAddressFromGeocodedAddress`) で大文字化済みなので、新ビルドでは発生しない。
 *   旧ビルドは degraded のまま(= これまでと同じ挙動)で、悪化はしない。
 *
 * つまりサーバは「壊れた値を直す層」ではなく「壊れた値が来たことを鳴らす層」に徹する。
 */
export function isCanonicalAddress(
  address: string | null | undefined,
): boolean {
  return findAddressFormatViolation(address) === null;
}

/**
 * #1196 【仕様】非正規形式の理由。`MalformedAddressFormat` ログの `reason` に載せる。
 *
 * - `missing_country_token`: `country:` トークンが 1 つも無い（例: 市区町村名単体の "大阪市"）
 * - `malformed_country_code`: `country:` はあるが値が大文字 alpha-2 でない（例: "country:jp"）
 *
 * 原因が別物（前者はクライアントの組み立てロジック、後者は大小文字の正規化漏れ）なので、
 * トリアージで区別できるように分けておく。
 */
export type AddressFormatViolation =
  | 'missing_country_token'
  | 'malformed_country_code';

/**
 * #1196 【仕様】`address` が正規形式でない場合にその理由を返す（正規形式なら `null`）。
 */
export function findAddressFormatViolation(
  address: string | null | undefined,
): AddressFormatViolation | null {
  const countryTokens = (address ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.startsWith(COUNTRY_TOKEN_PREFIX));

  if (countryTokens.length === 0) return 'missing_country_token';

  const hasValidCountryCode = countryTokens.some((token) =>
    COUNTRY_CODE_PATTERN.test(token.slice(COUNTRY_TOKEN_PREFIX.length)),
  );

  return hasValidCountryCode ? null : 'malformed_country_code';
}
