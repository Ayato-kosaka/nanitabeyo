import { test, expect } from "../../fixtures/test";
import { PRERENDER_MISS_HYDRATION_NOISE } from "../../utils/consoleNoise";
import {
	PRELOAD_CANDIDATE_COUNT,
	PRELOAD_CANDIDATE_INDEXES,
	collectCompletedCandidateImageIndexes,
	candidateImageUrl,
	mockCandidateImages,
	mockMultiCandidateVoteDetail,
	readDisplayedCandidateImage,
	voteScreenPath,
} from "../../utils/dishCategoryGroupVote";
import { findResourceStartTime } from "../../utils/preload-assets";

/**
 * 🖼 友達投票・候補画像の先読み（#1213）
 *
 * 実行プロジェクト: desktop-chrome（無タグ = Tier 2）
 *
 * ## 何を守るテストか
 * 投票画面は候補カードを **1 枚ずつ**しか描かない。候補を送るたびに生の uri を
 * `DishCategoryVisualCard` へ渡していたため、既に見えているはずの画像でも取得がその場から始まり、
 * カード背景色（#EEE）のグレーが一瞬見えていた（Issue #1213）。
 *
 * 修正は `useDishCategoryImageResources` へ候補全件を渡して **画面マウント時に先読みする**というもの。
 * したがってこの spec が守る不変条件は 1 つに集約できる:
 *
 *   **ユーザーが送るより前に、その候補の画像取得が始まっている（happens-before）**
 *
 * ## 観測の原則（tests/search/onboarding-preload.spec.ts と同一）
 * 絶対時間の閾値も固定 sleep も使わない。使うのは状態と順序だけ:
 * ①エントリの存在 ②`responseEnd > 0`（取得完了）③`startTime < 送った時刻` ④`naturalWidth > 0`（decode 健全性）。
 * 「ランナーが遅い」では赤くならない。
 *
 * ## 感度（偽の緑になっていないか）
 * - 修正前 … 先読みが無いので、画面を開いた時点で取得済みなのは 1 枚目だけ。
 *   1 つ目のテストが `[0] !== [0,1,2,3]` で落ち、どの候補が欠けたか名指しで出る
 * - 先読みを «表示中の 1 枚だけ» に縮めた回帰 … 同じく 1 つ目が落ちる
 * - 先読みはするが表示側へ渡し忘れた回帰 … 2 つ目の happens-before が落ちる
 *
 * 候補画像は `mockCandidateImages` が **わざと遅らせて**返す。#1120 の `delayOwnProfile` と
 * 同じ理由で、競合窓を広げないと「先読みのおかげ」と「たまたま速かった」を区別できない。
 *
 * ## web と native の違い（重要）
 * `useDishCategoryImageResources` は native では `Image.loadAsync` で ImageRef ごと先読みするが、
 * web は「共有する URL を確定し、ブラウザキャッシュへ実体を載せる」形で先読みする。
 * どちらも「送る前に取得が始まっている」点は同じなので、この spec の観点はそのまま
 * e2e-mobile 側（tests/review/dish-category-group-vote-image-preload.test.ts）と対応する。
 *
 * ## dev DB への影響
 * 無し（detail も画像もモックで、投票の送信までは進めない）。
 * 詳細は utils/dishCategoryGroupVote.ts の冒頭を参照。
 */
test.describe("友達投票の候補画像の先読み", () => {
	test.use({ allowedConsoleErrors: PRERENDER_MISS_HYDRATION_NOISE });

	// ─ テストケース: 1 枚も送らないうちに候補画像が全件取得されている ─
	// 手順:
	//   1. Resource Timing のバッファを拡張し、複数候補の detail と遅延画像をモックする
	//   2. 投票画面を開き、カードが操作できる状態になるまで待つ
	//   3. **まだ 1 枚目に居る**ことをガードする（送ってしまうと「先読みのおかげ」と言えない）
	//   4. 候補画像 4 枚すべての取得が完了していることを検証する
	test("投票画面を開いた時点で候補画像が全件取得されている", async ({ appPage }) => {
		await preparePreloadScreen(appPage);

		// 偽の緑の構造的排除: まだ 1 枚目に居ることを確かめてから先読みを見る。
		// 送った後に見ると「送ったから取れた」のか「先読みで取れた」のかが区別できない
		await expect(appPage.getByText(`1 / ${PRELOAD_CANDIDATE_COUNT}`)).toBeVisible();

		await expect
			.poll(() => collectCompletedCandidateImageIndexes(appPage), {
				message: "送る前に取得が完了していない候補画像がある（先読みが効いていない）",
			})
			.toEqual(PRELOAD_CANDIDATE_INDEXES);
	});

	// ─ テストケース: 送った先の候補画像は、送る前に取得が始まっていた ─
	// 手順:
	//   1. 同じ前準備
	//   2. 送る **直前**に performance.now() を控える（advancedAt）
	//   3. 最後の候補まで «好き» で送り、そのつどカードに出ている画像を観測する
	//   4. 各画像について「その取得が advancedAt より前に始まっていること」「decode に
	//      成功していること」を検証する
	test("送った先の候補画像は、送るより前に取得が始まっている", async ({ appPage }) => {
		await preparePreloadScreen(appPage);

		// 先読みが終わってから測り始める（取得完了そのものはこのテストの主題ではない）
		await expect.poll(() => collectCompletedCandidateImageIndexes(appPage)).toEqual(PRELOAD_CANDIDATE_INDEXES);

		const advancedAt = await appPage.evaluate(() => performance.now());

		const likeButton = appPage.getByTestId("dish-category-group-vote-like-button");
		for (let index = 1; index < PRELOAD_CANDIDATE_COUNT; index += 1) {
			await likeButton.click();

			// 「その候補のカードに切り替わった」ことを状態で待つ。時間では待たない
			await expect
				.poll(() => readDisplayedCandidateImage(appPage).then((image) => image?.index ?? null), {
					message: `${index + 1} 枚目の候補カードへ切り替わらない`,
				})
				.toBe(index);

			const displayed = await readDisplayedCandidateImage(appPage);
			expect(displayed, `${index + 1} 枚目の候補画像がカードに出ていない`).not.toBeNull();

			// happens-before の検証。先読みが外れるとここが必ず崩れる。
			// ⚠️ ここを expect.poll に包まないこと。「送る前に取得が始まったか」は
			//    待てば真になる類の条件ではなく、poll にすると感度が死ぬ
			const startTime = await findResourceStartTime(appPage, candidateImageUrl(index));
			expect(startTime, `${index + 1} 枚目の候補画像に取得エントリが無い`).not.toBeNull();
			expect(
				startTime as number,
				`${index + 1} 枚目の候補画像の取得が «送った後» に始まっている（＝先読みされていない）`,
			).toBeLessThan(advancedAt);

			// 補助: 即時性ではなく健全性（画像が壊れていない / decode に成功している）の検証。
			// 上の 1 回きりの観測と違い「いずれ真になる」性質なので poll で待ってよい
			await expect
				.poll(() => readDisplayedCandidateImage(appPage).then((image) => image?.decoded ?? false), {
					message: `${index + 1} 枚目の候補画像の decode に失敗している`,
				})
				.toBe(true);
		}
	});
});

/**
 * 投票画面を「複数候補・画像は遅延」の状態で開き、カードが操作できるところまで整える。
 *
 * @param page 対象ページ（匿名セッション確立済みの appPage）
 */
async function preparePreloadScreen(page: import("@playwright/test").Page): Promise<void> {
	// Resource Timing のバッファは既定 250 件。溢れると先読みのエントリが落ちて **偽の赤**になるため、
	// 最初のリクエストより前（= goto 前）に拡張しておく
	await page.addInitScript(() => performance.setResourceTimingBufferSize(1000));

	await mockMultiCandidateVoteDetail(page);
	await mockCandidateImages(page);

	await page.goto(voteScreenPath());

	await expect(page.getByTestId("dish-category-group-vote-like-button")).toBeVisible();
}
