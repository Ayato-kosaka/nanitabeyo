import { test, expect } from "../../fixtures/test";
import {
	buildApiHeaders,
	captureEvidence,
	e2eReviewComment,
	findDishMediaCandidates,
	submitReviewForm,
} from "../../utils/eatenLifecycle";

/**
 * 🍽 全画面 Feed の「食べた」から記録できる（#1398 PR3 / PR7 の ④）
 *
 * 実行プロジェクト: desktop-chrome-authenticated（storageState 注入済み）
 * 実行条件: `RUN_MUTATION=1` のときのみ（dev DB へ `dish_reviews` を 1 行書く）
 *
 * ## どの Feed で見るか
 *
 * `ActionButtons`（`features/dishMedia/components/ActionButtons.tsx`）は
 * `DishMediaContent` 経由で **全画面 Feed 全部**が共有している。ここでは
 * 店舗詳細から開く Feed（`/[locale]/restaurant/[id]/feed`）で見る。理由は 2 つ:
 *
 * - **決定論的に開ける**。検索タブの Feed は AI 推薦を経由するため、
 *   `tests/authenticated/reactions.spec.ts` がリトライ 2 回を積んでいるほど不安定。
 * - **`my-dishes/feed` は前提が重い**。あちらは `GET /v1/users/me/dishes?restaurantId=` に
 *   依存する（= 一覧に自分の行がある店舗が要る）。CTA と遷移先の検証には不要な前提である。
 *
 * ## CTA は «食べた» の 1 つだけ
 *
 * #1629【オーナー確定】「店舗詳細からフィードに入ったとき、レビューを書くボタンはいらない。
 * 食べたボタンがあるので、そこが導線になっている」。
 *
 * 以前のリーダー確定 Q5 は «`restaurant-feed-write-review-button` を消さない» で、
 * この spec は «両方ある» ことを固定していた。**オーナー確定で覆ったので逆を固定する**
 * （同じことを始めるボタンが画面に 2 つある状態だった）。
 *
 * ## dev DB への影響
 *
 * `dish_reviews` が 1 行増える（削除 UI が無いため蓄積する）。識別できるよう
 * コメントに `[E2E]` プレフィックスを付ける（`tests/authenticated/review-post.spec.ts` と同じ作法）。
 */
test.skip(
	() => !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
	"TEST_USER_EMAIL / TEST_USER_PASSWORD（e2e-web/.env）が未設定のためスキップ",
);

test.describe("全画面 Feed からの食べた記録（#1398）", () => {
	// Feed の初回取得 + レビュー投稿の実 API を直列で叩くため、既定の 30 秒では足りない
	test.setTimeout(90_000);

	// ─ テストケース: Feed の「食べた」→ review-from-media → 投稿 @mutation ─
	// 手順:
	//   1. 料理メディアを持つ実在の店舗を API から 1 件拾い、その全画面 Feed へ着地する
	//   2. `dish-action-eaten`（#1398 PR3 で追加した「食べた」）を押す
	//   3. `review-from-media` へ遷移すること（= 元メディアに紐付くので写真撮影が要らない経路）
	//   4. ★・コメント・価格を埋めて投稿し、成功スナックバーを検証
	//      （料理カテゴリは prefilledMedia モードで確定済み。ReviewForm 側で行が disabled になる）
	test("Feed の「食べた」から review-from-media へ進んで記録できる @mutation", async ({
		appPage,
		request,
	}, testInfo) => {
		const headers = await buildApiHeaders(appPage);
		const [candidate] = await findDishMediaCandidates(request, headers, 1);
		testInfo.annotations.push({
			type: "candidate",
			description: `${candidate.restaurantName} / ${candidate.dishName ?? "(料理名なし)"} (media=${candidate.dishMediaId})`,
		});

		await appPage.goto(`/ja-JP/restaurant/${candidate.restaurantId}/feed`);
		await expect(appPage.getByTestId("restaurant-feed-screen")).toBeVisible({ timeout: 30_000 });

		// #1398 PR3 で追加した「食べた」。Feed は複数枚を同時に描くので nth(0) で先頭を指す
		//（動的な testID は作らない方針。#1396 §6-1 / #1397 §11-2）
		const eatenAction = appPage.getByTestId("dish-action-eaten").first();
		await expect(eatenAction).toBeVisible({ timeout: 30_000 });

		// #1629【オーナー確定】「この料理にレビューを書く」は撤去済み。復活したらここで落とす
		await expect(appPage.getByTestId("restaurant-feed-write-review-button")).toHaveCount(0);
		// 証跡用。Feed の 1 枚はビューポートより高いので、スクロールしないと
		// アクション列（＝ 撮りたいもの）が写らない
		await eatenAction.scrollIntoViewIfNeeded();
		await captureEvidence(appPage, testInfo, "1398-pr7-feed-eaten-cta");

		await eatenAction.click();

		// 新しいルートは作らない設計（§1(b)）。遷移先は既存の review-from-media
		await expect(appPage).toHaveURL(/\/restaurant\/[^/]+\/review-from-media\/[^/?]+/, { timeout: 20_000 });
		await expect(appPage.getByTestId("review-comment-input")).toBeVisible({ timeout: 30_000 });

		await appPage.getByTestId("review-comment-input").fill(e2eReviewComment("PR7 Feed から食べた記録"));
		await appPage.getByTestId("review-price-input").fill("800");
		await appPage.getByTestId("review-star-4").click();
		await captureEvidence(appPage, testInfo, "1398-pr7-feed-eaten-form");

		const submission = await submitReviewForm(appPage);
		expect(submission.status, `POST /v1/dish-reviews が失敗しました: ${submission.body}`).toBeLessThan(300);
		await expect(appPage.getByText("レビューを投稿しました", { exact: true })).toBeVisible({ timeout: 30_000 });

		// 写真あり（元メディアに紐付く）記録なので、従来どおり投稿詳細へ進む
		await expect(appPage).toHaveURL(/\/post\//, { timeout: 20_000 });
		await captureEvidence(appPage, testInfo, "1398-pr7-feed-eaten-posted");
	});
});
