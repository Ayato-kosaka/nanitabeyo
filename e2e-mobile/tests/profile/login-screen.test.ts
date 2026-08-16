import { device, launchAppWithSession, localeDeepLink } from "../../fixtures/e2e";
import { TabBar } from "../../screens/TabBar";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { ReviewScreen } from "../../screens/ReviewScreen";
import { LoginScreen } from "../../screens/LoginScreen";

/**
 * 🔑 ログイン画面のテスト（e2e-web の tests/profile/login-screen.spec.ts に対応）
 *
 * 目的: ログイン導線の入口（画面遷移・OAuth ボタン・戻る導線）を保証する。
 *
 * ## なぜ実 OAuth はテストしないのか
 * ログイン手段は Google/Apple OAuth のみで、外部 IdP のログイン画面は bot 検知により
 * 自動化がブロックされる上、プロバイダの利用規約にも抵触しうる。e2e-web と同じ方針で
 * 「自分のアプリの責務（画面遷移・遷移開始）」までをテストする。
 * ログイン済み状態のテストは launchAppWithSession({ as: "authenticated" }) が担当する。
 *
 * ## #1359 モーダルからルートへ移した
 * ここで最も重要なのは **ハードウェアバックで元のタブへ戻れること**。
 * #498（Android で OAuth 成功後もログインモーダルが閉じない）の根は「ログイン UI の表示状態が
 * 遷移と無関係な boolean だったこと」で、BlurModal は自前の BackHandler を持っていた。
 * ルート化でその責務は Navigator に移る。その乗り換えが効いているかを実端末で見る唯一の形。
 */
describe("ログイン画面", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態(開いたままの画面等)を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。セッション注入起動は匿名クォータを消費しないため
	// (fixtures/e2e.ts の launchAppWithSession)、テストごとに起動し直して独立性を担保する
	beforeEach(async () => {
		await launchAppWithSession({ as: "anon" });
	});

	// ─ テストケース: 画面に Google/Apple ボタンが表示される ─
	// 手順:
	//   1. マイページのログインボタンをタップする
	//   2. ログイン画面（login-google-button・login-apple-button）が表示されることを検証
	it("Google/Apple ボタンが表示される", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const loginScreen = new LoginScreen();

		await tabBar.gotoProfile();
		await profileScreen.openLogin();
		await loginScreen.expectOpened();
	});

	// ─ テストケース: ハードウェアバックで元のタブへ戻る ─
	// #1359 【設計】#498 の再発検知に最も近い検証。
	// BlurModal は自前の BackHandler（features/blurModal/hooks/useBlurModal.tsx）で戻るキーを
	// 握っていた。ルート化後はスタックの pop になる。戻った先が「ログイン導線を出した画面」
	// （＝マイページのゲスト表示）であることまで見る。
	// ⚠️ `device.pressBack()` は Android 専用。iOS ではヘッダーの戻るボタンで同じ復帰を確認する。
	// 手順:
	//   1. マイページからログイン画面へ遷移する
	//   2. Android はハードウェアバック / iOS はヘッダーの戻るボタンで離脱する
	//   3. マイページのゲスト表示（ログインボタン）が戻ってくることを検証
	it("戻る操作で元のタブ（マイページ）へ戻る", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const loginScreen = new LoginScreen();

		await tabBar.gotoProfile();
		await profileScreen.expectGuestViewLoaded();
		await profileScreen.openLogin();
		await loginScreen.expectOpened();

		if (device.getPlatform() === "android") {
			await device.pressBack();
		} else {
			await loginScreen.goBack();
		}

		await profileScreen.expectGuestViewLoaded();
	});

	// ─ テストケース: ディープリンクで直接着地したときのフォールバック ─
	// #1359 【設計】§2 の (B)。ディープリンクで直接着地すると履歴が無いため
	// `router.canGoBack()` が false になり、戻り先は履歴ではなく `?next=` で決まる
	//（`?next=` が無い / 採用できない場合はマイページ）。
	// ⚠️ 「コールドロードでは canGoBack() が false になる」は設計 §1 で **未確認**とされた前提。
	//    ここが赤くなったら、テストではなく設計の前提の方を疑うこと。
	// 手順:
	//   1. nanitabeyo:///ja-JP/auth/login?next=%2Fja-JP%2Freview へ直接着地する
	//   2. ログイン画面が表示されることを検証
	//   3. ヘッダーの戻るボタンをタップする
	//   4. next の行き先（レビュータブのゲスト表示）へ着地することを検証
	it("直接着地して戻ると、履歴が無いので next の画面へ倒れる", async () => {
		const reviewScreen = new ReviewScreen();
		const loginScreen = new LoginScreen();

		await launchAppWithSession({
			as: "anon",
			url: `${localeDeepLink("auth/login")}?next=${encodeURIComponent("/ja-JP/review")}`,
			// タブバー（tab-search）はログイン画面の下に居ないため、既定の起動完了待ちは使えない
			waitForReady: false,
		});
		await loginScreen.expectOpened();

		await loginScreen.goBack();

		await reviewScreen.expectGuestViewLoaded();
	});

	// ─ テストケース: レビュータブからの導線でも同じ画面へ着く ─
	// #1359 4 箇所の導線が 1 つのルートへ集約されたこと（完了条件の「4 複製の解消」）を、
	// マイページ以外の入口でも 1 本だけ固定しておく。
	// 手順:
	//   1. レビュータブのゲスト表示からログイン CTA をタップする
	//   2. 同じログイン画面が開くことを検証
	it("レビュータブのログイン CTA からも同じ画面へ着く", async () => {
		const tabBar = new TabBar();
		const reviewScreen = new ReviewScreen();
		const loginScreen = new LoginScreen();

		await tabBar.gotoReview();
		await reviewScreen.expectGuestViewLoaded();
		await reviewScreen.tapGuestLogin();

		await loginScreen.expectOpened();
	});

	// #1031 B2 のリーガルリンク検証は #1027 でこの spec から外した。
	// 同意文言のリンクは `<Text>` の入れ子で、React Native は入れ子 Text を親の TextView へ畳み込むため
	// **ネイティブ View が存在せず testID(login-privacy-link) では到達できない**（run 30432596949 で実測）。
	// 代替として、実体のある行を持つ設定画面から同じ legal-document-modal を開く検証を
	// tests/profile/settings.test.ts に置いている。
});
