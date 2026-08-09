/**
 * #1196 【仕様】`SearchParams.address` / `LocationDetailsResponse.address` の正規形式を扱うユーティリティ。
 *
 * この `address` は**画面表示用の文字列ではない**（表示は `locationQuery` が担当する）。
 * 料理カテゴリ推薦 API (`GET /v1/dish-categories/recommendations`) が地域ゲートに使う
 * **機械可読なトークン列**であり、次の形式でなければならない:
 *
 *   "country:JP, administrative_area_level_1:Osaka, locality:Osaka"
 *
 * サーバは `api/src/v1/dish-categories/dish-categories.service.ts` の `normalizeInput` で
 * カンマ分割し、各トークンへ `region:` を前置して `dish_category_features(feature_type='gate')`
 * の `feature_key` と照合する。ホワイトリストには `region:country:JP` が入っているので、
 * `country:JP` さえ含まれていれば日本の住所は必ず候補にヒットする。
 *
 * 逆に「大阪市」のような**市区町村名単体**を送ると `region:大阪市` になり、どのゲートにも当たらず
 * 候補0件 → Claude フォールバックへ落ちる（#1196 の本番障害はこれ）。
 */

const COUNTRY_TOKEN_PREFIX = "country:";

/** expo-location の `reverseGeocodeAsync` が返す住所のうち、ここで使う項目だけ */
export type GeocodedAddressLike = {
	/** ISO 3166-1 alpha-2 の国コード（例: "JP"） */
	isoCountryCode?: string | null;
	/** 都道府県・州（例: "大阪府"） */
	region?: string | null;
	/** 市区町村（例: "大阪市"） */
	city?: string | null;
	/** 郡・区など city が取れないときの代替（例: "北区"） */
	subregion?: string | null;
};

/**
 * #1196 【仕様】address が推薦 API の期待する正規形式かどうかを判定する。
 *
 * 判定基準はサーバ側 (`api/src/core/utils/address-format.ts`) と揃えてある:
 * カンマ区切りトークンのいずれかが `country:<値>` であること。
 * 国コードさえ含まれていれば地域ゲートには必ずヒットするため、これを最小要件とする。
 */
export function isCanonicalAddress(address: string | null | undefined): boolean {
	if (!address) return false;
	return address
		.split(",")
		.map((token) => token.trim())
		.some((token) => token.startsWith(COUNTRY_TOKEN_PREFIX) && token.length > COUNTRY_TOKEN_PREFIX.length);
}

/**
 * #1196 【修正】expo-location の逆ジオコーディング結果から正規形式の address を組み立てる。
 *
 * バックエンドの逆ジオコーディング (`/v1/locations/reverse-geocoding`) が失敗したときの
 * フォールバック経路で使う。以前はここで `r.city`（= "大阪市"）をそのまま address にしていたため、
 * 地域ゲートに当たらず Claude フォールバックが常時発火していた。
 *
 * サーバの `buildAddressFromComponents` と同じ「country → administrative_area_level_1 → locality」の
 * 並びで組み立てる。値の言語（"大阪府" か "Osaka" か）は端末ロケール依存だが、ゲートの照合に使うのは
 * `country:` トークンだけなので影響しない。
 *
 * @returns 国コードが取れない場合は `null`（= 正規形式を作れない）。呼び出し側で degraded 扱いすること。
 */
export function buildAddressFromGeocodedAddress(geocoded: GeocodedAddressLike | null | undefined): string | null {
	const countryCode = geocoded?.isoCountryCode?.trim();
	// #1196 【設計】国コードが無いと地域ゲートに当たらない = 正規形式として成立しない。
	// ここで無理に他のトークンだけを並べても障害の再発にしかならないため null を返す。
	if (!countryCode) return null;

	const tokens = [`${COUNTRY_TOKEN_PREFIX}${countryCode}`];

	const region = geocoded?.region?.trim();
	if (region) tokens.push(`administrative_area_level_1:${region}`);

	// #1196 【設計】city が取れない地域のために subregion をフォールバックに使う
	// （サーバ側が locality 欠損時に administrative_area_level_3.. を使うのと同じ意図）。
	const locality = geocoded?.city?.trim() || geocoded?.subregion?.trim();
	if (locality) tokens.push(`locality:${locality}`);

	return tokens.join(", ");
}
