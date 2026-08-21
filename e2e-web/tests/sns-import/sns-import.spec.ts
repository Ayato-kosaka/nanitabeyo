import { test, expect } from "../../fixtures/test";
import { SnsImportPage } from "../../pages/SnsImportPage";

/**
 * 📥 SNS 取り込み確認画面の 3 状態（#1400 PR4）
 *
 * ## なぜ E2E で守るのか（ユニットテストがあるのに）
 * `app-expo/__tests__/snsImportRoute.test.tsx` は **react-test-renderer のツリー**を見ており、
 * i18n も `key` をそのまま返すモックである。つまりユニットテストが通っていても、
 * 次の 3 つは 1 つも保証されていない。
 *
 * 1. `/{locale}/sns-import?url=…` が **静的エクスポート + Hosting の rewrite 越しに開けるか**
 *    （クエリ前提の画面なので sitemap から外してある。#1400 `sitemap.test.ts`。
 *      配信経路の穴は過去に #281 で実際に起きている）
 * 2. 文言が **実際に描かれるか**（キーが引けずに空の画面になっていないか）
 * 3. 履歴が無い状態で戻ったとき、**本当に my-dishes へ着くか**（`router.canGoBack()` の分岐は
 *    モックでは「呼ばれたこと」しか見られない）
 *
 * 共有は「アプリを切り替えてまで持ってきた操作」なので、着地が空白や「非対応」に見えるのが
 * 一番悪い。ここはその «実ブラウザでの証跡» を置く場所である。
 *
 * ## `page`（`appPage` ではない）を使う理由
 * この画面は API を 1 つも叩かない（判定は `shared/utils/snsUrl.ts` の純関数だけ）。そして
 * 検証したいのは **「共有から直接この URL へ着地した」= 履歴もアプリ内遷移も無い状態**である。
 * `appPage` は先にトップを開くので、その前提が崩れる。匿名セッション自体は
 * `desktop-chrome` プロジェクトの共有 storageState で既に入っているため、
 * レート制限（README「匿名セッションの共有」）にも影響しない。
 *
 * ## ここで使う URL は実在しなくてよい
 * 画面もこの spec もネットワークへ取りに行かない。`parseSnsUrl()` は文字列の形だけで判定する。
 */

/** YouTube Shorts の投稿 URL（ID は 11 文字固定） */
const YOUTUBE_SHORTS_URL = "https://www.youtube.com/shorts/abcdefghijk";
/** TikTok の投稿 URL（ID は 19 桁の数字） */
const TIKTOK_POST_URL = "https://www.tiktok.com/@nanitabeyo/video/7412345678901234567";
/** Instagram の reel URL */
const INSTAGRAM_REEL_URL = "https://www.instagram.com/reel/ABCdef12345/";
/**
 * TikTok アプリの共有ボタンが出す短縮 URL。
 * **ここが「非対応」に倒れると TikTok の主要導線が丸ごと死ぬ**（設計 §3 / `SnsUrlShortlink` の doc）。
 */
const TIKTOK_SHORTLINK_URL = "https://vm.tiktok.com/ZSAbCd123/";
/** 対応外の URL。X は #1399 のリーダー確定で対象外 */
const UNSUPPORTED_URL = "https://x.com/nanitabeyo/status/1234567890";

test.describe("SNS 取り込み確認画面(#1400)", () => {
	// ─ テストケース: 取り込める URL は 3 provider とも confirm 状態になる ─
	// 手順:
	//   1. YouTube Shorts / TikTok / Instagram の投稿 URL でそれぞれ画面を直接開く
	//   2. `sns-import-confirm` だけが出ていることを検証（他 2 状態が出ていないことまで見る）
	//   3. provider 名と canonical URL が出ていることを検証
	//   4. 「保存は準備中」が **文字で** 出ていることを検証（無言で終わる画面にしない。設計 §3）
	test("取り込める URL は provider と canonical URL つきで確認状態になる", async ({ page }) => {
		const snsImportPage = new SnsImportPage(page);

		const cases = [
			{ shared: YOUTUBE_SHORTS_URL, provider: "YouTube Shorts", canonical: YOUTUBE_SHORTS_URL },
			{ shared: TIKTOK_POST_URL, provider: "TikTok", canonical: TIKTOK_POST_URL },
			{ shared: INSTAGRAM_REEL_URL, provider: "Instagram", canonical: INSTAGRAM_REEL_URL },
		];

		for (const { shared, provider, canonical } of cases) {
			await snsImportPage.goto(shared);
			await snsImportPage.expectOnlyStateVisible("confirm");
			await expect(snsImportPage.provider).toHaveText(provider);
			await expect(snsImportPage.url).toHaveText(canonical);
			// #1399 PR7/PR11 が入るまで保存できない。押せないボタンではなく文字で伝える契約
			await expect(snsImportPage.confirmPending).not.toBeEmpty();
		}
	});

	// ─ テストケース: 短縮 URL は「非対応」ではなく「準備中」になる ─
	// 手順:
	//   1. vm.tiktok.com の短縮 URL で画面を直接開く
	//   2. `sns-import-expand-pending` だけが出ていることを検証
	//   3. **`sns-import-unsupported` が出ていないこと**を明示的に検証（この PR の主眼）
	//   4. provider が TikTok と分かること、準備中である旨が文字で出ていることを検証
	//
	// TikTok アプリの共有ボタンが出すのはこの形なので、ここが unsupported に倒れると
	// 「TikTok から共有した人は全員 非対応と言われる」ことになる。
	test("短縮 URL は非対応ではなく展開準備中として受ける", async ({ page }) => {
		const snsImportPage = new SnsImportPage(page);

		await snsImportPage.goto(TIKTOK_SHORTLINK_URL);

		await snsImportPage.expectOnlyStateVisible("expandPending");
		await expect(snsImportPage.unsupported, "短縮 URL が「非対応」に倒れている").toBeHidden();
		await expect(snsImportPage.provider).toHaveText("TikTok");
		// 「準備中」であることが文字で伝わっているか（ja-JP.json: SnsImport.expandPending.description）
		await expect(snsImportPage.expandPending).toContainText("準備中");
	});

	// ─ テストケース: 対応外 URL は対応 provider を明示して落とす ─
	// 手順:
	//   1. x.com の URL で画面を直接開く
	//   2. `sns-import-unsupported` だけが出ていることを検証
	//   3. 説明文に対応 3 provider がすべて挙がっていることを検証（黙って落とさない。設計 §3）
	//   4. 生の共有 URL が画面へ出ていないことを検証
	//
	// 4 は `resolveSnsShareIntakeView()` を通した値だけを描く契約の検知点。第三者が作った任意の
	// 文字列をそのまま描くと、共有テキストを画面へ素通しすることになる。
	test("対応外 URL は対応 provider を明示し、生の URL を画面へ出さない", async ({ page }) => {
		const snsImportPage = new SnsImportPage(page);

		await snsImportPage.goto(UNSUPPORTED_URL);

		await snsImportPage.expectOnlyStateVisible("unsupported");
		for (const provider of ["TikTok", "YouTube Shorts", "Instagram"]) {
			await expect(snsImportPage.unsupportedDescription).toContainText(provider);
		}

		expect(await snsImportPage.visibleText(), "生の共有 URL が画面へ露出している").not.toContain("x.com");
	});

	// ─ テストケース: url を付けずに開いても空の画面にならない ─
	// 手順:
	//   1. `?url=` 無しで画面を直接開く（ログイン往復で落ちた / 直接ブックマークされた等）
	//   2. `sns-import-unsupported` だけが出ていることを検証
	//   3. タイトルと説明文が出ていることを検証（真っ白な画面を出さない）
	test("url 無しで開いても対応 provider の案内が出る", async ({ page }) => {
		const snsImportPage = new SnsImportPage(page);

		await snsImportPage.goto();

		await snsImportPage.expectOnlyStateVisible("unsupported");
		await expect(snsImportPage.title).not.toBeEmpty();
		await expect(snsImportPage.unsupportedDescription).not.toBeEmpty();
	});

	// ─ テストケース: 画面に出るのは canonical だけ（トラッキングパラメータが混ざらない）─
	// 手順:
	//   1. `?igsh=…` 付きの Instagram URL で画面を直接開く
	//   2. confirm 状態になることを検証
	//   3. 表示された URL が canonical（クエリ無し）であることを検証
	//   4. 画面のどこにも `igsh` の値が出ていないことを検証
	//
	// 画面は `url` を «そのまま» 描いてはいけない（生の共有テキストを画面へ出さない契約）。
	// ここが崩れると、共有した人を特定しうる値がそのまま画面へ出る。
	test("表示される URL は canonical だけでトラッキングパラメータを含まない", async ({ page }) => {
		const snsImportPage = new SnsImportPage(page);

		await snsImportPage.goto(`${INSTAGRAM_REEL_URL}?igsh=SHARER_TRACKING_VALUE`);

		await snsImportPage.expectOnlyStateVisible("confirm");
		await expect(snsImportPage.url).toHaveText(INSTAGRAM_REEL_URL);
		expect(await snsImportPage.visibleText(), "トラッキングパラメータが画面へ露出している").not.toContain(
			"SHARER_TRACKING_VALUE",
		);
	});

	// ─ テストケース: 履歴が無いときの戻るは my-dishes へ着く ─
	// 手順:
	//   1. ブラウザで直接この画面を開く（= 共有からの着地と同じく、アプリ内の履歴が無い状態）
	//   2. ヘッダの戻るボタンを押す
	//   3. `/ja-JP/my-dishes`（取り込んだものが並ぶ場所）へ着いていることを検証
	//
	// `router.back()` のままだと、履歴が無いときに «どこへも行かない» 画面になる。
	// 共有からの着地は「アプリ未起動 → 起動 → ここ」を通るので、これは例外ではなく主要経路。
	test("履歴が無い状態で戻ると食べたい/食べたタブへ着く", async ({ page }) => {
		const snsImportPage = new SnsImportPage(page);

		await snsImportPage.goto(TIKTOK_POST_URL);
		await snsImportPage.expectOnlyStateVisible("confirm");

		await snsImportPage.backButton.click();

		await expect(page).toHaveURL(/\/ja-JP\/my-dishes(\?|$)/);
		await expect(snsImportPage.screen).toBeHidden();
	});
});
