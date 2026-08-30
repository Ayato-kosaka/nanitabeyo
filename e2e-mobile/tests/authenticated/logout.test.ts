import { strict as assert } from "node:assert";

import {
	describeAuthenticated,
	launchAppWithSession,
	visibleNow,
	waitUntil,
	waitUntilExists,
	waitUntilGone,
	waitUntilVisible,
	type E2ESession,
} from "../../fixtures/e2e";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { SearchScreen } from "../../screens/SearchScreen";
import { SettingsScreen } from "../../screens/SettingsScreen";
import { TabBar } from "../../screens/TabBar";
import { createDisposableAuthenticatedSession, revokeDisposableSession } from "../../utils/disposableSession";

/**
 * 🚪 ログアウトの E2E（#1131 / 回帰対象 #1124。e2e-web の tests/authenticated/logout.spec.ts に対応）
 *
 * ## 目的
 * #1124 では「ログアウトすると (1) ホーム（検索画面）へ戻らない (2) 以降の API 呼び出しが全滅する
 * (3) 画面が固まる」という 3 症状が同時に起きていたのに、認証まわりの E2E が 1 本も無かったため
 * 実機で触るまで誰も気付けなかった。この spec はその 3 点をまとめて守る。
 *
 * OAuth（Google/Apple）の実往復は自動化できない（外部 IdP の bot 検知・規約）が、ログアウトは
 * セッション注入で作った「ログイン済み状態」から開始できるため、OAuth を一切通さずに書ける。
 *
 * ## なぜ e2e-web の 1 本では足りないのか（= この spec の存在理由）
 * #1124 の症状は **Web とネイティブで別々に露出した**。`AuthProvider` の SIGNED_OUT ハンドラには
 * `Platform.OS !== "android"` の分岐があり、**e2e-web はこの分岐の片側しか通らない**。
 * 修正履歴（`c982ee10` / `e0fc1ef0` / `a8562970`）が示すとおり、ログアウト後のフリーズは
 * Android と iOS で原因も直し方も違った。さらに (3)「画面が固まる」は、Web では
 * 「supabase-js のロックが解放されない」＝ DOM 操作自体は効く形でしか現れないのに対し、
 * ネイティブでは **スプラッシュ固着や本当の無反応**として現れる。そこを見られるのはこちら側だけ。
 *
 * ## Tier
 * Tier 2（無タグ・tests/authenticated/ 配下）。dev DB のアプリデータには書き込まないため @mutation ではない。
 * `describeAuthenticated` により TEST_USER_* が無い環境（fork PR・初見のローカル）では spec ごと skip される。
 *
 * ## ⚠️ 共有セッションを使ってはいけない（専用セッションを発行する）
 * アプリの `handleLogout` は `logout({ scope: "local" })` を呼ぶが、これは端末のストレージを消すだけでなく
 * `POST /auth/v1/logout?scope=local` で **そのセッションをサーバ側でも失効させる**。
 * e2e-mobile は run 全体で 1 つのログイン済みセッションを共有しているため（utils/sessionEnv.ts）、
 * 共有セッションでログアウトすると後続の `tests/authenticated/` が軒並み落ちる。
 * そこで beforeAll で **この spec 専用のセッションを 1 つ発行**して注入する（utils/disposableSession.ts）。
 * e2e-web 版が `signInTestUser()` で同じ回避をしているのと同じ考え方。
 *
 * ## ⚠️ 注入ポリシーは `once`（そうしないとログアウトを検証できない）
 * `AuthProvider` の SIGNED_OUT ハンドラは `runAuthAttempt()` を呼び直し、その先頭で `injectTestSession()` が走る。
 * 既定（`always`）では「現在セッション=無し ≠ 期待ユーザー」と判定され、**ログアウトした直後に
 * ログイン済みセッションが注入し直される**（= 「ログアウトしたのにログイン済みへ戻る」テストになる）。
 * `injection: "once"` を渡すとプロセス内 2 回目以降の注入が素通りし、アプリは本番と同じ
 * `signInAnonymously()` の経路へ進む（app-expo/lib/e2e/injectTestSession.ts の `E2ESessionInjectionPolicy`）。
 *
 * ## 匿名サインインのレート制限（30 回/時/IP・dev/prod 同一プロジェクト）への配慮
 * ログアウト後の匿名セッション再確立は **この spec の検証対象そのもの** なので、ここだけは
 * 共有匿名セッションで代替できず、実際に 1 回消費する（プラットフォームごとに 1 回）。
 * そのぶん消費を最小化するため:
 * - 3 症状を **1 テスト内で** 検証する（テストを 3 本に割ると 1 回の実行で 3 回消費してしまう）
 * - `beforeEach` ではなく `beforeAll` で 1 回だけ起動する（起動のたびに再ログアウトはできない）
 * この spec がフル実行で消費する匿名サインインは **1 回だけ** である
 * （専用セッションの `signInWithPassword` は匿名サインインとは別の枠なので影響しない）。
 *
 * ## ログアウト行への行き方（e2e-web との差分）
 * e2e-web は「深い URL の直開き」から始める（`app/index.tsx` が起動時 URL を行き先として採り直す
 * 経路を再現するため）。ネイティブでは同じ条件がディープリンク起動に当たるが、
 * 確認できていない前提の上に検証を積むより、実績のある UI 導線
 * （マイページタブ。tests/profile/settings.test.ts と同じ）を採る。
 * #1402 で設定はマイページ本体へ統合されたので、歯車を押す 1 階層が無くなった。
 * 起動時 URL 由来の回帰（`f8c6a437`）は e2e-web 側が押さえている。
 */

/**
 * サジェスト 1 件目の表示を 1 試行あたり何 ms 待つか。
 *
 * 入力のデバウンス（300ms）＋ Cloud Run（api-development）のコールドスタート ＋ Google Places 往復を
 * 見込んだ値。短くしすぎると「API は生きているのに打ち直しを繰り返す」だけになり、
 * 長くしすぎると匿名セッションの再確立待ちが 1 試行に吸われて全体のタイムアウトへ届かなくなる。
 */
const SUGGESTION_PROBE_TIMEOUT = 15_000;

/** 打ち直しに使う地名（同じ文字列の `replaceText` で `onChangeText` が発火しない可能性を排除する） */
const LOCATION_QUERIES = ["渋谷", "新宿"] as const;

describeAuthenticated("ログアウト（ログイン済みユーザー）", () => {
	/** この spec 専用の使い捨てセッション（後始末のため保持する） */
	let session: E2ESession | null = null;

	beforeAll(async () => {
		// 共有セッションを壊さないよう、専用セッションを 1 つ発行して注入する
		session = await createDisposableAuthenticatedSession();
		await launchAppWithSession({ as: "authenticated", session, injection: "once" });
	});

	afterAll(async () => {
		// ログアウトまで到達した run では既に失効しているが、途中で失敗した run のために必ず呼ぶ
		// （#1030 B-2: launchArgs で端末へ渡した refresh token を run をまたいで残さない）
		if (session) await revokeDisposableSession(session);
	});

	// ─ テストケース: ログアウトするとホームへ戻り、匿名セッションで API を続けられる ─
	// 手順:
	//   1. マイページ → 歯車で設定画面へ遷移し、ログアウト行が出ている（= ログイン済み）ことを確認する
	//   2. ログアウト行 → 確認ダイアログ「ログアウト」で確定する
	//   3. [症状1] ホーム（検索画面）へ遷移し、設定画面から離れていることを検証
	//   4. [症状3] 直後にタブ導線が生きていることを検証（ネイティブの「固まる」を最初に踏む）
	//      併せてゲスト表示へ戻っている（= テストセッションが再注入されていない）ことも確認する
	//   5. [症状2] 実 API（場所オートコンプリート）が成功することを検証（= 匿名セッションの再確立）
	//   6. [症状3] 純クライアント操作（詳細条件の展開）も受け付けることを検証
	it("ログアウトするとホームへ戻り、匿名セッションで API を続けられる", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();
		const searchScreen = new SearchScreen();
		const myDishesScreen = new MyDishesScreen();

		await tabBar.gotoProfile();
		await profileScreen.expectLoaded();
		await settingsScreen.expectLoaded();

		// ログアウト行の表示 ＝ AuthProvider が「ログイン済み(非匿名)」で決着した合図。
		// ここが出ない場合はセッション注入自体が効いていない（= 検証の前提が崩れている）
		//
		// ⚠️ 先にスクロールすること。ログアウト行は最下段のカードにあり、エミュレータの画面高では
		// **初期表示で画面外**にいる。素の `waitUntilVisible` だと「注入が効いていない」と
		// 区別が付かない形で 25 秒待って落ちる（CI で実際に踏んだ）
		await settingsScreen.scrollToLogout();
		await waitUntilVisible(settingsScreen.logoutItem);

		await settingsScreen.logout();

		// ── [症状1] ログアウト後にホーム（検索画面）へ遷移する ──────────────
		// #1124 では router.replace が「匿名サインインの await の後の finally」に置かれていたため
		// デッドロックで到達せず、マイページ（旧・設定画面）に留まっていた。
		// Android だけは遷移を再認証タイマーより後に予約するため（AuthProvider の
		// `Platform.OS !== "android"` 分岐）、web より 1 tick 遅れて着地することがある。
		await searchScreen.expectLoaded();
		await waitUntilGone(settingsScreen.logoutItem);
		// #1402 «画面タイトル「設定」が消えること» で見ていたが、その画面ごと無くなった。
		// マイページを離れたことは «必ず出る行» が消えることで見る（ロケール依存も 1 つ減る）
		await waitUntilGone(settingsScreen.feedbackItem);

		// ── [症状3] 画面が固まらない（まずタブ導線） ──────────────────────
		// ネイティブの #1124 は「本当に無反応になる」形で出るため、匿名セッションの再確立を待たずに
		// 操作を入れる。API を伴わない導線を選ぶことで「固まっていない」と「まだトークンが無いだけ」を
		// 区別できるようにしている。
		//
		// 併せて **ゲスト表示へ戻っていること**（= ログイン済みセッションが再注入されていないこと）も見る。
		// 判定はゲスト帯（my-dishes-guest-description）で行う。#1375 実機確認で記録 CTA
		// （my-dishes-record-button）は **ゲストにも出る**ようになったので、CTA の有無では
		// ログイン状態を判定できない。ゲスト帯だけがログイン状態と 1:1 で対応する。
		await tabBar.gotoMyDishes();
		await myDishesScreen.expectGuestViewLoaded();

		await tabBar.gotoSearch();
		await searchScreen.expectLoaded();

		// ── [症状2] ログアウト後も API 呼び出しが成功する ────────────────
		// 場所オートコンプリートは「アプリ → Supabase の匿名 JWT → NestJS API → Google Places」を通るため、
		// 新しい匿名セッションの JWT が実際に通用していることの証明になる
		// （useAPICall はトークンが無いと送信前に unauthenticated で落ちるので、
		//   セッションが再確立できていなければサジェストは絶対に出ない）。
		//
		// ⚠️ Detox には e2e-web の `readStoredSessionUser`（localStorage の直読み）に当たる手段が無く、
		// 「匿名セッションが載った瞬間」を観測できない。入力は 1 回きりのイベントなので、
		// トークンが載る前に打つと最初の 1 回が unauthenticated で落ちたまま二度と再送されない。
		// そこで **入力し直しながら待つ**ことで e2e-web の `expect.poll` と同じ効果を出す。
		// 毎回別の地名を入れるのは、同じ文字列の `replaceText` では `onChangeText` が発火せず
		// 再検索が走らない可能性を排除するため。
		// 再確立が起きなければ全試行が空振りして赤くなる（= 感度は落ちていない）。
		let attempt = 0;
		await waitUntil(
			async () => {
				const query = LOCATION_QUERIES[attempt % LOCATION_QUERIES.length]!;
				attempt += 1;
				await searchScreen.typeLocation(query);
				return visibleNow(searchScreen.locationSuggestion(0), SUGGESTION_PROBE_TIMEOUT);
			},
			{
				timeout: 90_000,
				interval: 1_000,
				description: "ログアウト後に匿名セッションが再確立され、場所オートコンプリート API が成功すること",
			},
		);
		await waitUntilVisible(searchScreen.locationSuggestions);

		// ── [症状3] 純クライアント操作も受け付け続けている ────────────────
		// API を一切伴わない操作（詳細条件の展開 → 距離スライダーの描画）まで通ることで、
		// 「API は返るがレンダリングが止まっている」種類のフリーズも排除する。
		//
		// ⚠️ スライダーは **可視ではなく存在**で見る。詳細条件を開いた直後の距離セクションは
		// 画面下部（iOS では画面下端に固定された検索 FAB / ホームインジケータの領域）へ来るため、
		// `toBeVisible`（既定 75% 以上の露出が必要）はスクロール位置に左右されて落ちる。
		// tests/search/search-form.test.ts が同じ理由で先に `waitUntilExists` へ移しており
		//（run 30470033327 の iOS で実測）、こちらだけ可視判定のまま残っていた（run 31677355367）。
		// ここで検証したいのは「タップに反応して再描画された」ことなので、存在で過不足ない。
		await searchScreen.openAdvancedFilters();
		await waitUntilExists(searchScreen.distanceSlider);

		// 使い捨てセッションを発行できていたことの明示（beforeAll が fail-loud なので通常は自明だが、
		// 「共有セッションで走ってしまった」状態を後から読めるようにしておく）
		assert.notEqual(session, null, "この spec は専用セッションでのみ実行してよい");
	});
});
