import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures/test";
import { SettingsPage } from "../../pages/SettingsPage";
import { SearchPage } from "../../pages/SearchPage";
import { TabBar } from "../../pages/TabBar";

/**
 * 🌗 表示テーマ（システム追従 / ライト / ダーク）のテスト（#1509 SET-05）
 *
 * ## このファイルが守るもの
 * 1. 設定画面から 3 択を選べ、**アプリ全体の面色が実際に変わる**こと
 * 2. 選んだ設定が **リロード後も保持される**こと（AsyncStorage = web では localStorage）
 * 3. 「システム追従」が **OS のスキームに従う**こと
 * 4. **ライトモードの色が 1 つも変わっていない**こと（#1509 の絶対条件）
 *
 * ## 4 をなぜここで見るのか
 * この PR は約 120 箇所の色リテラルをパレット経由へ移す変更で、**移し替えのついでに
 * ライトの色が 1 つでもズレたら失敗**という合否条件がオーナーから出ている。
 * ユニットテスト（app-expo/contexts/ThemeProvider.test.tsx）はパレットの «値» を固定するが、
 * 「その値が実際に画面へ届いているか」までは見ない。ここでは描画結果の computed style を見る。
 *
 * 期待値は main のリテラルをそのまま 10 進へ直したもので、**丸めてはいけない**。
 */

/** #1509 main のライト値（`app-expo/constants/Palette.ts` の light と一致させること） */
const LIGHT = {
	surface: "rgb(255, 255, 255)", // #FFFFFF … Card / ヘッダー / タブバー
	textPrimary: "rgb(26, 26, 26)", // #1A1A1A … 見出し・本文
	appShellBackdrop: "rgb(243, 244, 246)", // #F3F4F6 … web の中央カラムの外側
	brand: "rgb(240, 85, 55)", // #F05537 … ブランド
} as const;

/** #1509 ダーク値（`schemes.dark` 由来。同上） */
const DARK = {
	surface: "rgb(32, 31, 31)", // #201F1F … surfaceContainer
	textPrimary: "rgb(229, 226, 225)", // #E5E2E1 … onSurface
	appShellBackdrop: "rgb(14, 14, 14)", // #0E0E0E … surfaceContainerLowest
} as const;

/** 要素の computed style を 1 プロパティだけ読む */
const computed = (page: Page, testId: string, property: string) =>
	page
		.getByTestId(testId)
		.evaluate((el: Element, prop: string) => window.getComputedStyle(el).getPropertyValue(prop), property);

test.describe("表示テーマ（#1509 SET-05）", () => {
	// ─ テストケース: 既定は「システム追従」 ─
	// 手順:
	//   1. 設定画面を開く
	//   2. 3 択がすべて表示され、「システム追従」だけが選択済みであることを検証
	test("既定はシステム追従で、3 択がすべて表示される", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		// #1629 表示テーマの 3 択は «端末設定 → 表示テーマ» の先の専用ページにある
		await settingsPage.gotoTheme();

		await expect(settingsPage.themeSelector).toBeVisible();
		await expect(settingsPage.themeOption("system")).toBeVisible();
		await expect(settingsPage.themeOption("light")).toBeVisible();
		await expect(settingsPage.themeOption("dark")).toBeVisible();

		await expect(settingsPage.themeOptionCheck("system")).toBeVisible();
		await expect(settingsPage.themeOptionCheck("light")).toHaveCount(0);
		await expect(settingsPage.themeOptionCheck("dark")).toHaveCount(0);
	});

	// ─ テストケース: ライト → ダーク → ライト で面色が往復する ─
	// 手順:
	//   1. 設定画面でライトを選び、面色が main のライト値であることを検証（回帰の基準点）
	//   2. ダークを選び、面色が暗くなることを検証
	//   3. ライトへ戻し、**1 と完全に同じ値**へ戻ることを検証
	//
	// 3 が #1509 の絶対条件そのもの。往復して同じ値に戻らなければ、
	// どこかでライトの色が壊れている。
	test("ライト → ダーク → ライトで面色が往復し、ライトは元の値に戻る", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		// #1629 表示テーマの 3 択は «端末設定 → 表示テーマ» の先の専用ページにある
		await settingsPage.gotoTheme();

		await settingsPage.selectTheme("light");
		await expect(settingsPage.themeCardSurface).toHaveCSS("background-color", LIGHT.surface);
		expect(await computed(appPage, "app-shell-backdrop", "background-color")).toBe(LIGHT.appShellBackdrop);

		await settingsPage.selectTheme("dark");
		await expect(settingsPage.themeCardSurface).toHaveCSS("background-color", DARK.surface);
		expect(await computed(appPage, "app-shell-backdrop", "background-color")).toBe(DARK.appShellBackdrop);

		await settingsPage.selectTheme("light");
		await expect(settingsPage.themeCardSurface).toHaveCSS("background-color", LIGHT.surface);
		expect(await computed(appPage, "app-shell-backdrop", "background-color")).toBe(LIGHT.appShellBackdrop);
	});

	// ─ テストケース: 選んだテーマがリロード後も保持される ─
	// 手順:
	//   1. 設定画面でダークを選ぶ
	//   2. ページをリロードして設定画面を開き直す
	//   3. ダークが選択済みで、面色もダークのままであることを検証
	//
	// ⚠️ ここは **UI で切り替えてから reload する**こと。localStorage を直接シードすると
	// 「保存経路が動いていること」を検証したことにならない（読み出しだけのテストになる）。
	test("選んだテーマがリロード後も保持される", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		// #1629 表示テーマの 3 択は «端末設定 → 表示テーマ» の先の専用ページにある
		await settingsPage.gotoTheme();
		await settingsPage.selectTheme("dark");

		await appPage.reload();
		await expect(settingsPage.themeSelector).toBeVisible();

		await expect(settingsPage.themeOptionCheck("dark")).toBeVisible();
		await expect(settingsPage.themeCardSurface).toHaveCSS("background-color", DARK.surface);
	});

	// ─ テストケース: システム追従は OS のスキームに従う ─
	// 手順:
	//   1. OS のスキームをダークにして設定画面を開く（既定 = システム追従）
	//   2. 面色がダークであることを検証
	//   3. OS のスキームをライトへ戻すと、面色もライトへ戻ることを検証
	test("システム追従は OS のカラースキームに従う", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await appPage.emulateMedia({ colorScheme: "dark" });
		// #1629 表示テーマの 3 択は «端末設定 → 表示テーマ» の先の専用ページにある
		await settingsPage.gotoTheme();

		await expect(settingsPage.themeOptionCheck("system")).toBeVisible();
		await expect(settingsPage.themeCardSurface).toHaveCSS("background-color", DARK.surface);

		await appPage.emulateMedia({ colorScheme: "light" });
		await expect(settingsPage.themeCardSurface).toHaveCSS("background-color", LIGHT.surface);
	});

	// ─ テストケース: 明示的なライトは OS のダークより優先される ─
	// 手順:
	//   1. OS のスキームをダークにして設定画面を開く
	//   2. 「ライト」を明示的に選ぶ
	//   3. OS がダークのままでも、面色がライトであることを検証
	test("明示的なライトは OS のダーク設定より優先される", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await appPage.emulateMedia({ colorScheme: "dark" });
		// #1629 表示テーマの 3 択は «端末設定 → 表示テーマ» の先の専用ページにある
		await settingsPage.gotoTheme();

		await settingsPage.selectTheme("light");
		await expect(settingsPage.themeCardSurface).toHaveCSS("background-color", LIGHT.surface);
		expect(await computed(appPage, "app-shell-backdrop", "background-color")).toBe(LIGHT.appShellBackdrop);
	});

	// ─ テストケース: 検索フォーム（起動直後の画面）もダークになる ─
	// 手順:
	//   1. 設定画面でダークを選ぶ
	//   2. さがすタブへ戻る
	//   3. 見出しの文字色がダーク側の値になっていることを検証
	//
	// 「設定でダークにしたのに、最初に見える画面が白いまま」では切替機能の意味が無いため、
	// 検索フォームまでが本 PR の範囲になっている（#1509 の範囲決定）。
	test("設定をダークにすると検索フォームもダークになる", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		const searchPage = new SearchPage(appPage);
		const tabBar = new TabBar(appPage);

		// #1629 表示テーマの 3 択は «端末設定 → 表示テーマ» の先の専用ページにある
		await settingsPage.gotoTheme();
		await settingsPage.selectTheme("dark");

		await tabBar.gotoSearch();
		await searchPage.expectLoaded();
		expect(await computed(appPage, "search-header-title", "color")).toBe(DARK.textPrimary);
	});

	// ─ テストケース: ライトの検索フォームは main の色のまま ─
	// 手順:
	//   1. ライトを明示的に選んでさがすタブを開く
	//   2. 見出しの文字色が #1A1A1A のままであることを検証
	//
	// #1509 の絶対条件（ライトのピクセルを変えない）の、検索フォーム側の担保。
	test("ライトの検索フォームは main と同じ色のまま", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		const searchPage = new SearchPage(appPage);
		const tabBar = new TabBar(appPage);

		// #1629 表示テーマの 3 択は «端末設定 → 表示テーマ» の先の専用ページにある
		await settingsPage.gotoTheme();
		await settingsPage.selectTheme("light");

		await tabBar.gotoSearch();
		await searchPage.expectLoaded();
		expect(await computed(appPage, "search-header-title", "color")).toBe(LIGHT.textPrimary);
	});

	// ─ テストケース: ダークでもコントラストの重大な違反が出ない ─
	// 手順:
	//   1. 端末設定でダークに切り替える
	//   2. **設定が載っている 3 画面すべて**を axe で監査する
	//   3. critical / serious の違反が無いことを検証
	//
	// axe の color-contrast 規則は「暗い面に暗い文字」「明るい面に明るい文字」を機械検出する。
	// ダーク対応で最も起きやすい事故（面だけ暗くして文字を黒のまま残す）はここで捕まる。
	// tests/search/search-accessibility.spec.ts と同じ判定基準に揃えてある。
	//
	// ⚠️ #1583 で **監査対象を 1 画面から 3 画面へ広げ、#1629 で 4 画面にした。**
	// テーマの切替 UI が «端末設定» へ移ったので、素直に書き換えると監査対象も
	// 端末設定（コントロール 2 つだけの小さな画面）だけになり、それまで見ていた
	// マイページ（行が 10 以上ある）が監査から外れる。**移設で監査が痩せる**ので、
	// 切替と監査を分け、規約 4 行を持つ «なに食べよについて» も足してある。
	test("ダークでも axe の重大な違反(critical/serious)が無い", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		// #1629 3 択は «端末設定 → 表示テーマ» の先へ移った（マイページにも端末設定にも無い）
		await settingsPage.gotoTheme();
		await settingsPage.selectTheme("dark");
		await expect(settingsPage.themeCardSurface).toHaveCSS("background-color", DARK.surface);

		/** 今表示されている画面を axe に掛け、critical / serious が無いことを見る */
		const auditCurrentScreen = async (label: string) => {
			const results = await new AxeBuilder({ page: appPage }).include("body").analyze();
			const seriousOrCritical = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");

			expect(
				seriousOrCritical,
				`${label}:\n` +
					seriousOrCritical
						.map((v) => `${v.id}(${v.impact}): ${v.description}\n  ${v.nodes.map((n) => n.target).join(", ")}`)
						.join("\n"),
			).toEqual([]);
		};

		await auditCurrentScreen("表示テーマ");

		// 端末設定（#1629 でテーマが抜けた後も、言語・ハプティクスの行が残る）
		await settingsPage.gotoDeviceSettings();
		await auditCurrentScreen("端末設定");

		// マイページ（#1583 以前はここが唯一の監査対象だった）
		await settingsPage.goto();
		await settingsPage.expectLoaded();
		await auditCurrentScreen("マイページ");

		// なに食べよについて（#1583 で新設。規約 4 行 + バージョン）
		await settingsPage.openAbout();
		await auditCurrentScreen("なに食べよについて");
	});
});
