import type { Page } from "@playwright/test";
import type {
	AutocompleteLocationsResponse,
	LocationDetailsResponse,
	LocationReverseGeocodingResponse,
} from "@shared/api/v1/res";

/**
 * 📍 場所検索（Google Places 由来の 3 本）を固定レスポンスへ差し替えるユーティリティ。
 *
 * ## なぜ要るのか（#1629 オーナー確定）
 *
 * オーナー確定「Places の日次上限は **上げない**。上げないままテストできるようにして」。
 *
 * アプリの場所検索はすべて **自前のバックエンド経由**である。
 *
 * | 画面の操作 | 叩く先 |
 * | --- | --- |
 * | 検索窓に打つ | `GET /v1/locations/autocomplete` |
 * | 候補を選ぶ | `GET /v1/locations/details` |
 * | 現在地から地名を出す | `GET /v1/locations/reverse-geocoding` |
 *
 * この 3 本はバックエンドの中で Google Places を呼ぶので、**e2e が 1 回走るたびに
 * 日次枠を削る**。実際、枠切れで «検索が 500 になる» 失敗が過去に何度も出ており
 * （`review-post` の申し送り）、#1629 では Detox の検証が 1 回これで潰れた。
 *
 * ここで差し替えれば **枠を 1 件も使わずに** 画面と遷移を検証できる。
 *
 * ## 差し替えて «失うもの» と、その担保
 *
 * 失うのは «Places の応答をアプリが正しく解釈できるか» の検証である。これは
 * **バックエンドの責務**（`api` の locations コントローラ）であって、ブラウザを
 * 動かす e2e が毎回実物を叩いて確かめるものではない。
 *
 * ⚠️ **実物を叩くことが検証の主題である spec では使わないこと。** その場合も
 *    枠を使う本数は最小限にすること（Places の枠はテスト専用ではない）。
 */

/** 候補として返す地名。`mainText` は画面にそのまま出るのでアサーションから参照できる */
export const MOCK_LOCATION_SUGGESTIONS = [
	{ place_id: "e2e-place-shibuya", mainText: "渋谷", secondaryText: "東京都" },
	{ place_id: "e2e-place-shinjuku", mainText: "新宿", secondaryText: "東京都" },
	{ place_id: "e2e-place-ginza", mainText: "銀座", secondaryText: "東京都" },
] as const;

/** 候補を選んだときに返る座標（東京駅）。地図の中心の検証から参照できる */
export const MOCK_LOCATION_COORD = { latitude: 35.681236, longitude: 139.767125 };

const VIEWPORT = {
	low: { latitude: MOCK_LOCATION_COORD.latitude - 0.01, longitude: MOCK_LOCATION_COORD.longitude - 0.01 },
	high: { latitude: MOCK_LOCATION_COORD.latitude + 0.01, longitude: MOCK_LOCATION_COORD.longitude + 0.01 },
};

const AUTOCOMPLETE_URL = /\/v1\/locations\/autocomplete(\?.*)?$/;
const DETAILS_URL = /\/v1\/locations\/details(\?.*)?$/;
const REVERSE_GEOCODING_URL = /\/v1\/locations\/reverse-geocoding(\?.*)?$/;

function buildSuggestions(): AutocompleteLocationsResponse {
	return MOCK_LOCATION_SUGGESTIONS.map((s) => ({
		place_id: s.place_id,
		text: `${s.mainText} ${s.secondaryText}`,
		mainText: s.mainText,
		secondaryText: s.secondaryText,
		// «飲食店ではない場所» として扱わせる。飲食店カテゴリだと画面によっては
		// 店舗の作成（dev DB への書き込み）へ分岐するため（select-restaurant.tsx）
		types: ["locality", "political"],
	}));
}

function buildDetails(): LocationDetailsResponse {
	return {
		location: MOCK_LOCATION_COORD,
		viewport: VIEWPORT,
		address: "country:JP, locality:Tokyo",
		localLanguageCode: "ja",
	};
}

function buildReverseGeocoding(): LocationReverseGeocodingResponse {
	return {
		location: MOCK_LOCATION_COORD,
		viewport: VIEWPORT,
		address: "country:JP, locality:Tokyo",
		localLanguageCode: "ja",
	};
}

/**
 * 場所検索の 3 本を固定レスポンスへ差し替える。
 *
 * `page.goto()` より前に呼ぶこと（route の登録前に飛んだリクエストは素通しになる）。
 *
 * ⚠️ **`BaseResponse` の封筒 `{ success, data }` を外さないこと。** `useAPICall` は
 *    `data` だけを取り出すので、素のレスポンスを返すと undefined が渡って画面が
 *    エラー表示になる（`utils/restaurantDetail.ts` と同じ注意）。
 */
export async function mockLocationSearch(page: Page): Promise<void> {
	const fulfill = (data: unknown) => ({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({ success: true, data }),
	});

	await page.route(AUTOCOMPLETE_URL, (route) => route.fulfill(fulfill(buildSuggestions())));
	await page.route(DETAILS_URL, (route) => route.fulfill(fulfill(buildDetails())));
	await page.route(REVERSE_GEOCODING_URL, (route) => route.fulfill(fulfill(buildReverseGeocoding())));
}
