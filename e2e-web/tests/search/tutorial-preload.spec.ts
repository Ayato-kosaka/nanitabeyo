// test / expect は必ず fixtures/test から import する(@playwright/test の直 import は型のみ)
import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import {
	PRELOAD_ASSET_KEYS,
	collectCompletedPreloadAssetKeys,
	findResourceStartTime,
	matchPreloadAssetKey,
} from "../../utils/preload-assets";

/**
 * 🖼️ 先読み画像(PRELOAD_IMAGES)の即時表示テスト(#1083 / 親 #1082)
 *
 * 目的: チュートリアル等を開いた瞬間に画像が「白 → 表示」にならないこと、すなわち
 *       **開く前に取得が完了している**ことを保証する。
 *
 * ## なぜ既存の search-tutorial.spec.ts に同居させないか
 * 既存 spec はファイル冒頭で `test.use({ seedTutorialSeen: false })` しており、要求が真逆になる。
 * このテストが必要とするのは「チュートリアルが **自動表示されていない**」状態
 * (= 既読シード有り、fixtures の既定値)。自動表示されてしまうと、シート自身の描画で画像が
 * 取得されるため「先読みブロックのおかげで取得された」と言えなくなり、
 * **先読みを外しても緑になる偽の緑**になる。
 * そのため `test.use` を一切書かない新規ファイルに分けている(無タグ = Tier 2 / desktop-chrome のみ)。
 *
 * ## 観測の原則(#1083 設計 §6)
 * 絶対時間の閾値も固定 sleep も使わない。使うのは 4 つとも **状態**:
 * ①エントリの存在 ②`responseEnd > 0`(取得完了) ③`startTime < clickedAt`(開く前に始まった)
 * ④`naturalWidth > 0`(decode 健全性)。「ランナーが遅い」では赤くならない。
 */
test.describe("先読み画像(PRELOAD_IMAGES)", () => {
	// ─ テストケース: チュートリアルを開く前に先読み画像の取得が完了している ─
	// 手順:
	//   1. Resource Timing のバッファを拡張し、検索画面を開く(openSearchWithoutTutorial)
	//   2. チュートリアルが自動表示されていないことをガードする
	//   3. 先読み対象 8 アセットすべての取得が完了していることを検証
	// 補足: 期待値をキーのソート済み配列にしているため、1 枚だけ脱落した回帰も
	//       そのアセット名が名指しでレポートに出る
	test("チュートリアルを開く前に先読み画像の取得が完了している", async ({ page }) => {
		await openSearchWithoutTutorial(page);

		await expect
			.poll(() => collectCompletedPreloadAssetKeys(page), {
				message: "先読み対象アセットの取得が完了していない",
			})
			.toEqual(PRELOAD_ASSET_KEYS);
	});

	// ─ テストケース: 開いたチュートリアルの画像は開く前に取得済みの URL である ─
	// 手順:
	//   1. 同じ前準備(openSearchWithoutTutorial)
	//   2. ヘルプボタン押下の **直前**に performance.now() を控える(clickedAt)
	//   3. チュートリアルを開き、操作できる状態になるまで待つ(固定 sleep なし)
	//   4. シート内に描画されている <img> をすべて取得する
	//   5. 各画像について「先読み対象の URL であること」「その取得が clickedAt より前に
	//      始まっていること」「decode に成功していること」を検証
	// 補足: 描画枚数は固定でアサートしない。FlatList の描画戦略が変わっても
	//       「描画されている img すべてが条件を満たす」形なら壊れないため
	test("開いたチュートリアルの画像は開く前に取得済みの URL である", async ({ page }) => {
		const searchPage = await openSearchWithoutTutorial(page);

		const clickedAt = await page.evaluate(() => performance.now());
		await searchPage.openTutorial();

		await expect.poll(() => searchPage.tutorialImages.count()).toBeGreaterThan(0);
		const images = await searchPage.tutorialImages.evaluateAll((elements) =>
			(elements as HTMLImageElement[]).map((image) => ({
				// .src はプロパティ経由なので絶対 URL になり、Resource Timing の entry.name と直接突き合わせられる
				src: image.src,
				naturalWidth: image.naturalWidth,
				complete: image.complete,
			})),
		);

		for (const image of images) {
			// 先読みとシートで URL が食い違う回帰(リサイズ付与など)はここで落ちる
			const key = matchPreloadAssetKey(new URL(image.src).pathname);
			expect(key, `シート内の画像が先読み対象の URL パターンに一致しない: ${image.src}`).not.toBeNull();

			// happens-before の検証。先読みブロックが消えるとここが必ず崩れる
			const startTime = await findResourceStartTime(page, image.src);
			expect(startTime, `${key} の取得エントリが存在しない: ${image.src}`).not.toBeNull();
			expect(startTime as number, `${key} の取得がチュートリアルを開いた後に始まっている`).toBeLessThan(clickedAt);

			// 補助: 即時性ではなく健全性(画像が壊れていない / decode に成功している)の検証
			expect(image.naturalWidth, `${key} の decode に失敗している`).toBeGreaterThan(0);
			expect(image.complete, `${key} の読み込みが完了していない`).toBe(true);
		}
	});
});

/**
 * 検索画面を開き、「チュートリアルが自動表示されていない」ところまで整える。
 *
 * @param page 対象ページ
 * @returns 開いた検索画面の Page Object
 */
async function openSearchWithoutTutorial(page: Page): Promise<SearchPage> {
	// Resource Timing のバッファは既定 250 件。溢れると先読みのエントリが落ちて **偽の赤**になるため、
	// 最初のリクエストより前(= goto 前)に拡張しておく
	await page.addInitScript(() => performance.setResourceTimingBufferSize(1000));

	const searchPage = new SearchPage(page);
	await searchPage.goto();
	await searchPage.expectLoaded();

	// 偽の緑の構造的排除: チュートリアルが開いていると、シート自身の描画で画像が取得されてしまい
	// 「先読みのおかげで取得された」と言えなくなる
	await expect(page.getByText("食べたい料理に気づけるアプリ")).toHaveCount(0);

	return searchPage;
}
