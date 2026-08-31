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

/**
 * 候補は **打った文字から作る**。固定の 3 件を返してはいけない。
 *
 * #1629 最初は固定 3 件で書いたが、`recent-locations` の 2 本が落ちた（run 33392524114）。
 * あの spec は «別々の地点を 6 件選ぶ» ことで «最近使った場所» の上限と並び替えを見るので、
 * どの語を打っても同じ `place_id` が返ると **履歴が 1 件から増えない**。
 *
 * 打った語ごとに違う `place_id` を返せば、実物と同じように «別の地点» として扱われる。
 */
function suggestionsFor(query: string) {
	const key = encodeURIComponent(query).replace(/%/g, "");
	return [0, 1, 2].map((i) => ({
		place_id: `e2e-place-${key}-${i}`,
		mainText: i === 0 ? query : `${query}${i}`,
		secondaryText: "東京都",
	}));
}

/** 候補を選んだときに返る座標（東京駅）。地図の中心の検証から参照できる */
export const MOCK_LOCATION_COORD = { latitude: 35.681236, longitude: 139.767125 };

const VIEWPORT = {
	low: { latitude: MOCK_LOCATION_COORD.latitude - 0.01, longitude: MOCK_LOCATION_COORD.longitude - 0.01 },
	high: { latitude: MOCK_LOCATION_COORD.latitude + 0.01, longitude: MOCK_LOCATION_COORD.longitude + 0.01 },
};

const AUTOCOMPLETE_URL = /\/v1\/locations\/autocomplete(\?.*)?$/;
const DETAILS_URL = /\/v1\/locations\/details(\?.*)?$/;
const REVERSE_GEOCODING_URL = /\/v1\/locations\/reverse-geocoding(\?.*)?$/;

function buildSuggestions(query: string): AutocompleteLocationsResponse {
	return suggestionsFor(query).map((s) => ({
		place_id: s.place_id,
		text: `${s.mainText} ${s.secondaryText}`,
		mainText: s.mainText,
		secondaryText: s.secondaryText,
		// «飲食店ではない場所» として扱わせる。飲食店カテゴリだと画面によっては
		// 店舗の作成（dev DB への書き込み）へ分岐するため（select-restaurant.tsx）
		types: ["locality", "political"],
	}));
}

function buildDetails(placeId: string): LocationDetailsResponse {
	// place_id から決まる小さなずらし幅（同じ id なら毎回同じ座標）
	const nudge = ([...placeId].reduce((a, c) => a + c.charCodeAt(0), 0) % 20) / 1000;
	const location = {
		latitude: MOCK_LOCATION_COORD.latitude + nudge,
		longitude: MOCK_LOCATION_COORD.longitude + nudge,
	};
	return {
		location,
		viewport: {
			low: { latitude: location.latitude - 0.01, longitude: location.longitude - 0.01 },
			high: { latitude: location.latitude + 0.01, longitude: location.longitude + 0.01 },
		},
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

	await page.route(AUTOCOMPLETE_URL, (route) => {
		// 打った語は `q` で来る（`hooks/useLocationSearch.ts`）
		const query = new URL(route.request().url()).searchParams.get("q") ?? "";
		return route.fulfill(fulfill(buildSuggestions(query)));
	});
	/*
	選んだ候補ごとに **座標を少しずらす**。同じ座標を返すと «別の地点を選んだ» ことに
	ならず、履歴の並び替えや地図の移動が観測できない。`place_id` から決めるので毎回同じ値になる。
	*/
	await page.route(DETAILS_URL, (route) => {
		const placeId = new URL(route.request().url()).searchParams.get("placeId") ?? "";
		return route.fulfill(fulfill(buildDetails(placeId)));
	});
	await page.route(REVERSE_GEOCODING_URL, (route) => route.fulfill(fulfill(buildReverseGeocoding())));
}
