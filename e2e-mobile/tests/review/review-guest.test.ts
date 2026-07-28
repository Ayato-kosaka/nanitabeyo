import { by, element, expect, launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { ReviewScreen } from "../../screens/ReviewScreen";
import { TabBar } from "../../screens/TabBar";

/**
 * ✏️ レビュータブ（匿名ユーザー）のテスト（e2e-web の tests/review/review-guest.spec.ts に対応）
 *
 * 目的: 匿名ユーザーに対する「ログインへの導線」が機能していることを保証する。
 *
 * ## スコープ（#1031 B6 確定 / このリーダー指示の範囲）
 * - 対象は **匿名ユーザーで検証できる範囲のみ**（ゲスト向け表示 + ログイン導線）。
 * - レビュー投稿（書き込み）は認証済み前提のため、このテストでは扱わない（別 PR 担当）。
 * - 写真付きレビュー投稿はフォトピッカーがアプリ外プロセスのため Detox から操作できず、
 *   初期スコープ外（#1031 B6）。そもそもこの画面（お店選択・投稿フォーム）へは
 *   匿名ユーザーが到達する UI 導線自体が無い（`ReviewScreen.postButton` はログイン済みのみ表示）。
 *
 * ## ログインモーダルの検証について
 * `LoginModal` の Screen Object（`login-modal` / `login-google-button` / `login-apple-button`）は
 * 別 PR（PR-4: profile+settings 系）が所有するファイルのため、この PR ではファイルを増やさず
 * `by.id(...)` を直接使って最小限の検証だけ行う。
 */
describe("レビュータブ（匿名ユーザー）", () => {
	const tabBar = new TabBar();
	const reviewScreen = new ReviewScreen();

	beforeAll(async () => {
		// #1030 【設計】確定設計（A' 案）どおり、Node 側で確立済みの匿名セッションを注入して起動する。
		// 匿名サインインのクォータ（30 回/時/IP）を消費しない
		await launchAppWithSession({ as: "anon" });
	});

	// ─ テストケース: ゲスト向け説明とログイン CTA が表示される ─
	// 手順:
	//   1. レビュータブへ遷移する
	//   2. ゲスト説明文（testID: review-guest-description。ja-JP: Review.guest.description）が
	//      表示されることを検証
	//   3. ログイン CTA（testID: review-guest-login-button。ja-JP: Review.guest.loginButton）が
	//      表示されることを検証
	it("ゲスト向け説明とログイン CTA が表示される", async () => {
		await tabBar.gotoReview();

		await reviewScreen.expectGuestViewLoaded();
		await expect(element(reviewScreen.guestDescription)).toBeVisible();
	});

	// ─ テストケース: ログイン CTA タップでログインモーダルが開く ─
	// 手順:
	//   1. レビュータブのゲスト表示を開く
	//   2. ログイン CTA をタップする
	//   3. ログインモーダル（testID: login-modal）が開き、Google/Apple ボタンが表示されることを検証
	it("ログイン CTA タップでログインモーダルが開く", async () => {
		await tabBar.gotoReview();
		await reviewScreen.expectGuestViewLoaded();

		await reviewScreen.tapGuestLogin();

		await waitUntilVisible(by.id("login-modal"));
		await expect(element(by.id("login-google-button"))).toBeVisible();
		await expect(element(by.id("login-apple-button"))).toBeVisible();
	});
});
