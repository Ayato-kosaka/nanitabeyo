import { launchAppWithSession } from "../../fixtures/e2e";
import { TabBar } from "../../screens/TabBar";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { LoginModal } from "../../screens/LoginModal";

/**
 * 🔑 ログインモーダルのテスト（e2e-web の tests/profile/login-modal.spec.ts に対応）
 *
 * 目的: ログイン導線の入口（モーダル表示・OAuth ボタン・リーガルリンク）を保証する。
 *
 * ## なぜ実 OAuth はテストしないのか
 * ログイン手段は Google/Apple OAuth のみで、外部 IdP のログイン画面は bot 検知により
 * 自動化がブロックされる上、プロバイダの利用規約にも抵触しうる。e2e-web と同じ方針で
 * 「自分のアプリの責務（モーダル表示・遷移開始）」までをテストする。
 * ログイン済み状態のテストは別 PR（launchAppWithSession({ as: "authenticated" })）が担当する。
 */
describe("ログインモーダル", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態(開いたままのモーダル等)を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。セッション注入起動は匿名クォータを消費しないため
	// (fixtures/e2e.ts の launchAppWithSession)、テストごとに起動し直して独立性を担保する
	beforeEach(async () => {
		await launchAppWithSession({ as: "anon" });
	});

	// ─ テストケース: モーダルに Google/Apple ボタンが表示される ─
	// 手順:
	//   1. マイページのログインボタンをタップする
	//   2. モーダル（login-modal）が開き、login-google-button・login-apple-button が
	//      表示されることを検証
	it("Google/Apple ボタンが表示される", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const loginModal = new LoginModal();

		await tabBar.gotoProfile();
		await profileScreen.openLoginModal();
		await loginModal.expectOpened();
	});

	// #1031 B2 のリーガルリンク検証は #1027 でこの spec から外した。
	// 同意文言のリンクは `<Text>` の入れ子で、React Native は入れ子 Text を親の TextView へ畳み込むため
	// **ネイティブ View が存在せず testID(login-privacy-link) では到達できない**（run 30432596949 で実測）。
	// 代替として、実体のある行を持つ設定画面から同じ legal-document-modal を開く検証を
	// tests/profile/settings.test.ts に置いている。
});
