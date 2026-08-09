// api/src/core/utils/address-format.ts
//
// #1196 【仕様】クライアントから届く `address` の形式判定
//

const COUNTRY_TOKEN_PREFIX = 'country:';

/**
 * #1196 【仕様】`address` が料理カテゴリ推薦 API の期待する正規形式かどうかを判定する。
 *
 * 正規形式は `api/src/v1/locations/locations.service.ts` の `buildAddressFromComponents` が
 * 生成する、カンマ区切りの機械可読トークン列:
 *
 *   "country:JP, administrative_area_level_1:Osaka, locality:Osaka"
 *
 * 判定はクライアント側 (`app-expo/lib/addressFormat.ts` の `isCanonicalAddress`) と揃えてあり、
 * 「いずれかのトークンが `country:<値>` であること」を最小要件とする。
 * `dish_category_features(feature_type='gate')` のホワイトリストは国単位で投入されているため
 * (日本向けは `region:country:JP` のみ)、`country:` トークンさえあれば地域ゲートは必ず成立する。
 *
 * 逆にこれが false になる address(例: 市区町村名単体の "大阪市")は、どのゲートにも当たらず
 * 候補0件 → Claude フォールバックへ落ちる。これは仕様ではなく**クライアント側のバグの兆候**である。
 */
export function isCanonicalAddress(
  address: string | null | undefined,
): boolean {
  if (!address) return false;
  return address
    .split(',')
    .map((token) => token.trim())
    .some(
      (token) =>
        token.startsWith(COUNTRY_TOKEN_PREFIX) &&
        token.length > COUNTRY_TOKEN_PREFIX.length,
    );
}
