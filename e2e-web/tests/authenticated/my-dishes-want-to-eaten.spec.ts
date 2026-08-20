import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { MyDishesPage } from "../../pages/MyDishesPage";
import {
	buildApiHeaders,
	captureEvidence,
	e2eReviewComment,
	fetchMyDishes,
	findDishMediaCandidates,
	isMyDishesApiAvailable,
	isMyDishesListResponseUrl,
	readMyDishItems,
	saveDishMedia,
	submitReviewForm,
	unsaveDishMediaQuietly,
} from "../../utils/eatenLifecycle";

/**
 * 🔁 食べたい → 食べたで一覧に重複が出ない（#1398 PR4 / PR7 の ① と ③）
 *
 * 実行プロジェクト: desktop-chrome-authenticated（storageState 注入済み）
 * 実行条件: `RUN_MUTATION=1` のときのみ（dev DB へ `reactions` と `dish_reviews` を書く）
 *
 * ## この 1 本で 2 つ固定する
 *
 * 1. **重複が出ない**（①）。want カードの「食べたを記録」→ 投稿 → my-dishes に戻ると、
 *    その料理の行は **eaten 1 行だけ**になる。want 行は残らない。
 *    サーバ側は `my-dishes.query.ts` の want 枝が
 *    `NOT EXISTS (SELECT 1 FROM dish_reviews …)` を持つので構造的に正しい（設計 §3）。
 *    したがってここで実際に危ないのは **クライアントキャッシュ**であり、この spec は
 *    PR4 の `revision` bump（`useMyDishesRevisionStore`）が効いていることの証拠になる。
 * 2. **`savedAt` と `eatenAt` が両方残る**（③）。Issue 本文の完了条件
 *    「食べたい登録日と食べた日の両方が保持されていることをデータで確認できる」は
 *    **UI の見た目では確認できない**。`GET /v1/users/me/dishes` の応答を掴んで、
 *    eaten になった **同じ 1 行**に両方載っていることを見る。
 *
 * ## 前提の作り方
 *
 * want 行は `reactions(target_type='dish_media', action_type='save')` からしか作れない。
 * 画面操作（検索タブ → AI 推薦 → Feed → 保存）で作ると本題と無関係な理由で落ちるので、
 * **前提は API で作り、検証は画面で行う**（`utils/eatenLifecycle.ts` の方針）。
 *
 * ## dev DB への影響
 *
 * - `reactions`（save）を 1 件付ける。**これは外さない**。「食べたい → 食べた」で save を
 *   消さないのが本 Issue の仕様（設計 §3）であり、外すと検証した `savedAt` を自分で壊すため。
 *   採用しなかった候補に付けた save だけは、その場で外して元に戻す。
 * - `dish_reviews` が 1 行増える（削除 UI が無いため蓄積する）。コメントは `[E2E]` プレフィックス。
 *
 * ## ⚠️ R5 は仕様（誤報しないこと）
 *
 * `dishes` は `restaurant_id × category_id` で一意なので、記録は既存 dish に相乗りする。
 * その結果 **他人の写真が自分の「食べた」カードの代表画像になる**ことがある
 * （`COALESCE(own_media_id, fb.id)` の fb 側）。#1395 m-7 で決め切った仕様であり不具合ではない。
 */
test.skip(
	() => !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
	"TEST_USER_EMAIL / TEST_USER_PASSWORD（e2e-web/.env）が未設定のためスキップ",
);

test.describe("食べたい → 食べた（#1398）", () => {
	// 前提づくり（API）+ 一覧 + レビュー投稿 + 再取得を直列で行うため、既定の 30 秒では足りない
	test.setTimeout(120_000);

	// ─ テストケース: want 行が消えて eaten 行が 1 行だけになる @mutation ─
	// 手順:
	//   1. 実在する dish_media を 1 件拾って「食べたい」を API で付ける
	//      （その dish に自分のレビューが既にあると want 行にならないので、候補を順に試す）
	//   2. 食べたい/食べたタブ（リストビュー）を開き、アプリが受け取った
	//      `GET /v1/users/me/dishes` の応答から対象 want 行の «want の中での順番» を得る
	//   3. その順番の「食べたを記録」（my-dishes-mark-as-eaten）を押す → review-from-media
	//   4. ★・コメント・価格を埋めて投稿
	//   5. 投稿後にアプリが自動で取り直した応答（revision bump による再取得）を掴み、
	//      対象 dish の行が **eaten 1 行だけ**で、`savedAt` と `eatenAt` の両方が載っていることを検証
	//   6. my-dishes へ戻り、記録後の一覧が壊れずに描けていることを確認して証跡を残す
	test("want 行が eaten 1 行に畳まれ、savedAt と eatenAt が両方残る @mutation", async ({
		appPage,
		request,
	}, testInfo) => {
		const headers = await buildApiHeaders(appPage);

		// ✋ 前提チェック: `GET /v1/users/me/dishes` がデプロイ済みか。
		// #1395 / #1396 で追加された endpoint だが、api-development は手動デプロイ
		//（`.github/workflows/api-deploy.yml` の workflow_dispatch）なので未反映だと 404 になる。
		// **アプリの不具合ではなく実行環境のズレ**なので赤にしない
		const available = await isMyDishesApiAvailable(request, headers);
		test.skip(
			!available,
			[
				"GET /v1/users/me/dishes が api-development に存在しないためスキップしました（404）。",
				"#1395 / #1396 の API が Cloud Run へ未デプロイです。",
				"デプロイ後にこの spec を回すと ① 重複が出ない / ③ savedAt・eatenAt の両立が検証されます。",
			].join("\n"),
		);

		// ── 1. 前提: 「食べたい」を 1 件作る ──────────────────────────────
		// その dish に自分のレビューが既にあると want 枝から落ちる（設計 §3-1）ので、
		// **まだ自分が記録していない料理**を選ぶ必要がある。
		//
		// ⚠️ このテストは回すたびに 1 品ずつ「記録済み」を増やす。候補を数件しか見ないと
		// 数回で «全部記録済み» になって落ちるので、広めに取ってから既記録を除く。
		const candidates = await findDishMediaCandidates(request, headers, 12);
		const { items: eatenRows } = await fetchMyDishes(request, headers, { status: "eaten", limit: "100" });
		const eatenDishIds = new Set(eatenRows.map((row) => row.dish.id));
		const freshCandidates = candidates.filter((candidate) => !eatenDishIds.has(candidate.dishId));

		let target: (typeof candidates)[number] | null = null;
		const tried: string[] = [];
		// 既記録の除外は 1 ページ（100 件）ぶんしか見ていないので、
		// 実際に save して want 行に出るところまで確かめてから採用する
		for (const candidate of freshCandidates) {
			await saveDishMedia(request, headers, candidate.dishMediaId);
			const { items } = await fetchMyDishes(request, headers, { status: "want", limit: "100" });
			if (items.some((item) => item.dish.id === candidate.dishId)) {
				target = candidate;
				break;
			}
			// 既にレビュー済みの dish だった。付けた save は元に戻して次の候補へ
			await unsaveDishMediaQuietly(request, headers, candidate.dishMediaId);
			tried.push(`${candidate.restaurantName}: 既にレビュー済み（want 行にならない）`);
		}
		expect(
			target,
			["「食べたい」にできる料理が見つかりませんでした（前提条件の不足であってバグではない）", ...tried].join("\n"),
		).not.toBeNull();
		const picked = target!;
		testInfo.annotations.push({
			type: "target",
			description: `${picked.restaurantName} / ${picked.dishName ?? "(料理名なし)"} (dish=${picked.dishId})`,
		});

		// ── 2. 一覧を開き、対象 want 行の «want の中での順番» を応答から得る ──
		const tabBar = new TabBar(appPage);
		const myDishesPage = new MyDishesPage(appPage);
		const listResponsePromise = appPage.waitForResponse(
			(response) => isMyDishesListResponseUrl(response.url()) && response.status() === 200,
			{ timeout: 30_000 },
		);
		await tabBar.gotoMyDishes();
		await myDishesPage.expectAuthenticatedViewLoaded();
		const listItems = readMyDishItems(await (await listResponsePromise).json());

		// 「食べたを記録」CTA は want 行にしか出ない（`myDishCard.tsx` の MyDishEatenButton）。
		// したがって «want 行の中での index» が、そのまま CTA の nth() になる。
		// ⚠️ 一覧全体の index を使わないこと。eaten 行が混ざると別の料理を押すことになる。
		// ⚠️ 動的な testID は作らない方針なので nth() で指す（#1396 §6-1 / #1397 §11-2）
		const wantIndex = listItems
			.filter((item) => item.status === "want")
			.findIndex((item) => item.dish.id === picked.dishId);
		expect(wantIndex, "一覧の 1 ページ目に対象の食べたい行が見つかりませんでした").toBeGreaterThanOrEqual(0);

		await captureEvidence(appPage, testInfo, "1398-pr7-want-list-before");

		// ── 3. want 行の「食べたを記録」→ review-from-media ────────────────
		await appPage.getByTestId("my-dishes-mark-as-eaten").nth(wantIndex).click();
		await expect(appPage).toHaveURL(/\/restaurant\/[^/]+\/review-from-media\/[^/?]+/, { timeout: 20_000 });
		await expect(appPage.getByTestId("review-comment-input")).toBeVisible({ timeout: 30_000 });

		// ── 4. 投稿（料理カテゴリは prefilledMedia モードで確定済み）──────────
		await appPage.getByTestId("review-comment-input").fill(e2eReviewComment("PR7 食べたい→食べた"));
		await appPage.getByTestId("review-price-input").fill("600");
		await appPage.getByTestId("review-star-5").click();

		// 投稿成功で `bumpMyDishesRevision()` が走り、my-dishes のキャッシュが捨てられて
		// 一覧が取り直される（PR4）。その «取り直し» の応答を掴むために、投稿前に仕掛ける
		const refetchPromise = appPage.waitForResponse(
			(response) => isMyDishesListResponseUrl(response.url()) && response.status() === 200,
			{ timeout: 60_000 },
		);
		const submission = await submitReviewForm(appPage);
		expect(submission.status, `POST /v1/dish-reviews が失敗しました: ${submission.body}`).toBeLessThan(300);
		await expect(appPage.getByText("レビューを投稿しました", { exact: true })).toBeVisible({ timeout: 30_000 });

		// ── 5. ①③ の本体: 取り直した応答を «データとして» 検証する ───────────
		const refetched = readMyDishItems(await (await refetchPromise).json());
		const rowsForDish = refetched.filter((item) => item.dish.id === picked.dishId);
		testInfo.annotations.push({
			type: "rows",
			description: JSON.stringify(
				rowsForDish.map((row) => ({ key: row.key, status: row.status, savedAt: row.savedAt, eatenAt: row.eatenAt })),
			),
		});

		// ①: want と eaten が並ばない。1 行だけ
		expect(rowsForDish, "同じ料理の行が 1 行に畳まれていません（食べたい行が残っている）").toHaveLength(1);
		expect(rowsForDish[0].status).toBe("eaten");
		expect(rowsForDish[0].key.startsWith("review:"), "eaten 行のキーは review:<uuid> であるべきです").toBe(true);
		expect(
			refetched.some((item) => item.key === `dish:${picked.dishId}`),
			"食べたい行（dish:<uuid>）が残っています",
		).toBe(false);

		// ③: 食べたい登録日と食べた日が **同じ 1 行** に両方載っている
		expect(rowsForDish[0].savedAt, "savedAt（食べたい登録日）が失われています").not.toBeNull();
		expect(rowsForDish[0].eatenAt, "eatenAt（食べた日）が入っていません").not.toBeNull();

		// ── 6. 画面へ戻って証跡を残す ────────────────────────────────────
		// review-from-media は投稿成功後に `/post/[id]` まで進むので、そこから my-dishes へ戻る。
		//
		// ⚠️ ここで «特定の行» を DOM から名指しできないのは、動的な testID を作らない方針
		//（#1396 §6-1 / #1397 §11-2）による。CTA の «件数» で見る手もあるが、他の spec が
		// 並列で save を付け外しする（`tests/authenticated/reactions.spec.ts`）ので件数は安定しない。
		// **重複の有無はアプリが受け取った応答（上の ①）が唯一ズレない証拠**であり、
		// ここは «記録後の一覧が壊れずに描けている» ことの確認とスクリーンショットに徹する。
		await expect(appPage).toHaveURL(/\/post\//, { timeout: 20_000 });
		// ⚠️ ここでタブバーは押せない。`/post/[id]` は全画面のルートでタブバーを出さないので、
		// `TabBar.gotoMyDishes()` は «見えない要素» を待ち続けて必ずタイムアウトする（実測）。
		// 直前の `dismissTo` で 1 つ下が my-dishes になっているのでブラウザバックで戻る
		await appPage.goBack();
		await expect(appPage).toHaveURL(/\/my-dishes(\?.*)?$/, { timeout: 20_000 });
		await myDishesPage.expectAuthenticatedViewLoaded();
		await expect(appPage.getByTestId("my-dishes-list")).toBeVisible();
		await captureEvidence(appPage, testInfo, "1398-pr7-want-list-after");

		// ⚠️ 付けた「食べたい」は **外さない**。
		// 「食べたい → 食べた」で save reaction を消さないのがこの Issue の仕様（設計 §3）であり、
		// ここで消すと、いま検証した `savedAt` を自分で壊すことになる。eaten になった dish の
		// save は want 行を作らない（want 枝の NOT EXISTS）ので、残しても一覧は汚れない。
	});
});
