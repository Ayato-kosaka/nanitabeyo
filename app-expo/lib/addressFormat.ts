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
 * 逆に「大阪市」のような**市区町村名単体**を送ると `region:大阪市` になり、日本向けのゲートには
 * 一切当たらなくなる（残るのは `region:scope:global` を持つカテゴリだけ）。その結果、候補0件か
 * スレート（6枚）不成立で Claude フォールバックへ落ちる（#1196 の本番障害はこれ）。
 */

const COUNTRY_TOKEN_PREFIX = "country:";

/**
 * #1196 【設計】国コードは ISO 3166-1 alpha-2 の**大文字 2 文字**であること。
 *
 * サーバ側の照合は `dcf.feature_key = ANY(p.region_tokens)`（Postgres の `=` = 大小文字区別あり）で、
 * ホワイトリストに入っている key は `region:country:JP` である。つまり `country:jp` を送ると
 * `region:country:jp` ≠ `region:country:JP` となり、**ゲートに当たらない**。
 * 「country トークンさえあればゲートに必ずヒットする」という前提が成り立つのは大文字のときだけなので、
 * 形式判定でもここまで見る。
 */
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

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
 * #1196 【仕様】address から ISO 3166-1 alpha-2 の国コードを取り出す。正規形式でなければ `null`。
 *
 * 「どの国の地点か」は**この関数だけが答えを持つ**。検索画面の海外ガード（`country:JP` 以外は
 * 推薦 API を呼ばずにダイアログで案内する）も、形式チェック（`isCanonicalAddress`）も、
 * 判定基準がズレると片方だけ通り抜ける穴になるため、ここへ一本化している。
 *
 * 判定はクライアント側だけで行う。サーバは address を検証しない
 * （API は仕様どおりに動いており、形式を守るのはクライアントの責務 — #1196）。
 * 抽出基準: カンマ区切りトークンのいずれかが `country:<大文字 2 文字>` であること。
 * 国コードさえ含まれていれば地域ゲートには必ずヒットするため、これを最小要件とする。
 * ただしヒットが保証されるのは大文字のときだけなので、大小文字まで見る（→ `COUNTRY_CODE_PATTERN`）。
 *
 * #1196 【設計】alpha-2 だけを通すのは fail-closed であることを承知のうえで選んでいる。
 *
 * サーバの `buildAddressFromComponents` は `(c.shortText || c.longText)` の順で値を採るため、
 * Google Places が country の `shortText` を欠いた場合は理論上 `country:Japan` を組み立てうる
 * （`api/src/v1/locations/locations.service.spec.ts` にそのフォールバックのテストがある）。
 * その値はここで `null` になり、検索画面では「壊れた address」として弾かれる。
 *
 * それでも alpha-2 に絞るのは:
 *
 * - `region:country:Japan` はゲートのホワイトリスト（`region:country:JP`）に**当たらない**。
 *   通したところで候補 0 件 → Claude フォールバックへ落ちるだけで、課金だけが発生する。
 *   つまり「通す」も「弾く」も検索は成立せず、弾くほうが安い。
 * - 実測で発生していない。`search_started` の address を 2026-08-08〜08-16 で集計したところ、
 *   `country:<alpha-2 以外>` は **0 件 / 7,632 件**（`country:AA` 3,782 / broken 3,850）。
 *   country の `shortText` が欠けた例は本番に 1 件も無い。
 * - 万一出た場合は `search_blocked_malformed_address` が **error** で記録され、#1196 の
 *   トリアージが翌日には Issue を立てる。気づけないまま放置される形にはならない。
 *
 * したがって、もしこのログが立ったら**直す場所はここではなくサーバの producer 側**
 * （country を alpha-2 に正規化する）である。ここに国名テーブルを持ち込まないこと。
 */
export function getAddressCountryCode(address: string | null | undefined): string | null {
	if (!address) return null;
	for (const rawToken of address.split(",")) {
		const token = rawToken.trim();
		if (!token.startsWith(COUNTRY_TOKEN_PREFIX)) continue;
		const countryCode = token.slice(COUNTRY_TOKEN_PREFIX.length);
		// #1196 【設計】小文字・3文字以上は「正規形式でない」として弾く（ゲートに当たらないため）。
		// ここで大小文字を素通しすると、ゲート不成立が検知ログなしで起きる。
		if (COUNTRY_CODE_PATTERN.test(countryCode)) return countryCode;
	}
	return null;
}

/**
 * #1196 【仕様】address が推薦 API の期待する正規形式かどうかを判定する。
 *
 * 「国コードを取り出せること」と等価。判定基準は `getAddressCountryCode` のコメントを参照。
 */
export function isCanonicalAddress(address: string | null | undefined): boolean {
	return getAddressCountryCode(address) !== null;
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
	// #1196 【設計】国コードは必ず大文字化する。
	// expo-location の `isoCountryCode` は ISO 3166-1 alpha-2 だが、大文字で返ることは
	// 端末/OS 実装に依存し保証されていない。一方サーバ側のゲート照合は
	// `dcf.feature_key = ANY(p.region_tokens)`(= Postgres の完全一致、大小文字区別あり)なので、
	// `region:country:jp` はホワイトリストの `region:country:JP` に当たらない。
	// ここで大文字化しないと #1196 とまったく同じ失敗（ゲート不成立 → Claude フォールバック）が、
	// しかも `isCanonicalAddress` が前置詞しか見ていなければ検知ログすら出ない状態で再発する。
	const countryCode = geocoded?.isoCountryCode?.trim().toUpperCase();
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
