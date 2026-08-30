import * as path from "node:path";
import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { MyDishesPage } from "../../pages/MyDishesPage";
import { countRequests } from "../../utils/network";
import { clickRapid } from "../../utils/rapid-click";

/**
 * 👆👆 レビュー投稿ボタンの連打耐性テスト @mutation(#1090 / 親 #1082)
 *
 * 目的: 投稿ボタンを待機なしで連打しても、**同じレビューが 2 件登録されない**ことを保証する。
 *
 * ## 何を守っているか(#1090)
 * `ReviewForm.handleSubmit` のガードは元々 `isProcessing`(useState)だけだった。
 * React が再レンダリングをコミットする前に 2 発目の押下が処理されると両方が
 * `isProcessing === false` を読んで通過しうるため、`v1/dishes` の POST と
 * メディアアップロードが二重に走り、同じレビューが 2 件登録される。
 * #1090 で `isSubmittingRef`(useRef)による同期ガードを追加した
 * (`search/index.tsx` の `isSearchingRef` / `search/dish-categories.tsx` の `isSelectingDishCategoryRef` と同じ方式)。
 *
 * ## 観測点(#1084 設計 §3-1 / #1086 の教訓)
 * **POST のリクエスト件数**を数える。「履歴段数の増分」は二重 push を検知できないことが
 * 実測済みで、この画面には積み上がる画面も無いため、回数を数えられる観測点はこれしかない。
 *
 * - **主観測点: POST `v1/dishes` の件数**。`handleSubmit` はガードを抜けた直後に
 *   これを呼ぶため、2 発目が通過したかどうかが最短で・確実に現れる
 *   (メディアアップロードや後続 POST は非同期の先に居るため、観測が遅れる)
 * - 補助: POST `v1/dish-reviews` の件数。実際に「レビューが 2 件登録された」ことそのもの。
 *   ただし 2 本目の連鎖はアップロードを挟むぶん遅れて着弾しうるので、
 *   **主観測点は上の `v1/dishes` の方**である
 *
 * ## 連打の再現方法(#1086 で実測して確定)
 * `page.mouse` は 1 発ごとに CDP のラウンドトリップが挟まり、その隙に React のコミットが
 * 流れてしまうため連打にならない(感度ゼロ)。`utils/rapid-click.ts` の `clickRapid` で
 * **同一 JS タスク内に pointerdown → pointerup → click を N 回 dispatch** する。
 *
 * ## dev DB への影響(重要 / ユーザー承認済み)
 * このテストは成功パスを 1 回通すので、**dev DB にレビューが 1 件積み上がる**(削除導線は無い)。
 * 事故が起きている場合は 2 件以上になる。識別できるようコメントには必ず `[E2E]` を付ける。
 * `RUN_MUTATION=1` を明示したときだけ実行される(playwright.config.ts の `grepInvert`)。
 * production は対象外(ビルド時に焼き込まれた `api-development` を叩く)。
 */
test.skip(
	() => !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
	"TEST_USER_EMAIL / TEST_USER_PASSWORD(e2e-web/.env)が未設定のためスキップ",
);

const TEST_IMAGE_PATH = path.resolve(__dirname, "../../fixtures/assets/test-dish.png");

/** 投稿ボタンを何連打するか。連打の窓を広げるため review-post より多めに打つ */
const SUBMIT_PRESS_COUNT = 5;

test.describe("レビュー投稿ボタンの連打耐性 @mutation", () => {
	// レストラン作成・料理カテゴリ検索・画像アップロードなど実 API 呼び出しを直列で行うため、
	// review-post.spec.ts と同じ理由で既定の 30 秒テストタイムアウトを延長する
	test.setTimeout(90_000);

	// ─ テストケース: 投稿ボタンを連打してもレビューは 1 件しか登録されない ─
	// 手順:
	//   1. ログイン済みで起動し、食べたい/食べたタブ → 記録 CTA → 店名検索 → レストラン詳細へ
	//   2. 「写真・動画を投稿」でレビューフォームへ入り、filechooser にテスト画像を渡す
	//   3. コメント・料理カテゴリ・価格・評価を埋めて `isValid` を成立させる
	//   4. 投稿ボタンを **5 連打**する(同一 JS タスク内の合成 pointer 連打)
	//   5. 成功スナックバー「レビューを投稿しました」が出ることを検証
	//   6. POST `v1/dishes` がちょうど 1 回であることを検証(主観測点 = 二重投稿の検知)
	//   7. POST `v1/dish-reviews` がちょうど 1 回であることを検証(= レビューが 1 件だけ)
	test("投稿ボタンを連打してもレビューは 1 件しか登録されない", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const myDishesPage = new MyDishesPage(appPage);

		await tabBar.gotoMyDishes();
		await myDishesPage.openEatenRecordFlow();
		await myDishesPage.openEatenRestaurantPicker();
		// #1375（3 巡目）pick モードで選ぶと統合フォームへ戻り、ReviewForm が自動でメディア選択を開く
		await appPage.getByTestId("location-autocomplete-input").fill("スターバックス");
		await appPage.getByTestId("location-autocomplete-suggestions").waitFor({ state: "visible" });
		await appPage.getByTestId("location-autocomplete-suggestion-0").click();

		// #1375（6 巡目）記録フローは «お店 → 料理カテゴリー → 写真» の順。
		// カテゴリーが決まるまで写真もコメント欄も出ない
		await myDishesPage.chooseDishCategoryInRecordFlow("コーヒー");
		await myDishesPage.chooseMediaInRecordFlow();

		// 写真は自分で «ライブラリから選ぶ» を押して開く（記録フローは自動で開かない）
		const fileChooserPromise = appPage.waitForEvent("filechooser");
		await appPage.getByTestId("review-pick-from-library").click();
		const fileChooser = await fileChooserPromise;
		await fileChooser.setFiles(TEST_IMAGE_PATH);

		await appPage
			.getByTestId("review-comment-input")
			.fill(`[E2E] 連打耐性テスト ${new Date().toISOString()}`.slice(0, 100));

		await appPage.getByTestId("review-price-input").fill("500");
		await appPage.getByTestId("review-star-5").click();

		// 計測は「連打の直前」に始める。ここより前の POST(v1/restaurants 等)は対象外
		const dishPosts = await countRequests(appPage, "**/v1/dishes*", { method: "POST" });
		const reviewPosts = await countRequests(appPage, "**/v1/dish-reviews*", { method: "POST" });

		const submitButton = appPage.getByTestId("review-submit-button");
		await expect(submitButton).toBeVisible();
		await clickRapid(submitButton, SUBMIT_PRESS_COUNT);

		// 投稿完了まで待ってから数える。二重投稿が起きていれば、この時点までに
		// 2 本目の POST v1/dishes は必ず着弾している(ガードの直後に呼ばれるため)
		await expect(appPage.getByText("レビューを投稿しました", { exact: true })).toBeVisible({ timeout: 60_000 });

		expect(dishPosts.count(), `${SUBMIT_PRESS_COUNT} 連打で POST v1/dishes が二重に走っている`).toBe(1);
		expect(reviewPosts.count(), `${SUBMIT_PRESS_COUNT} 連打でレビューが二重に登録されている`).toBe(1);

		await dishPosts.stop();
		await reviewPosts.stop();
	});
});
