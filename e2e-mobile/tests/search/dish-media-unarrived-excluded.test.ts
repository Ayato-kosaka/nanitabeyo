import { by, describeJapaneseLocale, element, expect, launchAppWithSession, visibleNow } from "../../fixtures/e2e";
import { ResultScreen } from "../../screens/ResultScreen";
import { SearchScreen } from "../../screens/SearchScreen";
import { DishCategoriesScreen } from "../../screens/DishCategoriesScreen";

/**
 * 🚫 実体未着の料理メディアが結果フィードに出ない（#1257）
 *（e2e-web の tests/review/dish-media-unarrived-excluded.spec.ts に対応）
 *
 * ## 何を守るテストか
 * #1257 は「GCS に原本が届いていない dish_media（media_processing_status !== 'completed'）が
 * 検索候補に選ばれてしまう」不具合。API 側の候補集合クエリ 2 本
 *（`findDishMediaIds` / `findDishMediaByRestaurant`）を completed だけに絞ることで直した。
 *
 * ## Web との観測点の違い
 * e2e-web は実 API の **応答 JSON** を `page.on("response")` で覗き、
 * 返ってきた全件が completed であることを直接見る。Detox にはネットワーク応答を覗く API も
 * API モックの仕組みも無いため、ネイティブ側は **画面に出る症状** で見る。
 *
 * `app-expo/features/dishMedia/components/DishMediaContent.tsx` は
 * media_processing_status に応じて 2 種類のオーバーレイをカードへ重ねる:
 *
 * - `processing` … 「メディアを処理中...」＋スピナー
 * - `failed`     … 「このメディアは現在ご利用いただけません。」
 *
 * この 2 つは «未着の行がフィードに紛れ込んだ» ときにだけ描かれる。#1257 の修正後は
 * 候補集合に入らないので、**結果フィードのどこにも出ないこと** が不変条件になる。
 * （オーバーレイの実装自体は投稿直後の自分のメディアを見る経路で今も必要なので消していない）
 *
 * ⚠️ 文言に依存するので ja-JP 前提。`describeJapaneseLocale` で他ロケールでは skip する。
 * ⚠️ dev DB に未着行が 1 件も無ければこのテストは «素通り» する。決定論的な検証は
 *    API の統合テスト（`api/test/functional/v1/dish-media/*.e2e-spec.ts`）が持つ。
 *
 * ## dev DB への影響
 * 無し（読み取りのみ）。@mutation ではない。
 */
describeJapaneseLocale("実体未着の料理メディアは結果フィードに出ない（#1257）", () => {
	const search = new SearchScreen();
	const dishCategories = new DishCategoriesScreen();
	const result = new ResultScreen();

	/** #530 未着カードにだけ重なるオーバーレイの文言（locales/ja-JP.json の DishMediaContent） */
	const PROCESSING_TEXT = "メディアを処理中...";
	const UNAVAILABLE_TEXT = "このメディアは現在ご利用いただけません。";

	// ─ テストケース: 結果フィードに未着カードのオーバーレイが出ない ─
	// 手順:
	//   1. 匿名セッションで起動し、「渋谷」で検索する
	//   2. 先頭のお題を選び、結果フィードの表示を待つ（0 件なら検証対象が無いので終了）
	//   3. 「処理中」「利用できません」のオーバーレイがどちらも出ていないことを検証する
	//   4. 併せて、カードの操作ボタン（= カード自体が描けている証拠）が出ていることを確認する
	it("結果フィードに『処理中』『利用できません』のカードが出ない", async () => {
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();

		await search.clearLocationIfPresent();
		await search.typeLocation("渋谷");
		await search.selectLocationSuggestion(0);
		await search.submit();

		await dishCategories.expectLoaded();
		await dishCategories.chooseFirstDishCategory();

		// #1156 dev のデータ次第で 0 件になり、退避ダイアログを出してトピック画面へ戻ることがある。
		// その場合は «一覧に出るメディア» が 1 件も無いので、このテストの検証対象が存在しない
		const outcome = await result.waitForResultOrFallback();
		if (outcome === "fallback") {
			await result.dismissGoogleMapsFallback();
			await dishCategories.expectLoaded();
			return;
		}

		// カードが描けていること（オーバーレイの «無さ» だけを見ると、フィードが空でも緑になる）
		await expect(element(result.likeButton).atIndex(0)).toBeVisible();

		// ⚠️ `toBeNotVisible()` ではなく existsNow 系で見る。存在しない testID/text に対する
		// Detox の否定アサーションはプラットフォームによって例外の出方が違うため、
		// 「見えているか」を bool で取ってから通常の assert にそろえる
		const processingVisible = await visibleNow(by.text(PROCESSING_TEXT));
		const unavailableVisible = await visibleNow(by.text(UNAVAILABLE_TEXT));

		if (processingVisible || unavailableVisible) {
			throw new Error(
				`#1257 実体未着の料理メディアが結果フィードに出ている（処理中: ${processingVisible} / 利用不可: ${unavailableVisible}）`,
			);
		}
	});
});
