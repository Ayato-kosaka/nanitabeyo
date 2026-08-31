import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures/test";
import { RestaurantDetailPage } from "../../pages/RestaurantDetailPage";
import { PRERENDER_MISS_HYDRATION_NOISE } from "../../utils/consoleNoise";
import {
	buildApiHeaders,
	cancelMediaPicker,
	captureEvidence,
	e2eReviewComment,
	findAnyRestaurant,
	isNoMediaReviewSupported,
	submitReviewForm,
} from "../../utils/eatenLifecycle";

/**
 * 📝 写真なしの「食べた」記録（#1398 PR2 / PR7 の ② と Q2）
 *
 * 実行プロジェクト: desktop-chrome-authenticated（storageState 注入済み）
 *
 * ## ここで固定する 2 つ
 *
 * 1. **Q2 の条件（必須）**: ピッカーをキャンセルしても画面が閉じず、**戻るボタンで退出できる**。
 *    PR2 は「キャンセル＝画面が閉じる」を廃止した（`ReviewForm.tsx` の B2）。退出手段が
 *    実際に残っていることをテストで証明しないと、「既存で出来たことを落とす」に該当する
 *    （#1398 リーダー確定コメント Q2 の条件 2）。**この 1 本は dev DB へ書き込まない**ので
 *    無タグ（Tier 2）で常時回す。
 * 2. **写真なしで記録が完了する**（設計 §1 c-2）。★・コメント・価格・カテゴリを埋めて投稿でき、
 *    遷移先が `/post/[id]` ではなく my-dishes であること。こちらは dev DB へ書くので `@mutation`。
 *
 * ## 「フォームに留まる」を «画面が閉じない» で終わらせない
 *
 * URL が `/restaurant/[id]/review` のままであることに加えて、写真なしプレビュー
 * （`review-add-photo-placeholder`）と入力欄が見えていることまで見る。閉じないだけなら
 * 白画面でも通ってしまう。
 *
 * ## dev DB への影響
 *
 * 2 本目のみ `dish_reviews` を 1 行（写真なし）作る。削除 UI が無いため蓄積するので、
 * コメントには `[E2E]` プレフィックスを付ける（`tests/authenticated/review-post.spec.ts` と同じ作法）。
 */
test.skip(
	() => !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
	"TEST_USER_EMAIL / TEST_USER_PASSWORD（e2e-web/.env）が未設定のためスキップ",
);

test.describe("写真なしの食べた記録（#1398）", () => {
	/*
	#1629 この spec は **動的ルートへ直接着地する**（店舗詳細 → レビューフォーム）。
	Firebase Hosting は prerender されない URL を index.html で返すため、サーバ HTML と
	クライアントの木が必ず食い違う（React #418）。画面は正しく描き直されるので
	本来のアサーションは通る。同じ扱いを既に 11 ファイルへ広げてある
	（`utils/consoleNoise.ts` の申し送り）。
	*/
	test.use({ allowedConsoleErrors: PRERENDER_MISS_HYDRATION_NOISE });
	// 店舗詳細の取得・料理カテゴリ検索など実 API を直列で叩くため、既定の 30 秒では足りない
	test.setTimeout(90_000);

	/**
	 * レビューフォームへ入り、自動で開くピッカーをキャンセルするまでを行う。
	 *
	 * #1629 以前は店舗詳細の «写真・動画を投稿» を押して入っていたが、そのボタンは
	 * オーナー確定でこの画面から外れた（投稿は «食べたを記録» のフローへ 1 本化）。
	 * このテストの本題は «写真なしでも記録できること» であって入口ではないので、
	 * ルートへ直接着地する。
	 *
	 * ⚠️ **店舗詳細を先に開いてから review へ goto すること。** 下のテストが
	 *    «戻るボタンで店舗詳細へ帰れる» ことを見るので、履歴が要る。
	 *
	 * ⚠️ `waitForEvent("filechooser")` は **遷移より前に** 仕掛けること。
	 * 着地と同時にピッカーが開く実装なので、後から待つと取りこぼす
	 *（`tests/authenticated/review-post.spec.ts` と同じ理由）。
	 */
	async function openReviewFormAndCancelPicker(page: Page, restaurantId: string) {
		const detailPage = new RestaurantDetailPage(page);
		await page.goto(`/ja-JP/restaurant/${restaurantId}`);
		await expect(detailPage.googleMapsButton).toBeVisible({ timeout: 30_000 });

		/*
		⚠️ **ピッカーの待ち受けは `page.on` で張ること。`waitForEvent` を使わない。**

		`ReviewForm` は `mediaPickerMode` の既定（"auto"）でマウント直後にピッカーを開くが、
		この画面へ直接着地すると **店舗の取得が終わってから ReviewForm がマウントされる**ため、
		いつ開くかがネットワーク次第になる。`waitForEvent` は «その時点から待つ» ので、
		待ち始める前に開かれると取りこぼし、90 秒 timeout で落ちる
		（実測: run 33382910047。それまでは店舗詳細のボタンからの push だったので
		  マウントのタイミングが安定しており、この問題が出ていなかった）。

		`page.on` は登録した時点から «来たら拾う» なので、順序に依存しない。
		*/
		let chooserSeen = false;
		page.on("filechooser", (chooser) => {
			chooserSeen = true;
			void cancelMediaPicker(page, chooser);
		});

		await page.goto(`/ja-JP/restaurant/${restaurantId}/review`);
		// ピッカーが開いてキャンセルされた «結果» を待つ。写真なしのプレビュー枠が出れば済んでいる
		await expect(page.getByTestId("review-add-photo-placeholder")).toBeVisible({ timeout: 60_000 });
		expect(chooserSeen, "写真ピッカーが一度も開かなかった（この画面の前提が変わっている）").toBe(true);
	}

	// ─ テストケース: キャンセルしてもフォームに留まり、戻るボタンで退出できる（Q2 の条件）─
	// 手順:
	//   1. 実在する店舗の詳細を開いてからレビューフォームへ入る
	//   2. 自動で開く写真ピッカーをキャンセルする
	//   3. URL が `/restaurant/[id]/review` のままで、写真なしプレースホルダと入力欄が出ることを検証
	//      （＝ 画面が閉じない）
	//   4. ScreenHeader の戻るボタンで退出できることを検証（＝ 退出手段が残っている）
	test("ピッカーをキャンセルしてもフォームに留まり、戻るボタンで退出できる", async ({ appPage, request }, testInfo) => {
		const headers = await buildApiHeaders(appPage);
		const { restaurantId, restaurantName } = await findAnyRestaurant(request, headers);
		testInfo.annotations.push({ type: "restaurant", description: `${restaurantName} (${restaurantId})` });

		await openReviewFormAndCancelPicker(appPage, restaurantId);

		// 画面が閉じていない = URL がレビューフォームのまま
		await expect(appPage).toHaveURL(/\/restaurant\/[^/]+\/review(\?.*)?$/);
		// 「閉じないだけ」で終わらせない。写真なしのプレビュー枠と入力欄が実際に触れる状態か
		await expect(appPage.getByTestId("review-add-photo-placeholder")).toBeVisible();
		await expect(appPage.getByTestId("review-comment-input")).toBeVisible();
		await expect(appPage.getByTestId("review-submit-button")).toBeVisible();
		await captureEvidence(appPage, testInfo, "1398-pr7-no-photo-form");

		// Q2 の条件: 退出手段が残っていること。
		// review.tsx の ScreenHeader は testID を渡していないので既定の `screen-header-back`。
		// #1404 のとおり画面ごとの id を持つ画面（店舗詳細 = restaurant-detail-screen-back）とは
		// 別物なので、ここで strict mode violation は起きない
		const backButton = appPage.getByTestId("screen-header-back");
		await expect(backButton).toHaveCount(1);
		await backButton.click();

		// 押下前にいた店舗詳細へ帰れる（= 行き止まりになっていない）
		await expect(appPage).toHaveURL(/\/restaurant\/[^/]+(\?.*)?$/);
		// #1629 «写真・動画を投稿» は外したので、店舗詳細に居る目印は «Google マップで開く»
		await expect(appPage.getByTestId("restaurant-detail-google-maps-button")).toBeVisible();
		await captureEvidence(appPage, testInfo, "1398-pr7-no-photo-back-exit");
	});

	// ─ テストケース: 写真なしで記録が完了する @mutation ─
	// 手順:
	//   1. 上と同じ経路でレビューフォームへ入り、ピッカーをキャンセルする
	//   2. コメント・料理カテゴリ・価格・★ を埋める（写真の有無に関係なく 4 つとも必須）
	//   3. 投稿 → 成功スナックバーを検証
	//   4. 遷移先が my-dishes であり、**`/post/[id]` ではない**ことを検証（設計 §1 c-2）
	test("写真なしで記録が完了し、/post/[id] ではなく my-dishes へ戻る @mutation", async ({
		appPage,
		request,
	}, testInfo) => {
		const headers = await buildApiHeaders(appPage);

		// ✋ 前提チェック: デプロイ済みの api-development が「写真なし記録」を受けるか。
		// #1395 で `createdDishMediaId` は任意になったが、Cloud Run は手動デプロイなので
		// 古いままだと 400 になる。**アプリの不具合ではなく実行環境のズレ**なので赤にしない
		const support = await isNoMediaReviewSupported(request, headers);
		test.skip(
			!support.supported,
			[
				"api-development が写真なし記録（createdDishMediaId 省略）を受け付けないためスキップしました。",
				"#1395 の contract（CreateDishReviewDto.createdDishMediaId を任意化）が Cloud Run へ未デプロイです。",
				`実測: ${support.detail}`,
			].join("\n"),
		);

		const { restaurantId, restaurantName } = await findAnyRestaurant(request, headers);
		testInfo.annotations.push({ type: "restaurant", description: `${restaurantName} (${restaurantId})` });

		await openReviewFormAndCancelPicker(appPage, restaurantId);
		await expect(appPage.getByTestId("review-add-photo-placeholder")).toBeVisible();

		await appPage.getByTestId("review-comment-input").fill(e2eReviewComment("PR7 写真なし記録"));

		// 料理カテゴリは写真の有無と無関係に必須（設計 §1 c-2 / ReviewForm の isValid）
		await appPage.getByTestId("review-dish-category-row").click();
		await appPage.getByTestId("dish-category-search-input").fill("コーヒー");
		await appPage.getByTestId("dish-category-search-suggestions").waitFor({ state: "visible" });
		await appPage.getByTestId("dish-category-search-suggestion-0").click();

		await appPage.getByTestId("review-price-input").fill("500");
		await appPage.getByTestId("review-star-5").click();
		await captureEvidence(appPage, testInfo, "1398-pr7-no-photo-filled");

		const submission = await submitReviewForm(appPage);
		expect(submission.status, `POST /v1/dish-reviews が失敗しました: ${submission.body}`).toBeLessThan(300);
		await expect(appPage.getByText("レビューを投稿しました", { exact: true })).toBeVisible({ timeout: 30_000 });

		// 設計 §1 c-2: 写真なしは `/post/[id]` へ行かない（ストアにエントリが無く固着するため）。
		// dismissTo で my-dishes まで戻る
		await expect(appPage).toHaveURL(/\/my-dishes(\?.*)?$/, { timeout: 20_000 });
		await expect(appPage).not.toHaveURL(/\/post\//);
		await captureEvidence(appPage, testInfo, "1398-pr7-no-photo-submitted");
	});
});
