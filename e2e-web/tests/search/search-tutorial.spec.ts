import { test, expect } from "../../fixtures/test";

/**
 * 🎓 検索チュートリアルの表示テスト
 *
 * 目的: ja-JP 初回訪問時のチュートリアル自動表示と、完了後の再表示抑止
 *       (localStorage フラグ search_tutorial_seen_v1)を保証する。
 *
 * 注意: 他の全テストは fixtures/test.ts がフラグをシードして表示を抑止している。
 *       この spec だけは `test.use({ seedTutorialSeen: false })` でシードを外し、
 *       「未視聴状態」を再現する。
 */
test.use({ seedTutorialSeen: false });

test.describe("検索チュートリアル(ja-JP 初回訪問)", () => {
	// ─ テストケース: 初回訪問でチュートリアルが自動表示される ─
	// 手順:
	//   1. シードなしで "/" へ遷移し検索画面を表示する
	//   2. チュートリアル BottomSheet(Search.tutorial.page1 のタイトル
	//      「食べたい料理に気づけるアプリ」)が自動的に表示されることを検証
	// 補足: チュートリアルは isJapanese のときのみ自動表示される仕様
	//       (ブラウザロケール ja-JP 固定なので常に対象)
	test("初回訪問でチュートリアルが自動表示される", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByText("食べたい料理に気づけるアプリ")).toBeVisible();
	});

	// ─ テストケース: 完了後は再訪問しても表示されない ─
	// 手順:
	//   1. チュートリアルを最後まで「つぎへ」で進める(page1→page4)
	//   2. 最終ページで「あとで」を押して完了させる(現在地取得を避けるため
	//      「現在地を利用する」ではなく「あとで」で完了させる)
	//   3. localStorage に search_tutorial_seen_v1=true が保存されることを検証
	//   4. 検索画面へ明示的に再度アクセスする
	//      (expo-router の静的書き出しではタブグループ内のネスト遷移でブラウザの
	//      URL バーが実際の表示内容と一致しないことがあり、その状態で page.reload() すると
	//      URL バー上のパス(例: /map)に対応する別ルートの静的 HTML が読み込まれてしまう。
	//      そのため reload ではなく検索画面のパスへ明示的に goto する)
	//   5. チュートリアルが自動表示されないことを検証
	test("完了後は再訪問しても表示されない", async ({ page }) => {
		await page.goto("/");
		await expect(page.getByText("食べたい料理に気づけるアプリ")).toBeVisible();

		// page1 → page2 → page3 → page4 まで「つぎへ」で進める
		for (let i = 0; i < 3; i++) {
			await page.getByText("つぎへ", { exact: true }).click();
		}
		await expect(page.getByText("はじめよう", { exact: true })).toBeVisible();

		// 「あとで」を押して完了させる(現在地取得は避ける)
		await page.getByText("あとで", { exact: true }).click();

		await expect
			.poll(() => page.evaluate(() => window.localStorage.getItem("search_tutorial_seen_v1")))
			.toBe("true");

		await page.goto("/ja-JP/search");
		await expect(page.getByText("どんな料理を探しましょう？🍽")).toBeVisible();
		await expect(page.getByText("食べたい料理に気づけるアプリ")).toHaveCount(0);
	});
});
