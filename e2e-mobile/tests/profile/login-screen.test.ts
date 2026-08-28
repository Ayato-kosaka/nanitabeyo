import { device, launchAppWithSession, localeDeepLink } from "../../fixtures/e2e";
import { TabBar } from "../../screens/TabBar";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
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
	// ⚠️ ここが赤くなったら、まず疑うのは **`lib/deepLinkTarget.ts` の `toInAppPath` が
	//    `/[locale]/auth/*` を捨てていること**（`if (secondSegment === "auth") return null;`）。
	//    捨てられると `app/index.tsx` が `deepLinkTarget ?? /${locale}` へ倒すため、
	//    `nanitabeyo:///ja-JP/auth/login?next=...` は **ロケール直下（検索画面）に化けて**
	//    ログイン画面にすら着かない。iOS のコールドスタートは「一度 `/` を描いてから初期 URL を
	//    解決することがある」実測（app/index.tsx / run 30460621899）があり、その経路に乗ると必ず踏む。
	//    #1135 の除外意図は「callback の `code` をクエリごと落とさない」ことで、それは
	//    `carriesOAuthResult` が別途担保している。また #1272 でクエリは運ばれるようになったため、
	//    除外理由（「クエリ込みでしか意味を持たない route」）はもう `auth/login` には当てはまらない。
	//    → 影響範囲がディープリンク全体に及ぶため #1359 PR2 では触らず、別課題として切り出してある。
	//    「コールドロードでは canGoBack() が false になる」も設計 §1 で **未確認**の前提ではあるが、
	//    こちらが原因である可能性は上より低い。順番を間違えないこと。
	// 手順:
	//   1. nanitabeyo:///ja-JP/auth/login?next=%2Fja-JP%2Fmy-dishes へ直接着地する
	//   2. ログイン画面が表示されることを検証
	//   3. ヘッダーの戻るボタンをタップする
	//   4. next の行き先（食べたい/食べたタブのゲスト表示）へ着地することを検証
	it("直接着地して戻ると、履歴が無いので next の画面へ倒れる", async () => {
		const myDishesScreen = new MyDishesScreen();
		const loginScreen = new LoginScreen();

		await launchAppWithSession({
			as: "anon",
			url: `${localeDeepLink("auth/login")}?next=${encodeURIComponent("/ja-JP/my-dishes")}`,
			// タブバー（tab-search）はログイン画面の下に居ないため、既定の起動完了待ちは使えない
			waitForReady: false,
		});
		await loginScreen.expectOpened();

		await loginScreen.goBack();

		await myDishesScreen.expectGuestViewLoaded();
	});

	// ─ テストケース: 食べたい/食べたタブからの導線でも同じ画面へ着く ─
	// #1359 4 箇所の導線が 1 つのルートへ集約されたこと（完了条件の「4 複製の解消」）を、
	// マイページ以外の入口でも 1 本だけ固定しておく。
	// 手順:
	//   1. 食べたい/食べたタブのゲスト表示からログイン CTA をタップする
	//   2. 同じログイン画面が開くことを検証
	it("食べたい/食べたタブのログイン CTA からも同じ画面へ着く", async () => {
		const tabBar = new TabBar();
		const myDishesScreen = new MyDishesScreen();
		const loginScreen = new LoginScreen();

		await tabBar.gotoMyDishes();
		await myDishesScreen.expectGuestViewLoaded();
		await myDishesScreen.tapGuestLogin();

		await loginScreen.expectOpened();
	});

	// #1031 B2 のリーガルリンク検証は #1027 でこの spec から外した。
	// 同意文言のリンクは `<Text>` の入れ子で、React Native は入れ子 Text を親の TextView へ畳み込むため
	// **ネイティブ View が存在せず testID(login-privacy-link) では到達できない**（run 30432596949 で実測）。
	// 代替として、実体のある行を持つ設定画面から同じリーガル導線をたどる検証を
	// tests/profile/settings.test.ts に置いている。
	// #1368 その導線は BlurModal（legal-document-modal）から `/[locale]/legal/<doc>` ルートへ変わった。
	// 戻る導線まで含めた検証は tests/profile/legal.test.ts が持つ。
});
