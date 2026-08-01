import { element, expect, launchAppWithSession, waitUntilGone, waitUntilVisible } from "../../fixtures/e2e";
import { SearchScreen } from "../../screens/SearchScreen";

/**
 * 📍 場所オートコンプリートのテスト（実 API / Tier 2）
 *
 * 目的: 「ネイティブアプリ → Supabase 匿名 JWT → NestJS API → Google Places」というフル E2E 経路が
 *       疎通していることを保証する、最重要のスモーク的機能テスト。
 *       （e2e-web の tests/search/location-autocomplete.spec.ts に対応）
 * 前提: api-development が稼働していること。Web と違い CORS には依存しない（ネイティブに同一生成元制約が無いため）。
 *
 * ## e2e-web から落とした検証（#1031 §1-1）
 * - 「mousedown を 250ms 保持するスロークリック」は **C（対象外）**。
 *   Web の mousedown/blur 競合バグの回帰専用テストであり、
 *   タッチイベント（onPressIn/onPressOut）には対応概念が無い
 * - 入力欄の**値**のアサーション（`toHaveValue("")` 等）は行わない。
 *   Detox の `toHaveText`/`toHaveValue` は TextInput に対する挙動がプラットフォームで揺れるため、
 *   「クリアボタンが消える（= 入力が空になった）」という等価で安定した観測点に置き換えている
 */
describe("場所オートコンプリート（実 API）", () => {
	const search = new SearchScreen();

	beforeAll(async () => {
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();
	});

	// ─ テストケース: 地名を入力するとサジェストが表示され、クリアでリセットされる ─
	// 手順:
	//   1. 場所入力欄をタップしてフォーカスし、「渋谷」を入力する
	//      （LocationAutocomplete は「入力あり && フォーカス中」で候補を出すため、フォーカスが必須）
	//   2. 300ms のデバウンス → API 応答を経て、サジェストリストと先頭項目が表示されることを検証
	//   3. クリアボタン（search-location-autocomplete-clear）を押す
	//   4. サジェストリストが消え、クリアボタン自体も消える（= 入力が空になった）ことを検証
	it("地名を入力するとサジェストが表示され、クリアでリセットされる", async () => {
		await search.clearLocationIfPresent();

		await search.typeLocation("渋谷");

		await waitUntilVisible(search.locationSuggestions);
		await waitUntilVisible(search.locationSuggestion(0));

		await element(search.locationClearButton).tap();

		await waitUntilGone(search.locationSuggestions);
		// クリアボタンは「入力が 1 文字以上ある」ときだけ描画される。消えていれば入力欄は空
		await expect(element(search.locationClearButton)).not.toExist();
	});
});
