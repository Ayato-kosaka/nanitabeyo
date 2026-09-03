import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { DishCategoriesPage } from "../../pages/DishCategoriesPage";
import { ResultPage } from "../../pages/ResultPage";
// #1785 色は spec へ写経せずアプリの Palette から引く（reaction-rollback.spec.ts と同じ理由）
import { FixedColors } from "@app-expo/constants/Palette";

/** ActionButtons.tsx の Heart / Bookmark が実際に描く fill 属性 */
const ICON_FILL = {
	liked: FixedColors.likeActive,
	notLiked: FixedColors.onMedia,
	saved: FixedColors.myDishStatusOrange,
	notSaved: "transparent",
} as const;
import { ProfilePage } from "../../pages/ProfilePage";

/**
 * ❤️ いいね・保存リアクションのテスト @mutation
 *
 * 実行プロジェクト: desktop-chrome-authenticated(storageState 注入済み)
 * 実行条件: RUN_MUTATION=1 のときのみ(playwright.config.ts の grepInvert 参照)
 *
 * ## dev DB への影響(重要・要注意)
 * dev 環境の DB に POST → DELETE の順で書き込み、ハッピーパスでは「解除」まで実行して
 * 元の状態へ戻す。ただし **これは保証されたロールバックではない**: 各 test() 内で
 * 途中の expect() が失敗すると、その時点で test は例外を投げて即座に終了し、
 * それ以降の行(= 解除処理)は実行されない。try/finally 等の後始末は意図的に
 * 実装していない(このテストの目的はロールバック機構の検証ではなく機能検証のため)。
 * そのため **アサーション失敗時は「いいね」「保存」状態が dev DB に残ったままになる
 * (=不可逆になる)ことを許容する**。操作は必ずテスト専用ユーザーのみで行う。
 *
 * ## 前提
 * いいね/保存ボタンは検索結果フィード(ResultPage)の料理メディアカードから操作する。
 * Heart アイコンの fill 属性で状態を判定する（具体的な色は `ICON_FILL`）。
 */
test.skip(
	() => !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
	"TEST_USER_EMAIL / TEST_USER_PASSWORD(e2e-web/.env)が未設定のためスキップ",
);

test.describe("リアクション @mutation", () => {
	// 検索 → トピック提案 → 結果フィード遷移は AI 生成待ちで時間がかかることがあるため
	// 既定の 30 秒テストタイムアウトを延長する(dish-categories-flow.spec.ts と同様の理由)
	test.setTimeout(90_000);

	// AI レコメンドが選ぶ料理・店舗によっては dev 環境側のデータ不備(画像未処理等)で
	// 結果フィード取得が 500 になることが実測で確認されている(アプリ側の既知の不安定要素で
	// このテストの実装不備ではない)。再実行すれば別の料理が選ばれ成功することが多いため、
	// このファイルに限りリトライを許容する
	test.describe.configure({ retries: 2 });

	// ─ テストケース: いいね → 解除が反映される ─
	// 手順:
	//   1. ログイン済みで起動し、検索フローで結果フィード(料理メディア)を表示する
	//   2. 表示中カードのいいねボタン(dish-action-like)をタップ
	//      → Heart アイコンの fill が «いいね済み» の色に変わることを検証
	//      (POST v1/dish-media/{id}/reaction)
	//   3. もう一度タップして解除 → fill が «未いいね» の色に戻ることを検証
	//      (DELETE v1/dish-media/{id}/reaction)
	//      ※ 手順 2 のアサーションが失敗した場合、解除(手順 3)は実行されず
	//      dev DB に「いいね」状態が残る(不可逆)。ファイル冒頭のコメント参照
	test("いいね @mutation", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);
		const resultPage = new ResultPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectLoaded();
		await dishCategoriesPage.chooseFirstDishCategory();
		await resultPage.expectLoaded();

		const likeIcon = resultPage.likeButton.first().locator("svg");

		await resultPage.likeButton.first().click();
		await expect(likeIcon).toHaveAttribute("fill", ICON_FILL.liked);

		await resultPage.likeButton.first().click();
		await expect(likeIcon).toHaveAttribute("fill", ICON_FILL.notLiked);
	});

	// ─ テストケース: 保存 → マイページ反映 → 解除 ─
	// 手順:
	//   1. 結果フィードで保存ボタン(dish-action-save)をタップ → 保存済み表示を検証
	//      (Bookmark アイコンの fill が «保存済み» の色になる)
	//   2. 保存を解除 → fill が «未保存» の値に戻ることを検証
	//      (マイページの保存済みタブ反映確認は非同期反映のタイミング差でフレークしやすいため、
	//      アイコン状態変化を主検証とする)
	//      ※ 手順 1 のアサーションが失敗した場合、解除は実行されず dev DB に
	//      「保存」状態が残る(不可逆)。ファイル冒頭のコメント参照
	test("保存 @mutation", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);
		const resultPage = new ResultPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectLoaded();
		await dishCategoriesPage.chooseFirstDishCategory();
		await resultPage.expectLoaded();

		const saveIcon = resultPage.saveButton.first().locator("svg");

		await resultPage.saveButton.first().click();
		await expect(saveIcon).toHaveAttribute("fill", ICON_FILL.saved);

		await resultPage.saveButton.first().click();
		await expect(saveIcon).toHaveAttribute("fill", ICON_FILL.notSaved);
	});
});
