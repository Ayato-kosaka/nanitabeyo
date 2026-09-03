import { test, expect } from "../../fixtures/test";
import { PRERENDER_MISS_HYDRATION_NOISE } from "../../utils/consoleNoise";
import { LegalPage } from "../../pages/LegalPage";
import { SettingsPage } from "../../pages/SettingsPage";

/**
 * 📜 法務ドキュメント画面（`/[locale]/legal/[doc]`）のテスト
 *
 * 目的: 「法務文書は URL で指せる」という #1368 の目的そのものを保証する。
 *
 * ## ここが守るもの
 * 1. **直リンクで開けること** — 共有・ブックマーク・ストア審査・sitemap の前提。
 *    モーダルへ戻す変更を入れると URL 直叩きで開けなくなり、ここが落ちる
 * 2. **公開していない `doc` を既定の文書へ倒さないこと** — 倒すと
 *    `/legal/<任意の文字列>` が全部 200 の複製ページになる（`app-expo/lib/legalRoute.ts`）
 * 3. **戻る導線** — 設定から入っても、直リンクで着地しても行き止まりにならないこと
 */
test.describe("法務ドキュメント画面", () => {
	// ─ テストケース: 4 文書すべてに直リンクで到達できる ─
	// sitemap（app-expo/lib/seo/sitemap.ts）へ載せた 4 本と同じ集合。
	// prerender / ルーティングのどれかが欠けると、ここで落ちる
	// 手順:
	//   1. /ja-JP/legal/<doc> へ直接遷移する
	//   2. URL がその文書のままで、本文コンテナが表示されることを検証
	for (const doc of ["guidelines", "terms", "privacy", "copyright"]) {
		test(`/legal/${doc} へ直リンクで到達できる`, async ({ appPage }) => {
			const legalPage = new LegalPage(appPage);

			await legalPage.goto(doc);
			await legalPage.expectOpened(doc);
		});
	}

	// ─ テストケース: 公開していない doc は not-found へ倒れる ─
	// ⚠️ ここが「既定の文書を出す」実装に変わると重複コンテンツを量産する。
	//    本文コンテナが 0 件であることまで見るのはそのため
	// 手順:
	//   1. /ja-JP/legal/tos（存在しない文書）へ直接遷移する
	//   2. not-found 表示が出て、本文コンテナが描かれないことを検証
	test.describe("公開していない doc", () => {
		// #1629 存在しない doc は prerender されておらず SPA フォールバックの index.html で返るため、
		// hydration 不一致が構造上必ず出る（utils/consoleNoise.ts。正本は tests/smoke/deep-link.spec.ts）
		test.use({ allowedConsoleErrors: PRERENDER_MISS_HYDRATION_NOISE });

		test("公開していない doc は not-found を出し、既定の文書へ倒れない", async ({ appPage }) => {
			const legalPage = new LegalPage(appPage);

			await legalPage.goto("tos");
			await legalPage.expectNotFound();
		});
	});

	// ─ テストケース: マイページの設定項目から開いて戻れる ─
	// #1368 モーダル時代は「閉じる」で設定へ戻っていた。ルート化後は履歴の pop になる。
	// 手順:
	//   1. 設定画面を表示する
	//   2. 利用規約行をクリックし、/legal/terms へ遷移することを検証
	//   3. ヘッダーの戻るボタンで離脱し、マイページへ戻ることを検証
	test("マイページの利用規約行から開き、戻るボタンでマイページへ帰る", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		const legalPage = new LegalPage(appPage);

		// #1583 規約は «なに食べよについて» へ移った。マイページからの導線ごと踏む
		await settingsPage.goto();
		await settingsPage.expectLoaded();
		await settingsPage.openAbout();

		await settingsPage.termsItem.click();
		await legalPage.expectOpened("terms");

		await legalPage.goBack();

		// #1583 規約は «なに食べよについて» から開いたので、戻り先もそこ
		await expect(appPage).toHaveURL(/\/ja-JP\/profile\/about$/);
		await expect(settingsPage.termsItem).toBeVisible();
	});

	// ─ テストケース: ブラウザバックでも «なに食べよについて» へ戻る ─
	// #1368 【設計】戻る責務を Navigator へ渡したこと自体の検証。モーダル時代は
	// ブラウザバックがモーダルを閉じずにタブごと戻していた（URL が変わらないため）。
	// 手順:
	//   1. マイページからプライバシーポリシーを開く
	//   2. ブラウザバックする
	//   3. マイページへ戻ることを検証
	test("ブラウザバックでマイページへ戻る", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		const legalPage = new LegalPage(appPage);

		// #1583 規約は «なに食べよについて» へ移った。マイページからの導線ごと踏む
		await settingsPage.goto();
		await settingsPage.expectLoaded();
		await settingsPage.openAbout();

		await settingsPage.privacyItem.click();
		await legalPage.expectOpened("privacy");

		await appPage.goBack();

		// #1583 規約は «なに食べよについて» から開いたので、戻り先もそこ
		await expect(appPage).toHaveURL(/\/ja-JP\/profile\/about$/);
		await expect(settingsPage.termsItem).toBeVisible();
	});

	// ─ テストケース: 履歴が無い着地でも行き止まりにならない ─
	// #1368 【設計】検索結果・共有リンク・ストア審査からの着地は履歴を持たない。
	// `router.canGoBack()` が false のとき、戻る導線はマイページへの replace に倒れる
	// （#1402 以前は設定画面へ倒れていた。その画面が無くなったので行き先が変わった）。
	// 手順:
	//   1. /ja-JP/legal/terms へ直接着地する（履歴なし）
	//   2. ヘッダーの戻るボタンを押す
	//   3. マイページへ着地することを検証
	test("直リンク着地から戻るとマイページへ倒れる", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		const legalPage = new LegalPage(appPage);

		await legalPage.goto("terms");
		await legalPage.expectOpened("terms");

		await legalPage.goBack();

		// #1402 設定は独立した画面ではなくマイページの縦リストになった
		await expect(appPage).toHaveURL(/\/ja-JP\/profile$/);
		await settingsPage.expectLoaded();
	});
});
