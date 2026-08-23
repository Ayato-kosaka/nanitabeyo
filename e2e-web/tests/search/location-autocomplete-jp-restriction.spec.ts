import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";

/**
 * 🇯🇵 場所オートコンプリートの「日本国内制限」テスト(実 API)
 *
 * 対象 Issue: #1502 / SEA-01「Autocomplete 候補を日本国内に制限する」
 * 対応する e2e-mobile: tests/search/location-autocomplete-jp-restriction.test.ts
 *
 * 背景: `autocompleteLocations` には地理的な制限が無く、国外の地点も選べてしまっていた。
 * 一方でレコメンド側(api/src/v1/dish-categories/dish-categories.service.ts)のゲートは
 * 国単位のホワイトリスト(日本向けは `region:country:JP` のみ)なので、国外の地点を選ぶと
 * **地点は確定するのに推薦が 0 件になる行き止まり**が発生していた。
 * 修正は Places API (New) Autocomplete のリクエストへ `includedRegionCodes: ['jp']` を付け、
 * レスポンス自体を日本限定にしたもの(api/src/v1/locations/locations.service.ts)。
 *
 * ## この spec が守るもの(API 統合テストとの役割分担)
 * 送信ボディに `includedRegionCodes: ['jp']` が載ること自体は、観測点が API と Google の間に
 * しか無いため `api/src/v1/locations/locations.autocomplete-jp-restriction.integration.spec.ts`
 * が固定している。ここで守るのはその 1 段上、
 *
 *   **「ユーザーが国外の地名を打っても、画面に国外の候補が出てこない」**
 *
 * という結果である。実装の形(リクエスト制限か、後段フィルタか)が変わっても、
 * 結果が壊れたときにだけ赤くなるのがこの spec の役割。
 *
 * ## 「日本国内であること」の観測点
 * ja-JP ロケールでは Places の `secondaryText` が国名から始まる(例: 「日本、東京都渋谷区」)。
 * 実 API の候補は地名も件数も事前に確定できないため、個々の地点名ではなく
 * **候補行の文言に「日本」が含まれること**を全件について見る。
 * 制限が外れると "Paris, France" のような行が混ざるため、この観測点で赤くなる。
 *
 * 前提: 実 API(v1/locations/autocomplete)を叩く。CORS 前提は
 * location-autocomplete.spec.ts と同じ(e2e-web/README.md 参照)。
 */
test.describe("場所オートコンプリートの日本国内制限(実 API)", () => {
	/** v1/locations/autocomplete のレスポンス(封筒 `{ success, data }` の中身) */
	type AutocompletePlace = {
		place_id: string;
		text: string;
		mainText: string;
		secondaryText: string;
		types: string[];
	};

	/**
	 * 場所を 1 度だけ入力し、その入力に対する autocomplete のレスポンス本体を返す。
	 *
	 * 入力前に `waitForResponse` を仕掛けるのは、`LocationAutocomplete` が 300ms の
	 * デバウンスを挟んでから API を叩くため(仕掛けるのが後だと取りこぼす)。
	 */
	const typeAndCaptureSuggestions = async (
		searchPage: SearchPage,
		query: string,
	): Promise<AutocompletePlace[]> => {
		const responsePromise = searchPage.page.waitForResponse(
			(response) => response.url().includes("v1/locations/autocomplete") && response.ok(),
		);
		await searchPage.typeLocation(query);
		const body = (await (await responsePromise).json()) as {
			success: boolean;
			data: AutocompletePlace[];
		};
		expect(body.success).toBe(true);
		return body.data;
	};

	// ─ テストケース: 国外の地名を入力しても国外の候補が出ない ─
	// 手順:
	//   1. appPage で起動(匿名セッション確立済み = API を叩ける状態)
	//   2. 場所入力欄に「Paris」と入力する(デバウンス 300ms のあと API が走る)
	//   3. autocomplete のレスポンスを捕まえ、返ってきた候補が **1 件も国外でない** ことを検証
	//   4. 画面に出ている候補行にも国外の地点が無いことを検証
	//
	// 【0 件になり得ることについて】
	// `includedRegionCodes: ['jp']` は入力語ではなく **リクエスト自体**への制限なので、
	// 国外地名では 0 件になることも、日本国内の「Paris」を含む店舗が返ることもある。
	// どちらでも「国外の候補は出ない」は成立するため、件数はアサートしない
	// (実 API の返す件数を固定するとテストが Google の都合で壊れる)。
	test("国外の地名を入力しても国外の候補は表示されない", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);

		const places = await typeAndCaptureSuggestions(searchPage, "Paris");

		for (const place of places) {
			expect(
				place.secondaryText,
				`国外の候補が返っています: ${place.mainText} / ${place.secondaryText}`,
			).toContain("日本");
		}

		// 候補が返ったときだけ、画面にもそれが反映されていることを見る
		// (0 件のときは「見つかりませんでした」の表示になり、候補行は描画されない)
		if (places.length > 0) {
			await expect(searchPage.locationSuggestions).toBeVisible();
			await expect(searchPage.locationSuggestion(0)).toContainText("日本");
		}
	});

	// ─ テストケース: 国内の地名は従来どおり候補が出る(制限の巻き添えが無い) ─
	// 手順:
	//   1. 場所入力欄に「渋谷」と入力する
	//   2. 候補が 1 件以上返り、すべて日本国内であることを検証
	//   3. 先頭候補が画面に見えていることを検証(location-autocomplete.spec.ts と同じ観測点)
	//
	// 制限の入れ方を間違えて(例: 地域コードを 'JP' や 'jpn' と書いて Google が
	// INVALID_ARGUMENT を返す)全滅する事故を、ここで検知する。
	test("国内の地名では候補が 1 件以上返り、すべて日本国内である", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);

		const places = await typeAndCaptureSuggestions(searchPage, "渋谷");

		expect(places.length).toBeGreaterThan(0);
		for (const place of places) {
			expect(
				place.secondaryText,
				`国外の候補が返っています: ${place.mainText} / ${place.secondaryText}`,
			).toContain("日本");
		}

		await expect(searchPage.locationSuggestions).toBeVisible();
		await expect(searchPage.locationSuggestion(0)).toBeVisible();
	});
});
