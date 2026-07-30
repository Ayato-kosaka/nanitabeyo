import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";

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

/**
 * P3 で「つぎへ」を押す回数の上限(無限ループ防止)。
 * 現在のチュートリアルは 4 ページなので、最悪でも 3 回で最終ページに着く。
 */
const MAX_TUTORIAL_PAGE_PRESSES = 10;

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

	// ─ テストケース: 「つぎへ」を連打してもチュートリアルが壊れない(#1084 P3) ─
	// 手順:
	//   1. 未視聴シードでチュートリアルを自動表示させる
	//   2. 1 ページ目で「つぎへ」を 3 連打する(待機を挟まない実 pointer 連打)
	//   3. シートが開いたままで、プライマリ CTA が「つぎへ」「はじめよう」の
	//      **ちょうど一方だけ**であることを検証
	//      (= 連打でシートが閉じたり、CTA ごと描画が壊れたりしていない)
	//   4. 連打後も操作が続けられ、最終ページまで進めて完了できることを検証
	// 補足: **設計(#1084 §3-2)の「3 連打 → 2 ページ目に居る」は web では成立しない**。
	//       Playwright の連打は 1 プレスずつ別のブラウザタスクとして届き、React は discrete event の
	//       更新を各ハンドラの終わりに同期コミットするため、**プレスの間に再描画が入る**。
	//       その結果 3 連打で 2〜3 ページ進むことがあり、実測でも 3 回中 2 回落ちた
	//       (「同じ fromIndex を全タップが読む」という前提が web では崩れる。Detox の multiTap は
	//        1 ネイティブアクションだが、それでも RN 側は 1 プレスずつ JS イベントとして処理する)。
	//       「何ページ進むか」はプレスが何回処理されたかに依存して決定論的に書けないため、
	//       **プレス回数に依存せず必ず成立する不変条件**へ置き換えている:
	//       連打後もプライマリ CTA がちょうど 1 つ見えていること(= シートが閉じていない/
	//       CTA ごと消えていない)と、連打後も操作が続けられること。
	//       ⚠️ #1086 この不変条件は **「currentPage がページ範囲を外れたこと」の検知にはならない**。
	//       実装上は範囲外でも `isLastPage` が false になって `search-tutorial-next` が描画され続け、
	//       `currentConfig` も `?? tutorialPages[0]` でフォールバックするため件数は 1 のまま通る
	//       (そもそも handleNextPage が Math.min でクランプしており範囲外になり得ない)。
	//       検知できるのは「シートが閉じた」「CTA ごと消えた/二重になった」という壊れ方だけ。
	//       無害な回帰ガードとして残している。
	//       また設計は「最終ページで 3 連打」としていたが、最終ページのプライマリ CTA は
	//       「現在地を利用する」で、押すと現在地取得を伴い **シートを閉じる**（しかも連打対象と
	//       同じ座標に現れる）。「finish が出たまま」は構造的に成立しないため採用していない。
	test("「つぎへ」を連打してもチュートリアルが壊れない", async ({ page }) => {
		const searchPage = new SearchPage(page);

		await page.goto("/");
		await expect(page.getByText("食べたい料理に気づけるアプリ")).toBeVisible();

		await searchPage.tutorialNextRapid(3);

		// シートは閉じておらず、プライマリ CTA はちょうど 1 つ
		await expect(searchPage.tutorialOverlay).toBeVisible();
		await expect
			.poll(
				async () =>
					(await searchPage.tutorialNextButton.count()) + (await searchPage.tutorialFinishButton.count()),
				{ message: "連打でプライマリ CTA が消えた/二重になった" },
			)
			.toBe(1);

		// 連打後も操作が続けられる(残りのページを 1 ページずつ進み切れる)。
		// 「つぎへ」が無くなった時点で最終ページに着いている。
		// #1086 「つぎへ」の存在確認と押下は pressTutorialNextIfPresent で原子的に行う
		// (プライマリ CTA は単一ノードで testID だけが入れ替わるため、count() で確認してから
		//  click() すると『はじめよう』へ化けたノードを叩いてシートを閉じてしまうことがある)
		for (let i = 0; i < MAX_TUTORIAL_PAGE_PRESSES; i += 1) {
			if (!(await searchPage.pressTutorialNextIfPresent())) break;
		}
		await expect(searchPage.tutorialFinishButton).toBeVisible();

		// 完了操作も通る(現在地取得を避けるため「あとで」で完了させる)
		await page.getByText("あとで", { exact: true }).click();
		await expect(page.getByText("どんな料理を探しましょう？🍽")).toBeVisible();
	});
});
