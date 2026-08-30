import * as path from "node:path";
import { test, expect } from "../../fixtures/test";
import type { Locator, Page } from "@playwright/test";
import { TabBar } from "../../pages/TabBar";
import { MyDishesPage } from "../../pages/MyDishesPage";

/**
 * ⏳ レビュー投稿中のローディング表示テスト @mutation(#1136 / PR #1166)
 *
 * 目的: 投稿処理が数秒〜数十秒かかる間、ユーザーが「押せたのか分からないまま連打する」状態を
 * 作らないこと、かつ **失敗してもローディングが解除されて再投稿できる**ことを保証する。
 *
 * ## 何を守っているか(#1136)
 * `ReviewForm.handleSubmit` はメディアアップロードと 3 本の API 呼び出しを直列で行うため、
 * 完了まで無反応に見える時間が長い。#1136 で `isSubmitting`(useState)を追加し、
 * `PrimaryButton` の `loading` に渡すことで **ボタン内にスピナー(Lottie)を出しつつ
 * 押下も止める**(`PrimaryButton` は `isDisabled = disabled || loading`)。
 * 解除は `finally` に置かれており、成功・失敗・例外のいずれでも必ず通る。
 * ここが try 側へ散ると「スピナー固着 = 二度と投稿できない」不具合になるため、
 * 失敗ケースこそがこの spec の主目的である。
 *
 * ## 観測点
 * - **スピナー**: `components/LoadingIndicator/index.web.tsx` は web で `role="status"` を
 *   出すため、投稿ボタン配下の `role=status` の有無で判定できる(testID 追加は不要)
 * - **押下不可**: react-native-web の Pressable は `disabled` から `aria-disabled` を生成する
 *   (`PrimaryButton` の #930 コメント参照)。加えて **force クリックしても POST が増えない**
 *   ことを直接数えて、見た目だけでなく実際に発火しないことまで確認する
 * - **解除**: 失敗後に **もう一度ふつうに click できる**ことで判定する。Playwright の click は
 *   要素が enabled になるまで待つため、スピナーが固着していればここでタイムアウトする
 *
 * ## なぜ実投稿を待たないか / dev DB への影響
 * POST `v1/dishes`(handleSubmit が最初に呼ぶ API)を `page.route()` で **遅延 / 失敗**させる。
 * これにより:
 * - ローディングの出現・解除を任意のタイミングで観測できる(外部 API の実測時間に依存しない)
 * - dish / dish-media / dish-review は 1 件も作られず、メディアアップロードにも到達しない
 *
 * ただしフォームへ辿り着くまでの導線でレストラン作成(POST `v1/restaurants`)が実際に走るため、
 * review-post.spec.ts と同じ理由で `@mutation` に分類する(同一 Place は upsert され重複しない)。
 */
test.skip(
	() => !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
	"TEST_USER_EMAIL / TEST_USER_PASSWORD(e2e-web/.env)が未設定のためスキップ",
);

const TEST_IMAGE_PATH = path.resolve(__dirname, "../../fixtures/assets/test-dish.png");

/**
 * handleSubmit が最初に叩く API。ここを止めれば「投稿中」の状態を任意の長さで維持できる。
 * `v1/dish-media` / `v1/dish-reviews` はこの後ろに居るため、この 1 本を抑えれば以降は走らない。
 */
const CREATE_DISH_URL = "**/v1/dishes*";

/** ja-JP: Map.errors.reviewSubmitFailed */
const SUBMIT_FAILED_MESSAGE = "レビューの投稿に失敗しました";

/**
 * 投稿ボタンが押せる状態（`isValid` 成立）のレビューフォームまで進める。
 *
 * 手順は review-double-submit.spec.ts と同一。外部 API(Google Places / 料理カテゴリ検索)の
 * 応答内容に依存するため、失敗時はまずサジェスト結果の中身を確認すること。
 *
 * @returns 投稿ボタンの Locator
 */
async function openFilledReviewForm(appPage: Page, comment: string): Promise<Locator> {
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

	await appPage.getByTestId("review-comment-input").fill(comment.slice(0, 100));


	await appPage.getByTestId("review-price-input").fill("500");
	await appPage.getByTestId("review-star-5").click();

	const submitButton = appPage.getByTestId("review-submit-button");
	await expect(submitButton).toBeVisible();
	return submitButton;
}

/** 投稿ボタン内のスピナー（LoadingIndicator が web で出す role="status"） */
function submitSpinner(submitButton: Locator): Locator {
	return submitButton.getByRole("status");
}

test.describe("レビュー投稿中のローディング @mutation", () => {
	// レストラン作成・料理カテゴリ検索・画像選択など実 API 呼び出しを直列で行うため、
	// review-post.spec.ts と同じ理由で既定の 30 秒テストタイムアウトを延長する
	test.setTimeout(90_000);

	// ─ テストケース: 投稿中はスピナーが出てボタンが押せない ─
	// 手順:
	//   1. レビューフォームを投稿可能な状態まで埋める
	//   2. POST v1/dishes を「ゲートを開けるまで応答しない」ルートで差し替える(= 投稿中を維持)
	//   3. 投稿ボタンを押し、POST が 1 回飛んだことを確認する
	//   4. ボタン内にスピナー(role=status)が出ていることを検証
	//   5. ボタンが aria-disabled であることを検証
	//   6. force クリックを 2 回打っても POST が増えない(= 実際に押下が届かない)ことを検証
	//   7. ゲートを開けて投稿処理を失敗で終わらせ、後片付けする
	test("投稿中はボタンにスピナーが出て押下も届かない", async ({ appPage }) => {
		const submitButton = await openFilledReviewForm(
			appPage,
			`[E2E] ローディング表示テスト ${new Date().toISOString()}`,
		);

		/** POST v1/dishes の着弾回数。ローディング中に増えなければ「押せていない」ことの直接証拠になる */
		let createDishRequests = 0;
		/** 保留中のリクエストを一斉に解放するゲート（テスト側から任意のタイミングで開ける） */
		let openGate!: () => void;
		const gate = new Promise<void>((resolve) => {
			openGate = resolve;
		});

		await appPage.route(CREATE_DISH_URL, async (route) => {
			if (route.request().method() !== "POST") {
				await route.continue();
				return;
			}
			createDishRequests += 1;
			await gate;
			// #1090 の教訓どおり POST は useAPICall に自動リトライされないため、abort しても 1 回で終わる
			await route.abort("failed");
		});

		await submitButton.click();

		// 押下が API まで届いた時点まで待つ（ここまで来れば isSubmitting は true になっている）
		await expect.poll(() => createDishRequests).toBe(1);

		await expect(submitSpinner(submitButton)).toBeVisible();
		await expect(submitButton).toHaveAttribute("aria-disabled", "true");

		// 通常の click は「enabled になるまで待つ」ため disabled 検証と重複してしまう。
		// force で actionability を飛ばし、**押下イベント自体は届いた上で** ハンドラが弾くことを見る
		await submitButton.click({ force: true });
		await submitButton.click({ force: true });

		// 弾かれずに通っていれば、この待機の間に 2 本目の POST が着弾する
		// (handleSubmit はガードを抜けた直後に v1/dishes を呼ぶため、遅れて現れることはない)
		await appPage.waitForTimeout(1_000);
		expect(createDishRequests, "投稿中にもかかわらず 2 回目の投稿が発火している").toBe(1);

		// 後片付け: 保留中のリクエストを解放し、アプリを投稿失敗の状態まで進めてから unroute する
		openGate();
		await expect(appPage.getByText(SUBMIT_FAILED_MESSAGE, { exact: true })).toBeVisible();
		await appPage.unroute(CREATE_DISH_URL);
	});

	// ─ テストケース: 投稿に失敗してもローディングが解除される ─
	// 手順:
	//   1. レビューフォームを投稿可能な状態まで埋める
	//   2. POST v1/dishes を常に失敗させるルートを仕込む
	//   3. 投稿ボタンを押し、失敗スナックバー「レビューの投稿に失敗しました」が出ることを検証
	//   4. ボタン内のスピナーが消えていることを検証(= ローディング固着していない)
	//   5. **もう一度ふつうに click** して再投稿できることを検証
	//      (Playwright の click は enabled になるまで待つため、固着していればここで失敗する)
	test("投稿に失敗してもローディングが解除され、再投稿できる", async ({ appPage }) => {
		const submitButton = await openFilledReviewForm(
			appPage,
			`[E2E] 投稿失敗時の解除テスト ${new Date().toISOString()}`,
		);

		let createDishRequests = 0;
		await appPage.route(CREATE_DISH_URL, async (route) => {
			if (route.request().method() !== "POST") {
				await route.continue();
				return;
			}
			createDishRequests += 1;
			await route.abort("failed");
		});

		await submitButton.click();

		const failedSnackbar = appPage.getByText(SUBMIT_FAILED_MESSAGE, { exact: true });
		await expect(failedSnackbar).toBeVisible();
		await expect(submitSpinner(submitButton)).toHaveCount(0);
		await expect(submitButton).toBeEnabled();

		// スナックバーは画面下部（投稿ボタンと同じ領域）に 4 秒間出るため、
		// 消えるまで待ってから押し直す。待たないと click がオーバーレイに吸われて誤検知になる
		await expect(failedSnackbar).toBeHidden({ timeout: 15_000 });

		// 再投稿できること = isSubmitting / isSubmittingRef の両方が解除されていること。
		// disabled のままなら click が actionability 待ちでタイムアウトし、
		// ref だけ解除漏れなら POST が飛ばず下の poll がタイムアウトする
		await submitButton.click();
		await expect.poll(() => createDishRequests).toBe(2);

		await appPage.unroute(CREATE_DISH_URL);
	});
});
