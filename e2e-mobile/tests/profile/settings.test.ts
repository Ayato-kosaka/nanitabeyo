import { strict as assert } from "node:assert";

import { launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { TabBar } from "../../screens/TabBar";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { SettingsScreen } from "../../screens/SettingsScreen";
import { DeviceSettingsScreen } from "../../screens/DeviceSettingsScreen";
import { LegalScreen } from "../../screens/LegalScreen";
import { NotificationSettingsSection } from "../../screens/NotificationSettingsSection";

/**
 * ⚙️ 設定項目（匿名ユーザー）のテスト（e2e-web の tests/profile/settings.spec.ts に対応）
 *
 * 目的: 設定メニューの項目構成と、匿名ユーザーへの表示制御を保証する。
 * 表示・遷移の検証に留め、フィードバック送信・アカウント削除等の共有 dev 環境へ書き込む操作は行わない。
 *
 * ## #1402 で入口が変わった
 * 独立した設定画面（profile/settings.tsx）は無くなり、項目はマイページの縦リストへ統合された。
 * 歯車ボタン（profile-settings-button）も消えたので、マイページタブを開けばそこが設定である。
 * 見るもの（項目の構成・匿名時のログアウト非表示）は変わらないので、この spec はそのまま残す。
 *
 * ## Web 版からの変更点（#1031 確定）
 * - 「レビューを書く」（settings-leave-review）は Web では非表示だが、ネイティブでは表示される
 *   （`Platform.OS !== "web"` 条件、#1031 §1-1 の反転）。表示のみ検証し、タップはしない（M2: ストア誘導の
 *   Linking.openURL が実際に走ってしまうため）。
 */
describe("設定項目（匿名ユーザー）", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態(開いたままのモーダル等)を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。セッション注入起動は匿名クォータを消費しないため
	// (fixtures/e2e.ts の launchAppWithSession)、テストごとに起動し直して独立性を担保する
	beforeEach(async () => {
		await launchAppWithSession({ as: "anon" });
	});

	// ─ テストケース: 設定メニューの各項目が表示される ─
	// 手順:
	//   1. マイページタブを開く（#1402 以前は「歯車ボタンをタップして設定画面へ」だった）
	//   2. 以下の項目が表示されることを検証:
	//      - ご意見・不具合(settings-feedback) / レビューを書く(settings-leave-review、ネイティブのみ)
	//      - ブロック済みの料理カテゴリ(settings-blocked-dish-categories)
	//      - 端末設定(settings-device-settings) / なに食べよについて(settings-about)
	//   ⚠️ #1583 で規約 4 行・応援する・バージョンは «なに食べよについて»、
	//      表示テーマは «端末設定» へ移った
	it("設定メニューの各項目が表示される", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();

		await tabBar.gotoProfile();
		await profileScreen.expectLoaded();
		await settingsScreen.expectLoaded();

		// #1583 `expectLoaded()` は «最上段が見えたか» しか見ない（スクロールしない）ので、
		//       2 枚目のカードの行はここで明示的に運ぶ
		//
		// ⚠️ #1579 «ご意見・不具合»（settings-feedback）はここで探さない。#1583 で
		//    `profile/about` へ移っており、マイページ本体には無い（about.tsx:123）。
		//    移設に追随できておらず 25 秒待って落ちていた。あちらの有無は下の
		//    «なに食べよについて» のテストが見ている。
		await settingsScreen.expectRowVisible(settingsScreen.blockedDishCategoriesItem);
		// #1583 下 2 行は初期表示で画面外にいるので、見えるところまで運んでから確かめる
		await settingsScreen.expectRowVisible(settingsScreen.deviceSettingsItem);
		await settingsScreen.expectRowVisible(settingsScreen.aboutItem);
	});

	// ─ テストケース: «なに食べよについて» に応援する・規約・バージョンが揃う ─
	// #1583 オーナー指定の中身。**«応援する» はネイティブでしか出ない**ので、
	// この 1 本は web 側では代替できない（e2e-web は行が無いことを検証している）。
	it("«なに食べよについて» に応援する・規約・バージョンが揃う", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();

		await tabBar.gotoProfile();
		await profileScreen.expectLoaded();
		await settingsScreen.expectLoaded();
		await settingsScreen.openAbout();

		// ⚠️ #1579 このページは下側の行が **初期表示で画面外**にいる。素の
		//    `waitUntilVisible` だとスクロールしないので «著作権» と «バージョン» で
		//    25 秒待って落ちていた（run 34022380038 で実測）。
		//    «ご意見・不具合» もこのページにある（#1583 で移設）。
		await settingsScreen.expectAboutRowVisible(settingsScreen.leaveReviewItem);
		await settingsScreen.expectAboutRowVisible(settingsScreen.feedbackItem);
		await settingsScreen.expectAboutRowVisible(settingsScreen.guidelinesItem);
		await settingsScreen.expectAboutRowVisible(settingsScreen.termsItem);
		await settingsScreen.expectAboutRowVisible(settingsScreen.privacyItem);
		await settingsScreen.expectAboutRowVisible(settingsScreen.copyrightItem);
		await settingsScreen.expectAboutRowVisible(settingsScreen.versionSection);

		// #1583 1 画面を 3 画面へ割った以上、**帰ってこられること**まで見る。
		// 分割そのものより «行き止まりを作る» ほうが起きやすい事故で、
		// 「行が出る」「遷移できる」だけのテストでは捕まらない。
		// 実機は 1 本 100〜200 秒かかるので、it を増やさずこの導線の続きとして確かめる。
		await settingsScreen.goBackFromAbout();
		await settingsScreen.expectLoaded();
	});

	// ─ テストケース: プライバシーポリシー行で法務ドキュメント画面へ遷移する ─
	// 手順:
	//   1. マイページを表示する
	//   2. プライバシーポリシー行（settings-privacy）をタップする
	//   3. 法務ドキュメント画面（legal-screen-document）が表示されることを検証
	//
	// #1027 この検証はもともと #1031 B2 でログインモーダルの同意文言リンクに置く予定だったが、
	// リンクは `<Text>` の入れ子でネイティブ View を持たず Detox から到達できないことが実測で判明した
	// （screens/LoginScreen.ts のコメント参照）。実体のある行を持つこちらの画面へ移してある。
	// #1368 遷移先は BlurModal（legal-document-modal）から `/[locale]/legal/privacy` ルートへ変わった。
	// 戻る導線まで含めた検証は tests/profile/legal.test.ts が持つ。
	it("プライバシーポリシー行で法務ドキュメント画面へ遷移する", async () => {
		const tabBar = new TabBar();
		const settingsScreen = new SettingsScreen();
		const legalScreen = new LegalScreen();

		await tabBar.gotoProfile();
		await settingsScreen.expectLoaded();

		await settingsScreen.openPrivacyPolicy();
		await legalScreen.expectOpened();
	});

	// ─ テストケース: 匿名時はログアウトが表示されない ─
	// 手順:
	//   1. マイページを表示する（匿名状態）
	//   2. ログアウト行（settings-logout）が存在しないことを検証
	//      （ログアウトは非匿名ユーザーのみに表示される仕様）
	it("匿名時はログアウトが表示されない", async () => {
		const tabBar = new TabBar();
		const settingsScreen = new SettingsScreen();

		await tabBar.gotoProfile();
		await settingsScreen.expectLoaded();

		const hasLogoutItem = await settingsScreen.hasLogoutItem();
		assert.equal(hasLogoutItem, false, "匿名ユーザーには settings-logout が表示されないはず");
	});

	// ─ テストケース: バージョン情報が表示される(#1495 SUP-03) ─
	// 手順:
	//   1. マイページを表示する
	//   2. バージョン行(settings-version-section)が "{version}({短縮コミットID})" 形式
	//      (例: 1.14.0(abc1234) / コミットID未設定時は 1.14.0(dev)) で表示され、
	//      "undefined" を含んでいないことを検証する
	//
	// ⚠️ web と異なり、ネイティブは nativeApplicationVersion 系の取得経路がある一方、
	//   VersionInfo コンポーネント自体は Env.APP_VERSION / Env.COMMIT_ID を
	//   web/native 共通で読む設計（VersionInfo.tsx 参照）。ここではネイティブ実機/シミュレータ上で
	//   実際にその値が画面に描画されることを検証する。
	it("バージョン情報が表示される", async () => {
		const tabBar = new TabBar();
		const settingsScreen = new SettingsScreen();

		await tabBar.gotoProfile();
		await settingsScreen.expectLoaded();
		// #1583 バージョンは «なに食べよについて» ページへ移った
		await settingsScreen.openAbout();

		// ⚠️ #1579 バージョンはこのページの最下段。スクロールしないと届かない
		await settingsScreen.expectAboutRowVisible(settingsScreen.versionSection);

		const versionText = await settingsScreen.getVersionText();
		assert.match(versionText, /^\d+\.\d+\.\d+\([^)]+\)$/, `実測: "${versionText}"`);
		assert.doesNotMatch(versionText, /undefined/i, `実測: "${versionText}"`);
	});
});

/**
 * #1504 SET-01 端末設定画面（ハプティクスのオン/オフ）のテスト（匿名ユーザー）
 *
 * 対応する e2e-web: tests/profile/settings.spec.ts の「端末設定画面のハプティクストグル」。
 *
 * トグルはマイページ直置きではなく «端末設定» 行（settings-device-settings）から push される
 * 別画面にある（オーナー指示。理由は app-expo/app/[locale]/(tabs)/profile/device-settings.tsx の冒頭）。
 * ネイティブには URL 直遷移が無いので、ここでは必ず実 UI 導線（行のタップ）で開く。
 *
 * ## Web 版との違い（ネイティブでこそ意味がある理由）
 * ハプティクス自体は実機/エミュレータでしか実際に発火しない機能で、jest 側の
 * `app-expo/hooks/useHaptics.test.tsx` がオフ時に `expo-haptics` を呼ばないことを固定している。
 * ただし Detox はブラックボックス e2e であり、このリポジトリの e2e-mobile 基盤には
 * `expo-haptics` のようなネイティブモジュール呼び出しをスパイ/モックする手段が無いため、
 * 「振動が実際に鳴らないこと」自体はここでは検証できない。
 * 代わりに、**ネイティブの `Switch` コンポーネントが実際に期待どおりの状態を描画し、
 * AsyncStorage 経由でアプリ再起動後も保持されること**を検証する
 * （`DeviceSettingsScreen.expectHapticsToggleValue` は Detox の `toHaveToggleValue()` を使う。
 * e2e-web と異なり、ネイティブでは `testID` が `Switch` 自体に直接乗るため、
 * react-native-web 特有の「testID が外側の View へ逃げる」問題が無い）。
 *
 * 永続化の検証は「アプリを再起動しても状態が保持されること」で行う（recent-locations.test.ts と同じ方式。
 * `launchAppWithSession` は既定 `resetState: false` なので、再起動しても AsyncStorage は消えない）。
 */
describe("端末設定画面のハプティクストグル（匿名ユーザー）", () => {
	beforeEach(async () => {
		await launchAppWithSession({ as: "anon" });
	});

	// ─ テストケース: 端末設定行から開くと、トグルが表示され既定でオンである ─
	// 手順:
	//   1. マイページタブを開く（#1402 で歯車の 1 階層は無くなった）
	//   2. 端末設定行（settings-device-settings）をタップして端末設定画面へ遷移する
	//   3. トグル行（settings-haptics-toggle）が表示されることを検証
	//   4. 既定値（未設定時はオン。hapticsSettingsStore.ts の仕様）であることを検証
	it("端末設定行から開くと、トグルが表示され既定でオンである", async () => {
		const tabBar = new TabBar();
		const settingsScreen = new SettingsScreen();
		const deviceSettingsScreen = new DeviceSettingsScreen();

		await tabBar.gotoProfile();
		await settingsScreen.expectLoaded();

		await settingsScreen.openDeviceSettings();
		await deviceSettingsScreen.expectLoaded();
		await deviceSettingsScreen.expectHapticsToggleValue(true);

		// #1583 «なに食べよについて» と同じ理由で、戻れることまで見る
		await deviceSettingsScreen.goBack();
		await settingsScreen.expectLoaded();
	});

	// ─ テストケース: タップすると状態が変わり、アプリ再起動後も保持される ─
	// 手順:
	//   1. マイページ →「端末設定」で端末設定画面を表示する（既定オン）
	//   2. トグル行をタップしてオフにする → Switch の状態がオフになることを検証
	//   3. アプリを再起動し、同じ導線で開き直してオフが保持されていることを検証（永続化）
	//   4. 後始末: もう一度タップしてオンへ戻す
	it("タップすると状態が変わり、アプリ再起動後も保持される", async () => {
		const tabBar = new TabBar();
		const settingsScreen = new SettingsScreen();
		const deviceSettingsScreen = new DeviceSettingsScreen();

		await tabBar.gotoProfile();
		await settingsScreen.expectLoaded();
		await settingsScreen.openDeviceSettings();
		await deviceSettingsScreen.expectLoaded();
		await deviceSettingsScreen.expectHapticsToggleValue(true);

		await deviceSettingsScreen.toggleHaptics();
		await deviceSettingsScreen.expectHapticsToggleValue(false);

		// アプリを再起動しても状態が保持される（resetState 既定 false = AsyncStorage は消えない）
		await launchAppWithSession({ as: "anon" });
		await tabBar.gotoProfile();
		await settingsScreen.expectLoaded();
		await settingsScreen.openDeviceSettings();
		await deviceSettingsScreen.expectLoaded();
		await deviceSettingsScreen.expectHapticsToggleValue(false);

		// 後始末: 既定値（オン）へ戻す
		await deviceSettingsScreen.toggleHaptics();
		await deviceSettingsScreen.expectHapticsToggleValue(true);
	});

	// ─ テストケース: 匿名時は通知カテゴリのカードが表示されない ─
	// 手順:
	//   1. 設定画面を表示する（匿名状態）
	//   2. 通知カード（settings-notifications-card）が存在しないことを検証
	//
	// #1510 匿名ユーザーは Push Token を登録しない（PushTokenRegistration）ため、
	// 受け取り方を設定させても届く先が無い。ログイン済み側（3 カテゴリのトグルが出る）は
	// tests/authenticated/notification-preferences.test.ts が検証する
	it("匿名時は通知カテゴリのカードが表示されない", async () => {
		const tabBar = new TabBar();
		const settingsScreen = new SettingsScreen();
		const section = new NotificationSettingsSection();

		// ⚠️ `ProfileScreen.gotoSettings()` は使えない。#1402 で **歯車の 1 階層が無くなり**、
		//    マイページタブがそのまま設定画面になっている（このファイルの他のテストも同じ形）。
		//    main 由来の #1510 のテストがこのメソッドを前提に書かれており、
		//    このブランチへ合流したときに存在しないメソッドの呼び出しとして残っていた
		await tabBar.gotoProfile();
		await settingsScreen.expectLoaded();

		const hasNotificationCard = await section.exists();
		assert.equal(hasNotificationCard, false, "匿名ユーザーには settings-notifications-card が表示されないはず");
	});
});
