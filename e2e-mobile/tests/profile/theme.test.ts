import { strict as assert } from "node:assert";

import { launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { TabBar } from "../../screens/TabBar";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { SearchScreen } from "../../screens/SearchScreen";
import { SettingsScreen } from "../../screens/SettingsScreen";

/**
 * 🌗 表示テーマ（システム追従 / ライト / ダーク）のテスト（#1509 SET-05）
 *  — e2e-web の tests/profile/theme.spec.ts に対応
 *
 * ## Web 版からの変更点
 * - e2e-web は `page.goto("/ja-JP/profile/settings")` で URL 直遷移するが、ネイティブには
 *   その代替経路が無いため、マイページの歯車ボタン（profile-settings-button）を実際にタップして遷移する
 *   （tests/profile/settings.test.ts と同じ理由・#1031 確定）。
 * - **色そのものは検証しない。** Detox の `getAttributes()` は背景色・文字色を返さないため、
 *   「ライトの #FFFFFF が変わっていないこと」のような画素の検証は e2e-web 側（computed style）と
 *   スクリーンショットのエビデンスが持つ。ここが持つのは **ネイティブ固有の関心**、すなわち
 *   「切替が効くか」「アプリを **起動し直しても** 保持されるか」である。
 *   永続化は AsyncStorage（ネイティブでは SQLite / SharedPreferences）で、web の localStorage とは
 *   実装が違うため、ネイティブ側で 1 度は通しておかないと «web だけ緑» が起こりうる。
 *
 * ## 後片付け
 * Detox は同じ端末インスタンスを spec 間で共有する。ダークのまま抜けると
 * **後続 spec のスクリーンショットが全部ダークになる**（UI カタログの撮影も含む）。
 * afterAll で必ず既定（システム追従）へ戻すこと。
 */
describe("表示テーマ（#1509 SET-05）", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態（開いたままのモーダル等）を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。セッション注入起動は匿名クォータを消費しないため、
	// テストごとに起動し直して独立性を担保する
	beforeEach(async () => {
		await launchAppWithSession({ as: "anon" });
	});

	/**
	 * 設定項目まで進む。
	 *
	 * #1402 で **独立した設定画面（歯車 → profile/settings）は無くなり**、設定項目は
	 * マイページ本体（app/[locale]/(tabs)/profile/index.tsx）のリストへ統合された。
	 * testID（settings-*）は据え置きなので、この spec が見る対象は変わらない。
	 * マイページを開いた時点で «設定項目» が同じ画面に居る、という 1 階層だけが減っている。
	 */
	const gotoSettings = async (): Promise<SettingsScreen> => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();

		await tabBar.gotoProfile();
		await profileScreen.expectLoaded();
		await settingsScreen.expectLoaded();
		// #1583 表示テーマは «端末設定» ページへ移った。マイページにはもう無い
		await settingsScreen.openDeviceSettings();
		return settingsScreen;
	};

	// 端末に残った設定が後続 spec を巻き込まないよう、必ず既定へ戻す
	afterAll(async () => {
		await launchAppWithSession({ as: "anon" });
		const settingsScreen = await gotoSettings();
		await settingsScreen.selectTheme("system");
	});

	// ─ テストケース: 3 択が表示され、既定はシステム追従 ─
	// 手順:
	//   1. マイページ→端末設定の実導線で遷移する（#1583 でテーマがここへ移った）
	//   2. テーマセレクタと 3 行（システム追従 / ライト / ダーク）が表示されることを検証
	//   3. 既定（システム追従）だけが選択済みであることを検証
	it("3 択が表示され、既定はシステム追従", async () => {
		const settingsScreen = await gotoSettings();

		await waitUntilVisible(settingsScreen.themeSelector);
		await waitUntilVisible(settingsScreen.themeOption("system"));
		await waitUntilVisible(settingsScreen.themeOption("light"));
		await waitUntilVisible(settingsScreen.themeOption("dark"));

		assert.equal(await settingsScreen.isThemeSelected("system"), true, "既定はシステム追従のはず");
		assert.equal(await settingsScreen.isThemeSelected("light"), false);
		assert.equal(await settingsScreen.isThemeSelected("dark"), false);
	});

	// ─ テストケース: ライト → ダーク → ライト と選び直せる ─
	// 手順:
	//   1. 設定画面でライトを選び、ライトだけが選択済みになることを検証
	//   2. ダークを選び、選択がダークへ «付け替わる»（ライトの選択が外れる）ことを検証
	//   3. ライトへ戻し、1 と同じ状態に戻ることを検証
	//
	// 3 択は排他なので、「選択が増えるだけで外れない」実装ミスをここで捕まえる。
	it("ライト → ダーク → ライトと排他で選び直せる", async () => {
		const settingsScreen = await gotoSettings();

		await settingsScreen.selectTheme("light");
		assert.equal(await settingsScreen.isThemeSelected("light"), true);
		assert.equal(await settingsScreen.isThemeSelected("system"), false, "選択は排他のはず");
		assert.equal(await settingsScreen.isThemeSelected("dark"), false);

		await settingsScreen.selectTheme("dark");
		assert.equal(await settingsScreen.isThemeSelected("dark"), true);
		assert.equal(await settingsScreen.isThemeSelected("light"), false, "選択は排他のはず");

		await settingsScreen.selectTheme("light");
		assert.equal(await settingsScreen.isThemeSelected("light"), true);
		assert.equal(await settingsScreen.isThemeSelected("dark"), false);
	});

	// ─ テストケース: アプリを起動し直しても設定が保持される ─
	// 手順:
	//   1. 設定画面でダークを選ぶ
	//   2. アプリを起動し直す（newInstance。端末のデータは消さない）
	//   3. 設定画面を開き直し、ダークが選択済みのままであることを検証
	//
	// ⚠️ `resetState: true` を渡さないこと。AsyncStorage ごと消えるため、
	// 「保持されない」が正しい結果になり、検証そのものが無意味になる。
	it("アプリを起動し直しても選んだテーマが保持される", async () => {
		const settingsScreen = await gotoSettings();
		await settingsScreen.selectTheme("dark");

		await launchAppWithSession({ as: "anon" });

		const settingsScreenAfterRelaunch = await gotoSettings();
		assert.equal(
			await settingsScreenAfterRelaunch.isThemeSelected("dark"),
			true,
			"起動し直してもダークが選択済みのはず（AsyncStorage: theme_preference_v1）",
		);
		assert.equal(await settingsScreenAfterRelaunch.isThemeSelected("system"), false);
	});

	// ─ テストケース: ダークにしても検索フォームが操作できる ─
	// 手順:
	//   1. 設定画面でダークを選ぶ
	//   2. さがすタブへ戻る
	//   3. 検索フォームの主要な要素（見出し・地点入力・検索ボタン）が表示されることを検証
	//
	// ダーク対応で最も多い事故は「面を暗くしたら文字やボタンが背景に沈んで消える」。
	// Detox の `toBeVisible()` は面積の 75% 以上が可視であることを要求するので、
	// 要素が消える / はみ出す / 潰れる系の破綻はここで落ちる。
	// **色そのものの妥当性**（コントラスト比）は e2e-web 側の axe 監査が持つ。
	it("ダークにしても検索フォームが破綻せず操作できる", async () => {
		const settingsScreen = await gotoSettings();
		await settingsScreen.selectTheme("dark");

		const tabBar = new TabBar();
		const searchScreen = new SearchScreen();
		await tabBar.gotoSearch();
		await searchScreen.expectLoaded();

		await waitUntilVisible(searchScreen.locationInput);
		await waitUntilVisible(searchScreen.submitButton);
	});
});
