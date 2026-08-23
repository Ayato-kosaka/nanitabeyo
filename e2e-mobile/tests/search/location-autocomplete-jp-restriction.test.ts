import { strict as assert } from "node:assert";

import { existsNow, launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { SearchScreen } from "../../screens/SearchScreen";

/**
 * 🇯🇵 場所オートコンプリートの「日本国内制限」テスト（実 API / Tier 2）
 *
 * 対象 Issue: #1502 / SEA-01「Autocomplete 候補を日本国内に制限する」
 * 対応する e2e-web: tests/search/location-autocomplete-jp-restriction.spec.ts
 *
 * 背景: `autocompleteLocations` には地理的な制限が無く、国外の地点も選べてしまっていた。
 * 一方でレコメンド側（api/src/v1/dish-categories/dish-categories.service.ts）のゲートは
 * 国単位のホワイトリスト（日本向けは `region:country:JP` のみ）なので、国外の地点を選ぶと
 * **地点は確定するのに推薦が 0 件になる行き止まり**が発生していた。
 * 修正は Places API (New) Autocomplete のリクエストへ `includedRegionCodes: ['jp']` を付け、
 * レスポンス自体を日本限定にしたもの（api/src/v1/locations/locations.service.ts）。
 *
 * ## この spec が守るもの（API 統合テストとの役割分担）
 * 送信ボディに `includedRegionCodes: ['jp']` が載ること自体は、観測点が API と Google の間に
 * しか無いため `api/src/v1/locations/locations.autocomplete-jp-restriction.integration.spec.ts`
 * が固定している。ここで守るのはその 1 段上、
 *
 *   **「ユーザーが国外の地名を打っても、画面に国外の候補が出てこない」**
 *
 * という結果である。
 *
 * ## e2e-web から落とした検証（同 spec との差分）
 * - **レスポンス本文の全件検査は C（対象外）**。Playwright の `waitForResponse` に相当する
 *   HTTP 傍受の手段が Detox には無い。ネイティブ側で見られるのは **画面に出た候補行**だけなので、
 *   描画されている候補を先頭から順にラベルで検査する形へ置き換えている。
 * - 件数はアサートしない。`includedRegionCodes` は入力語ではなく **リクエスト自体**への制限で、
 *   国外地名では 0 件になることも、日本国内の「Paris」を含む店舗が返ることもある。
 *   どちらでも「国外の候補は出ない」は成立する（実 API の件数を固定すると Google の都合で壊れる）。
 *
 * ## 「日本国内であること」の観測点
 * ja-JP ロケールでは Places の候補文言が国名を含む（例: 「渋谷駅、日本、東京都渋谷区」）。
 * 候補行の accessibilityLabel にその完全な表記が入っている（`SearchScreen.locationSuggestionLabel`）ため、
 * **ラベルに「日本」が含まれること**を、描画されている候補すべてについて見る。
 * 制限が外れると "Paris, France" のような行が混ざり、この観測点で赤くなる。
 */
describe("場所オートコンプリートの日本国内制限（実 API / #1502）", () => {
	const search = new SearchScreen();

	/** 候補行の testID は 0 始まりの連番。Google の返す件数は事前に確定できないため上限だけ決める */
	const MAX_SUGGESTIONS_TO_CHECK = 10;

	beforeAll(async () => {
		// #1030 【設計】3-1: 匿名サインインのクォータを消費しないよう、確立済みセッションを注入して起動する
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();
	});

	/**
	 * 画面に出ている候補行のラベルを先頭から順に集める。
	 *
	 * 候補が 0 件のとき（= パネル自体が描画されないとき）は空配列を返す。
	 * 「見つかりませんでした」の表示との区別はここでは行わない（この spec が見たいのは
	 * 「国外の候補が出ていないこと」であって件数ではないため）。
	 */
	const collectSuggestionLabels = async (): Promise<string[]> => {
		const labels: string[] = [];
		for (let index = 0; index < MAX_SUGGESTIONS_TO_CHECK; index += 1) {
			// 1 件も無い場合に長く待たされないよう、待ち時間は短めに固定する
			if (!(await existsNow(search.locationSuggestion(index), 2_000))) break;
			labels.push(await search.locationSuggestionLabel(index));
		}
		return labels;
	};

	/** 集めたラベルがすべて日本国内を指していることを検証する */
	const assertAllInJapan = (labels: string[]): void => {
		for (const label of labels) {
			assert.ok(
				label.includes("日本"),
				`国外の候補が表示されています（#1502 の再発を疑うこと）: ${label}`,
			);
		}
	};

	// ─ テストケース: 国外の地名を入力しても国外の候補が出ない ─
	// 手順:
	//   1. 自動取得された現在地が入っている可能性があるため、明示的にクリアする
	//   2. 場所入力欄をタップしてフォーカスし、「Paris」を入力する
	//      （LocationAutocomplete は「入力あり && フォーカス中」で候補を出すため、フォーカスが必須）
	//   3. 300ms のデバウンス → API 応答を経て描画された候補行のラベルを集める
	//   4. 集めたラベルに国外の地点が 1 件も無いことを検証（0 件でも成立する）
	it("国外の地名を入力しても国外の候補は表示されない", async () => {
		await search.clearLocationIfPresent();

		await search.typeLocation("Paris");

		assertAllInJapan(await collectSuggestionLabels());
	});

	// ─ テストケース: 国内の地名は従来どおり候補が出る（制限の巻き添えが無い） ─
	// 手順:
	//   1. 入力済みの場所をクリアする
	//   2. 「渋谷」を入力し、サジェストリストと先頭項目の表示を待つ
	//      （location-autocomplete.test.ts と同じ観測点）
	//   3. 描画されている候補がすべて日本国内であることを検証
	//
	// 制限の入れ方を間違えて（例: 地域コードを 'JP' や 'jpn' と書いて Google が
	// INVALID_ARGUMENT を返す）候補が全滅する事故を、ここで検知する。
	it("国内の地名では候補が表示され、すべて日本国内である", async () => {
		await search.clearLocationIfPresent();

		await search.typeLocation("渋谷");
		await waitUntilVisible(search.locationSuggestions);
		await waitUntilVisible(search.locationSuggestion(0));

		const labels = await collectSuggestionLabels();
		assert.ok(labels.length > 0, "国内の地名なのに候補が 1 件も表示されていません");
		assertAllInJapan(labels);
	});
});
