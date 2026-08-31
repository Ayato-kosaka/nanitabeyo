import { element, expect, launchAppWithSession } from "../../fixtures/e2e";
import { LoginScreen } from "../../screens/LoginScreen";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { TabBar } from "../../screens/TabBar";

/**
 * 🍽️ 食べたい/食べたタブ（匿名ユーザー）のテスト（e2e-web の tests/my-dishes/my-dishes-guest.spec.ts に対応）
 * （#1396 でレビュータブから差し替え）
 *
 * 目的: 匿名ユーザーに対する「ログインへの導線」が機能していることを保証する。
 *
 * ## スコープ（#1031 B6 確定を踏襲）
 * - 対象は **匿名ユーザーで検証できる範囲のみ**（ゲスト向け表示 + ログイン導線）。
 * - レビュー投稿（書き込み）は認証済み前提のため、このテストでは扱わない（tests/mutation/ 側）。
 * - 写真付きレビュー投稿はフォトピッカーがアプリ外プロセスのため Detox から操作できず、
 *   初期スコープ外（#1031 B6）。そもそもこの画面（お店選択・投稿フォーム）へは
 *   匿名ユーザーが到達する UI 導線自体が無い。
 *   （#1375 実機確認で `recordButton` はゲストにも出るようになったが、その先の
 *   「食べた」記録＝レビュー投稿はログインが要るので、ここのスコープは変わらない）
 *
 * ## ログイン導線の検証について
 * 判定は `LoginScreen`（`login-google-button` / `login-apple-button`）に集約してある。
 * #1359 でログインは BlurModal からルート（`/[locale]/auth/login`）へ移ったため、
 * 「同じ画面へ着く」ことの確認はここでは最小限にとどめ、戻る導線を含む本体の検証は
 * tests/profile/login-screen.test.ts が持つ。
 */
describe("食べたい/食べたタブ（匿名ユーザー）", () => {
	const tabBar = new TabBar();
	const myDishesScreen = new MyDishesScreen();

	beforeAll(async () => {
		// #1030 【設計】確定設計（A' 案）どおり、Node 側で確立済みの匿名セッションを注入して起動する。
		// 匿名サインインのクォータ（30 回/時/IP）を消費しない
		await launchAppWithSession({ as: "anon" });
	});

	// ─ テストケース: ゲスト向け説明とログイン CTA が表示される ─
	// 手順:
	//   1. 食べたい/食べたタブへ遷移する
	//   2. ゲスト説明文（testID: my-dishes-guest-description。ja-JP: MyDishes.guest.description）が
	//      表示されることを検証
	//   3. ログイン CTA（testID: my-dishes-guest-login-button。ja-JP: MyDishes.guest.loginButton）が
	//      表示されることを検証
	it("ゲスト向け説明とログイン CTA が表示される", async () => {
		await tabBar.gotoMyDishes();

		await myDishesScreen.expectGuestViewLoaded();
		await expect(element(myDishesScreen.guestDescription)).toBeVisible();
	});

	// ─ テストケース: ログイン CTA タップでログイン画面へ遷移する ─
	// 手順:
	//   1. 食べたい/食べたタブのゲスト表示を開く
	//   2. ログイン CTA をタップする
	//   3. ログイン画面が開き、Google/Apple ボタンが表示されることを検証
	it("ログイン CTA タップでログイン画面へ遷移する", async () => {
		await tabBar.gotoMyDishes();
		await myDishesScreen.expectGuestViewLoaded();

		await myDishesScreen.tapGuestLogin();

		// #1027 観測点には実体のあるボタンを使う。判定は Screen Object に集約してあるのでそれを使う
		await new LoginScreen().expectOpened();
	});
});
