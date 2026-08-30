import { test, expect } from "../../fixtures/test";
import { PRERENDER_MISS_HYDRATION_NOISE } from "../../utils/consoleNoise";
import { SnsImportPage } from "../../pages/SnsImportPage";

/**
 * 📥 SNS 取り込み画面（#1400 PR4 → #1375 実機確認で «貼り付けて取り込む» 画面へ）
 *
 * ## #1375 実機確認で変わったこと
 *
 * 3 状態の掲示板（confirm / expandPending / unsupported の器を排他で出すだけ）ではなくなった。
 * いまは **入口が 2 つ（OS の共有シート / my-dishes の ＋ ボタン）で着地は 1 つ**の画面で、
 * 主役は URL の貼り付け欄である。`?url=` があれば初期値に入り、無ければ空で開く。
 *
 * ⚠️ **貼られた文字列が画面に出るのは仕様**（編集できる入力欄なので）。旧 spec の
 * 「生の共有テキストを画面へ出さない」は前提ごと変わった。代わりに
 * «対応外なら対応 provider を必ず明示する» を検知点として残している。
 *
 * ## なぜ E2E で守るのか（ユニットテストがあるのに）
 * `app-expo/__tests__/snsImportRoute.test.tsx` は **react-test-renderer のツリー**を見ており、
 * i18n も `key` をそのまま返すモックである。つまりユニットテストが通っていても、
 * 次の 3 つは 1 つも保証されていない。
 *
 * 1. `/{locale}/add-record?url=…` が **静的エクスポート + Hosting の rewrite 越しに開けるか**
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
 * この spec はネットワークへ取りに行かない。貼り付け欄の見た目の判定は
 * `parseSnsUrl()`（文字列の形だけで判定する純関数）で閉じている。
 *
 * ⚠️ **「読み取る」「食べたいに保存」は押さない。** どちらも実 API を叩くので、実装が壊れたのか
 * 外部 provider / dev DB が変わったのかを区別できないテストになる。押下を伴う検証は
 * mock を用意した別 spec の責務とし、ここは «配信経路・文言・戻る» の 3 つを守る。
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

test.describe("SNS 取り込み画面(#1400 / #1375)", () => {
	test.use({ allowedConsoleErrors: PRERENDER_MISS_HYDRATION_NOISE });

	// ─ テストケース: 共有された URL が貼り付け欄の初期値に入る ─
	// 手順:
	//   1. YouTube Shorts / TikTok / Instagram の投稿 URL でそれぞれ画面を直接開く
	//   2. 貼り付け欄の値が **共有された URL そのもの**であることを検証
	//   3. 「非対応」の説明が出ていないことを検証（対応 provider を非対応に倒していない）
	test("共有された URL が貼り付け欄に入り、非対応にはならない", async ({ page }) => {
		const snsImportPage = new SnsImportPage(page);

		for (const shared of [YOUTUBE_SHORTS_URL, TIKTOK_POST_URL, INSTAGRAM_REEL_URL]) {
			await snsImportPage.goto(shared);

			expect(await snsImportPage.inputValue()).toBe(shared);
			await expect(snsImportPage.unsupportedDescription).toBeHidden();
		}
	});

	// ─ テストケース: ＋ ボタンから開いた形（url 無し）でも入力欄が出る ─
	// 手順:
	//   1. `?url=` を付けずに画面を開く
	//   2. 貼り付け欄が空で出ていることを検証（空白の画面にしない）
	//   3. まだ何も貼っていないので「非対応」とは言わないことを検証
	//   4. 「読み取る」が押せない状態であることを検証
	//
	// #1375 実機確認: ＋ の基本導線がこの経路である。旧仕様は url 無しを unsupported に
	// 倒していたが、いまは «これから貼る» 状態なので «非対応» と言ってはいけない。
	test("url 無しで開くと空の貼り付け欄が出る（非対応とは言わない）", async ({ page }) => {
		const snsImportPage = new SnsImportPage(page);

		await snsImportPage.goto();

		await expect(snsImportPage.urlInput).toBeVisible();
		expect(await snsImportPage.inputValue()).toBe("");
		await expect(snsImportPage.unsupportedDescription).toBeHidden();
		await expect(snsImportPage.resolveButton).toBeDisabled();
	});

	// ─ テストケース: 短縮 URL は「非対応」ではなく「展開の案内」になる ─
	// 手順:
	//   1. TikTok アプリの共有ボタンが出す短縮 URL で画面を開く
	//   2. 展開の案内が出ていて、**非対応の説明が出ていない**ことを検証
	//
	// ここが混ざると TikTok の主要導線が丸ごと「非対応」に見える（設計 §3）。
	test("短縮 URL は非対応ではなく展開の案内として受ける", async ({ page }) => {
		const snsImportPage = new SnsImportPage(page);

		await snsImportPage.goto(TIKTOK_SHORTLINK_URL);
		await snsImportPage.expectShortlinkNotTreatedAsUnsupported();
	});

	// ─ テストケース: 対応外の URL は対応 provider を明示する ─
	// 手順:
	//   1. 対応外の URL（X）を貼り付け欄へ入れる
	//   2. 「対応しているのは TikTok / YouTube Shorts / Instagram」が **文字で** 出ることを検証
	//
	// 黙って落とさない、が設計 §3 の要求。文言が引けずに空になっていないかもここで見る。
	test("対応外 URL は対応 provider を明示する", async ({ page }) => {
		const snsImportPage = new SnsImportPage(page);

		await snsImportPage.goto();
		await snsImportPage.paste(UNSUPPORTED_URL);

		await expect(snsImportPage.unsupportedDescription).toBeVisible();
		const text = await snsImportPage.visibleText();
		expect(text).toContain("TikTok");
		expect(text).toContain("YouTube Shorts");
		expect(text).toContain("Instagram");
	});

	// ─ テストケース: ゲストが「食べたを記録」を押すとログインへ送られる ─
	// 手順:
	//   1. 画面を開く（この project は匿名セッションで動く）
	//   2. 上部タブ「食べたを記録」を押す
	//   3. ログイン画面へ着くことを検証
	//
	// **取り込みと「食べた」でログインの要否が違う**ことがこの画面の肝である。
	//   - 取り込み … ログイン不要。`dish_media.user_id` は NULL のままで、ユーザーとの紐付けは
	//     `reactions(save)` が持つ。匿名ユーザーも実 user id を持つので save は書ける（#1375）
	//   - 「食べた」… `dish_reviews` を書く公開レビューなのでログインが要る
	//
	// ログイン済みで «上部タブ → 店舗選択» まで抜けられることの証跡は
	// `tests/authenticated/review-post.spec.ts`（`openEatenRecordFlow()`）が持つ。
	// この project は匿名なので、ここで押さえるのは «ログインへ送られる» 側である。
	test("ゲストが「食べたを記録」を押すとログイン画面へ送られる", async ({ page }) => {
		const snsImportPage = new SnsImportPage(page);

		await snsImportPage.goto();
		await snsImportPage.eatenTab.click();

		await expect(page).toHaveURL(/\/auth\/login/);
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

		await snsImportPage.backButton.click();

		await expect(page).toHaveURL(/\/ja-JP\/my-dishes(\?|$)/);
		await expect(snsImportPage.screen).toBeHidden();
	});
});
