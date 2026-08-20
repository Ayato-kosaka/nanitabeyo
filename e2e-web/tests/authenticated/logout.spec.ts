import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { SettingsPage } from "../../pages/SettingsPage";
import { TabBar } from "../../pages/TabBar";
import { MyDishesPage } from "../../pages/MyDishesPage";
import { readStoredSessionUser, supabaseStorageKey } from "../../utils/auth";
import { loadTestUserCredentials, signInTestUser } from "../../utils/testUserSession";

/**
 * 🚪 ログアウトの E2E（#1131 / 回帰対象 #1124）
 *
 * ## 目的
 * #1124 では「ログアウトすると (1) ホーム（検索画面）へ戻らない (2) 以降の API 呼び出しが
 * 全滅する (3) 画面が固まる」という 3 症状が同時に起きていたのに、認証まわりの E2E が
 * 1 本も無かったため実機で触るまで誰も気付けなかった。この spec はその 3 点をまとめて守る。
 *
 * OAuth（Google/Apple）の実往復は自動化できない（外部 IdP の bot 検知・規約）が、
 * ログアウトはセッション注入で作った「ログイン済み状態」から開始できるため、
 * OAuth を一切通さずに書ける。ここが #1124 の 3 症状すべての合流点になっている。
 *
 * ## Tier
 * Tier 2（無タグ）。dev DB のアプリデータには一切書き込まないため `@mutation` は付けない
 * （tests/search/search-double-tap.spec.ts と同じ判断）。実行プロジェクトは
 * `desktop-chrome-authenticated` のみで、@smoke（＝全ブラウザ実行）にもしない
 * ＝ ログアウト 1 回につき匿名サインインを 1 回消費するため、ブラウザ数だけ枠を増やしたくない。
 *
 * ## セッションの独立性（⚠️ 共有 storageState を使ってはいけない）
 * このファイルは `desktop-chrome-authenticated` プロジェクトが渡す共有 storageState
 * (.auth/user.json) を **意図的に捨てて**、テスト内で発行した専用セッションを注入する。
 *
 * アプリの `handleLogout` は `logout({ scope: "local" })` を呼ぶが、これは
 * ローカルの localStorage を消すだけではなく `POST /auth/v1/logout?scope=local` で
 * **そのセッションをサーバ側でも失効させる**。共有 storageState のセッションでログアウトすると、
 * 並列実行中/後続の authenticated テストが同じリフレッシュトークンを使えなくなり、
 * `setSession()` が 403 になって「ログイン済みなのにゲスト扱い」で軒並み落ちる（実測済み）。
 *
 * 専用セッションなら、失効するのはこのテストが自分で作ったセッションだけなので、
 * fullyParallel: true のまま他の spec と安全に同時実行できる。
 *
 * ## 匿名サインインのレート制限（30 回/時/IP・dev/prod 同一プロジェクト）への配慮
 * ログアウト後の匿名セッション再確立は **この spec の検証対象そのもの** なので、
 * ここだけは共有匿名 storageState（ANON_STORAGE_STATE_PATH）で代替できず、実際に 1 回消費する。
 * そのぶん消費を最小化するため:
 * - 「ホームへ戻る」「固まらない」「API が成功する」を **1 テスト内で** 検証する
 *   （テストを 3 本に割ると 1 回の実行で 3 回消費してしまう）
 * - ログアウト後にページをリロードしない（リロードのたびに匿名サインインが走りうる）
 * 結果、この spec がフル実行で消費する匿名サインインは **1 回だけ** である。
 * （専用セッションの signInWithPassword は匿名サインインとは別の枠なので影響しない）
 */
const credentials = loadTestUserCredentials();

test.skip(() => credentials === null, "TEST_USER_EMAIL / TEST_USER_PASSWORD(e2e-web/.env)が未設定のためスキップ");

// 共有 storageState を捨てる（理由は上のコメント）。セッションはテスト内で注入する
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("ログアウト(ログイン済み)", () => {
	// ─ テストケース: ログアウトするとホームへ戻り、匿名セッションで使い続けられる ─
	// 手順:
	//   1. このテスト専用のログイン済みセッションを発行して localStorage へ注入する
	//   2. 設定画面を **URL 直開き** する（"/" を経由しない。理由は下記コメント）
	//   3. ログアウト行 → 確認ダイアログ「ログアウト」で確定する
	//   4. [症状1] ホーム(検索画面)へ遷移していることを検証
	//   5. [症状3] ログアウト直後に UI 操作が受け付けられることを検証
	//   6. [症状2] 匿名セッションが **別ユーザーとして** 再確立されたことを検証
	//   7. [症状2] 実 API(場所オートコンプリート)が成功することを検証
	test("ログアウトするとホームへ戻り、匿名セッションで API を続けられる", async ({ page }, testInfo) => {
		if (!credentials) return; // test.skip 済み。TypeScript の絞り込みのため
		const settingsPage = new SettingsPage(page);
		const searchPage = new SearchPage(page);
		const tabBar = new TabBar(page);
		const myDishesPage = new MyDishesPage(page);

		// このテスト専用のセッションを注入する（page.addInitScript は以降の遷移すべてで評価される）
		const session = await signInTestUser(credentials);
		await page.addInitScript(
			([key, value]) => {
				window.localStorage.setItem(key, value);
			},
			[supabaseStorageKey(credentials.supabaseUrl), JSON.stringify(session)] as const,
		);

		// ⚠️ `appPage` フィクスチャ（"/" から開始）を使わないこと。
		// #1124 の「ホームへ戻らない」症状のうち 1 つは、app/index.tsx が
		// «起動時 URL»（= Linking.getInitialURL()。web ではモジュール読み込み時の
		// window.location.href に束縛される）をディープリンクとして採り直し、
		// ログアウト後にまたマイページ（旧・設定画面）へ送り返す、というものだった。
		// "/" から開始すると index.tsx が起動時に一度マウントされて `hasConsumedInitialUrl` を
		// 消費してしまい、この経路が再現しなくなる。深い URL の直開き（実ユーザーの
		// ブックマーク・共有リンク・リロード）から始めることで、ログアウト時の
		// index.tsx マウントが «初回» になる条件を再現する。
		await settingsPage.goto();
		await settingsPage.expectLoaded();
		// ログアウト行の表示 ＝ AuthProvider が「ログイン済み(非匿名)」で決着した合図
		await expect(settingsPage.logoutItem).toBeVisible();

		// ログアウト前のユーザーを控える（後で「別の匿名ユーザーに変わったか」を見るため）
		const beforeUser = await readStoredSessionUser(page);
		expect(beforeUser, "ログアウト前にログイン済みセッションが存在すること").not.toBeNull();
		expect(beforeUser?.isAnonymous, "ログアウト前は非匿名ユーザーであること").toBe(false);

		// PW_FORCE_VISUALS=1 のときだけ証跡用のスクリーンショットを残す
		// （playwright.config.ts の screenshot/video スイッチと同じ運用。常用すると実行が重くなる）
		if (process.env.PW_FORCE_VISUALS) {
			await page.screenshot({ path: testInfo.outputPath("logout-before.png"), fullPage: true });
		}

		await settingsPage.logout();

		// ── [症状1] ログアウト後にホーム（検索画面）へ遷移する ──────────────
		// #1124 では router.replace が「匿名サインインの await の後の finally」に置かれていたため
		// デッドロックで到達せず、設定画面に留まっていた。
		//
		// ⚠️ 着地の判定に URL を使わないこと。expo-router の web では、この経路の着地 URL が
		// `/ja-JP/map`（タブに出さない隠しルート）になる実測がある。描画されているのは
		// 検索画面で、タブバーも「さがす」が選択された正しい状態なので、
		// 「どの画面が出ているか」で判定し、URL は「設定画面に留まっていないこと」だけを見る。
		await searchPage.expectLoaded();
		// #1402 設定は独立した画面ではなくマイページの縦リストになったので、
		// 「留まっていないこと」を見る URL も /profile/settings → /profile になった
		await expect(page).not.toHaveURL(/\/profile(\?|$)/);
		await expect(settingsPage.logoutItem).toHaveCount(0);

		// ── [症状3] 画面が固まらない ────────────────────────────────
		// ログアウト直後（＝匿名セッションの再確立を待たずに）UI 操作が受け付けられること。
		// API を伴わない純クライアント操作を選んでいる。ここで API を叩く操作を選ぶと
		// 「固まっていない」と「まだトークンが無いだけ」を区別できなくなるため。
		await searchPage.advancedToggle.click();
		await expect(searchPage.distanceSlider).toBeVisible();

		// ── [症状2] 匿名セッションが再確立されている ────────────────────
		// キーの有無ではなく「匿名ユーザーで、かつログアウト前とは別 ID」まで見る。
		// #1124 では supabase-js のロックがデッドロックしたまま解放されず、
		// signInAnonymously が永久に実行されなかった。
		await expect
			.poll(() => readStoredSessionUser(page).catch(() => null), {
				message: "ログアウト後に匿名セッションが再確立されなかった",
				timeout: 20_000,
			})
			.toMatchObject({ isAnonymous: true });
		const afterUser = await readStoredSessionUser(page);
		expect(afterUser?.id, "ログアウト後もログイン済みユーザーのセッションが残っている").not.toBe(beforeUser?.id);

		// ── [症状2] ログアウト後も API 呼び出しが成功する ────────────────
		// 実データを取得する画面で内容が出ることまで見る。場所オートコンプリートは
		// 「静的ビルド → CORS → Supabase の匿名 JWT → NestJS API → Google Places」を通るため、
		// 新しい匿名セッションの JWT が実際に通用していることの証明になる
		// （useAPICall はトークンが無いと送信前に unauthenticated で落ちるので、
		//   セッションが再確立できていなければサジェストは絶対に出ない）。
		await searchPage.typeLocation("渋谷");
		await expect(searchPage.locationSuggestions).toBeVisible();
		await expect(searchPage.locationSuggestion(0)).toBeVisible();

		// 「ホームに居る」「実 API のデータが出ている」が同時に写る、この時点を証跡にする
		if (process.env.PW_FORCE_VISUALS) {
			await page.screenshot({ path: testInfo.outputPath("logout-after.png"), fullPage: true });
		}

		// ── [症状3] タブ導線も生きている ───────────────────────────────
		// 併せて「ゲスト扱いに戻っている」ことも確認する（食べたい/食べたタブは匿名だとログイン CTA 表示）。
		await tabBar.gotoMyDishes();
		await myDishesPage.expectGuestViewLoaded();
	});
});
