import { test, expect } from "../../fixtures/test";
import { OnboardingPage } from "../../pages/OnboardingPage";
import { SearchPage } from "../../pages/SearchPage";

/**
 * 🚀 オンボーディング（#1486）の表示テスト
 *
 * 目的: ja-JP 初回訪問時の自動表示、矢印による課題 → 解決のフェーズ送り、
 *       前へ / 次へ / スキップ、完了後の再表示抑止
 *       （localStorage フラグ `search_tutorial_seen_v1`）を保証する。
 *
 * 注意: 他の全テストは fixtures/test.ts がフラグをシードして表示を抑止している。
 *       この spec だけは `test.use({ seedTutorialSeen: false })` でシードを外し、
 *       「未読状態」を再現する。
 *
 * ⚠️ **web では OS の許可ダイアログが出ない。** 位置情報はブラウザの権限で、
 *    Playwright の既定コンテキストでは権限状態が «prompt» のまま、要求だけが
 *    «尋ねずに» 即答で拒否される。通知も同様。説明画面は「本当にダイアログが
 *    出ている（= 要求が応答待ちのまま）」ときだけ描画される設計
 *    （probe + INSTANT_SETTLE_GRACE_MS）なので、既定コンテキストでは
 *    位置情報・通知の説明画面は **表示されずに** 次へ進む。
 *    説明画面そのものの描画・回答済みスキップの検証は末尾の describe 2 つが行う。
 */
test.use({ seedTutorialSeen: false });

/** 3 ステップの課題文（#1486 §1 の文言。\n は文言側で決めた明示改行） */
const PROBLEM_TEXTS = [
	"そもそも何食べたいか決まらない",
	"お店の候補が多すぎて、\n決めるの疲れるなぁ",
	"友達の意見も聞きたいなぁ",
] as const;

test.describe("オンボーディング(ja-JP 初回訪問)", () => {
	// ─ テストケース: 初回訪問でオンボーディングが自動表示される ─
	// 手順:
	//   1. シードなしで "/" へ遷移し検索画面を表示する
	//   2. 3 ステップ画面が自動で開き、1 枚目の課題文が出ることを検証
	// 補足: 自動表示は isJapanese のときだけ（ブラウザロケール ja-JP 固定なので常に対象）
	test("初回訪問でオンボーディングが自動表示される", async ({ page }) => {
		const onboardingPage = new OnboardingPage(page);

		await page.goto("/");

		await onboardingPage.expectLoaded();
		await expect(page.getByText(PROBLEM_TEXTS[0])).toBeVisible();
	});

	// ─ テストケース: 解決フェーズは「次へ」を押すまで再生されない ─
	// 手順:
	//   1. 自動表示されたオンボーディングの 1 枚目を待つ
	//   2. 待っても解決文が透明のままである（= 自動再生されない）ことを検証
	//   3. 「次へ」を 1 回押すと解決文が不透明になることを検証
	//   4. 課題文が **残っている** ことを検証
	// 補足: 旧実装は約 1.5 秒で自動的に解決フェーズへ切り替わっていたが、課題文を読み終える前に
	//       画面が変わるという指摘を受けて «矢印を押したときだけ» 出す形になった。
	//       手順 2 の待ち時間（2 秒）は旧仕様の 1.5 秒より長い。ここを縮めると
	//       自動再生が戻ってきても気づけない
	test("解決フェーズは「次へ」を押すまで再生されない", async ({ page }) => {
		const onboardingPage = new OnboardingPage(page);

		await page.goto("/");
		await onboardingPage.expectStep(1);

		await expect(onboardingPage.solutionText(1)).toHaveCount(1);
		await page.waitForTimeout(2_000);
		expect(await onboardingPage.solutionOpacity(1)).toBeLessThan(0.1);

		await onboardingPage.pressNext();

		await onboardingPage.expectSolutionVisible(1);
		await expect(page.getByText("提案されたオススメの料理の中から選ぶだけ")).toBeVisible();
		await expect(page.getByText(PROBLEM_TEXTS[0])).toBeVisible();
	});

	// ─ テストケース: 1枚目では戻る操作が無効 ─
	// 手順:
	//   1. 自動表示された 1 枚目を待つ
	//   2. 「前へ」が描画されていないことを検証
	//   3. 2 枚目へ進むと「前へ」が現れることを検証
	// 補足: #1486 §1「1枚目は戻る操作無効」。
	//       «2 枚目へ進む» は「次へ」2 押下（解決フェーズ → 次のページ）であることに注意
	test("1枚目では「前へ」が出ず、2枚目から出る", async ({ page }) => {
		const onboardingPage = new OnboardingPage(page);

		await page.goto("/");
		await onboardingPage.expectStep(1);
		await expect(onboardingPage.backButton).toHaveCount(0);

		await onboardingPage.goToNextStep(1);

		await onboardingPage.expectStep(2);
		await expect(onboardingPage.backButton).toBeVisible();
	});

	// ─ テストケース: 前のページへ戻ると課題状態から再生し直す ─
	// 手順:
	//   1. 2 枚目へ進み、解決フェーズまで再生させる
	//   2. 「前へ」で 1 枚目へ戻る
	//   3. 戻った先が **課題状態**（解決文が透明）であることを検証
	//   4. 「次へ」で 1 枚目の解決フェーズが改めて再生されることを検証
	// 補足: #1486 §1「前のページへ戻った場合は、課題状態から解決アニメーションを再生する」。
	//       フェーズをページごとに覚える実装にすると、戻った瞬間から解決状態で出てしまう。
	//       自動再生が無くなったので、手順 3 は «時間が経つと勝手に解決へ変わる» 心配なく検証できる
	test("前のページへ戻ると解決アニメーションを再生し直す", async ({ page }) => {
		const onboardingPage = new OnboardingPage(page);

		await page.goto("/");
		await onboardingPage.goToNextStep(1);
		await onboardingPage.revealSolution(2);

		await onboardingPage.pressBack();

		await onboardingPage.expectStep(1);
		await expect.poll(() => onboardingPage.solutionOpacity(1)).toBeLessThan(0.1);

		await onboardingPage.pressNext();
		await onboardingPage.expectSolutionVisible(1);
	});

	// ─ テストケース: 3枚目の「次へ」で既存ログイン画面へ進む ─
	// 手順:
	//   1. 3 枚目まで進める
	//   2. 「次へ」でログイン画面へ遷移することを検証
	//   3. オンボーディング経由なので「スキップ」が出ていることを検証
	// 補足: #1486 §4。スキップは `skippable=1` を付けたときだけ出る
	//       （口コミ投稿等からのログイン導線には出さない）
	test("3枚目の「次へ」でログイン画面へ進み、スキップが出る", async ({ page }) => {
		const onboardingPage = new OnboardingPage(page);

		await page.goto("/");
		await onboardingPage.advanceToLastStep();

		// 3 枚目でも «解決を出す» → «送る» の 2 押下でログイン画面へ抜ける
		await onboardingPage.pressNext();
		await onboardingPage.pressNext();

		await expect(page).toHaveURL(/\/auth\/login/);
		await expect(page.getByTestId("login-screen")).toBeVisible();
		await expect(page.getByTestId("login-screen-skip")).toBeVisible();
	});

	// ─ テストケース: 「スキップ」でもログイン画面へ進む ─
	// 手順:
	//   1. 1 枚目で「スキップ」を押す
	//   2. ログイン画面へ遷移することを検証
	// 補足: #1486 §1「「スキップ」でも既存ログイン画面へ」
	test("「スキップ」でもログイン画面へ進む", async ({ page }) => {
		const onboardingPage = new OnboardingPage(page);

		await page.goto("/");
		await onboardingPage.expectStep(1);

		await onboardingPage.pressSkip();

		await expect(page).toHaveURL(/\/auth\/login/);
	});

	// ─ テストケース: ログインをスキップすると Welcome へ進む（通知許可は要求されない） ─
	// 手順:
	//   1. 3 枚目まで進めてログイン画面へ出る
	//   2. ログイン画面の「スキップ」を押す
	//   3. 通知許可を **飛ばして** Welcome 画面へ着くことを検証
	// 補足: #1486 §6「ログインをスキップしたユーザーには通知許可を要求しない」。
	//       ゲスト（匿名）ユーザーは `isGuestUser` が true なので通知画面へ入らない。
	//       ヘッドレスブラウザは位置情報の要求へ **ダイアログを出さずに即答で拒否**するため、
	//       位置情報の説明画面は描画されない（INSTANT_SETTLE_GRACE_MS で回答済み扱いに畳まれる。
	//       「拒否済みなのに一瞬画面が出る」報告の修正）。説明画面そのものの描画は
	//       下の「位置情報のダイアログが本当に出ているとき」describe が検証する
	test("ログインをスキップすると Welcome へ進む", async ({ page }) => {
		const onboardingPage = new OnboardingPage(page);

		await page.goto("/");
		await onboardingPage.advanceToLastStep();
		await onboardingPage.pressNext();
		await onboardingPage.pressNext();
		await page.getByTestId("login-screen-skip").click();

		await expect(onboardingPage.welcomeScreen).toBeVisible({ timeout: 60_000 });
		await expect(onboardingPage.notificationsScreen).toHaveCount(0);
	});

	// ─ テストケース: Welcome の「はじめる」で完了フラグが立ち、再表示されない ─
	// 手順:
	//   1. Welcome 画面まで進める
	//   2. 確定コピーが出ていることを検証（#1486 §7）
	//   3. 「はじめる」を押す
	//   4. localStorage に search_tutorial_seen_v1=true が保存されることを検証
	//   5. 検索画面へ着地し、オンボーディングが出ていないことを検証
	//   6. 検索画面へ改めてアクセスしても自動表示されないことを検証
	// 補足: #1486 §3「既存のチュートリアル既読ローカルストレージキーを再利用」。
	//       手順 6 で reload ではなく goto を使うのは、expo-router の静的書き出しでは
	//       タブグループ内のネスト遷移で URL バーが表示内容と一致しないことがあり、
	//       reload すると別ルートの静的 HTML が読み込まれてしまうため
	test("Welcome の「はじめる」で完了し、再訪問しても表示されない", async ({ page }) => {
		const searchPage = new SearchPage(page);
		const onboardingPage = new OnboardingPage(page);

		await page.goto("/");
		await onboardingPage.advanceToLastStep();
		await onboardingPage.pressNext();
		await onboardingPage.pressNext();
		await page.getByTestId("login-screen-skip").click();
		await expect(onboardingPage.welcomeScreen).toBeVisible({ timeout: 60_000 });

		await expect(page.getByText("なに食べよへようこそ！")).toBeVisible();
		await expect(page.getByText("今日の「食べたい」を見つけにいこう。")).toBeVisible();

		await onboardingPage.startButton.click();

		await expect.poll(() => page.evaluate(() => window.localStorage.getItem("search_tutorial_seen_v1"))).toBe("true");
		await searchPage.expectLoaded();
		await expect(onboardingPage.screen).toHaveCount(0);

		await page.goto("/ja-JP/search");
		await searchPage.expectLoaded();
		await expect(onboardingPage.screen).toHaveCount(0);
	});

	// ─ テストケース: 「次へ」を連打してもオンボーディングが壊れない(#1084 P3 相当) ─
	// 手順:
	//   1. 未読シードでオンボーディングを自動表示させる
	//   2. 1 枚目で「次へ」を 3 連打する(待機を挟まない実 pointer 連打)
	//   3. 3 枚を飛び越して壊れることなく、いずれかのステップかログイン画面に居ることを検証
	// 補足: **「3 連打 → N 枚目に居る」とは書けない**。Playwright の連打は 1 プレスずつ
	//       別のブラウザタスクとして届き、React は discrete event の更新を各ハンドラの
	//       終わりに同期コミットするため、プレスの間に再描画が入る（旧 spec で実測済み）。
	//       いまは 1 ページにつき 2 押下（解決 → 送り）なので届く先はさらに読めない。
	//       そこで **プレス回数に依存せず必ず成立する不変条件** を見る:
	//       「壊れた中間状態（どのステップでもなく、ログイン画面でもない）にならないこと」。
	//       `hasLeftRef` が効いていないとログイン画面が二重に push されるが、
	//       それも «ログイン画面 1 枚» の検証で捕まる
	test("「次へ」を連打してもオンボーディングが壊れない", async ({ page }) => {
		const onboardingPage = new OnboardingPage(page);

		await page.goto("/");
		await onboardingPage.expectStep(1);

		await onboardingPage.pressNextRapid(3);

		const readState = async () => {
			if ((await page.getByTestId("login-screen").count()) > 0) return "login";
			for (const step of [1, 2, 3] as const) {
				if ((await onboardingPage.problemText(step).count()) > 0) return `step${step}`;
			}
			return "broken";
		};

		await expect
			.poll(readState, { message: "連打でオンボーディングが壊れた（どのステップでもログイン画面でもない）" })
			.not.toBe("broken");

		// 3 枚目を越えてログイン画面まで抜けた場合は、**1 枚だけ**であること。
		// `hasLeftRef` が効いていないと連打の回数だけ push され、ここが 2 以上になる
		if ((await readState()) === "login") {
			await expect(page.getByTestId("login-screen")).toHaveCount(1);
		}
	});
});

test.describe("ヘルプボタンからの再表示", () => {
	// 既読状態から `？` で開く導線を見るので、シードを既定（既読）へ戻す
	test.use({ seedTutorialSeen: true });

	// ─ テストケース: 既読でも `？` から開ける ─
	// 手順:
	//   1. 既読シードで検索画面を開き、自動表示されないことを確認
	//   2. `？` を押してオンボーディングが開くことを検証
	// 補足: #1486 §3「`？` からユーザーが明示的に開いた場合は既読状態に関係なく表示する」
	test("既読でも `？` からオンボーディングを開ける", async ({ page }) => {
		const searchPage = new SearchPage(page);
		const onboardingPage = new OnboardingPage(page);

		await searchPage.goto();
		await searchPage.expectLoaded();
		await expect(onboardingPage.screen).toHaveCount(0);

		await searchPage.openOnboarding();

		await onboardingPage.expectLoaded();
		await expect(page.getByText(PROBLEM_TEXTS[0])).toBeVisible();
	});

	// ─ テストケース: `？` から開いた場合は 3 枚で検索画面へ戻る ─
	// 手順:
	//   1. `？` からオンボーディングを開く
	//   2. 3 枚目まで進めて「次へ」を押す
	//   3. ログイン画面へ行かず、検索画面へ戻ることを検証
	// 補足: #1486 §3 の `？` 導線は 3 ステップだけを見せる（`mode=manual`）。
	//       ログイン・権限・Welcome は初回導線のためのもので、
	//       既にアプリ本体を使っている人へ再度通す意味が無い
	test("`？` から開いた場合は 3 枚で検索画面へ戻る", async ({ page }) => {
		const searchPage = new SearchPage(page);
		const onboardingPage = new OnboardingPage(page);

		await searchPage.goto();
		await searchPage.openOnboarding();
		await onboardingPage.advanceToLastStep();

		await onboardingPage.pressNext();

		await searchPage.expectLoaded();
		await expect(onboardingPage.screen).toHaveCount(0);
		await expect(page.getByTestId("login-screen")).toHaveCount(0);
	});
});

test.describe("位置情報のダイアログが本当に出ているとき", () => {
	// ─ テストケース: 応答待ちの間だけ説明画面（見出し + ダミーダイアログ）が表示される ─
	// 手順:
	//   1. getCurrentPosition を «永遠に応答しない» 実装へ差し替える
	//      （= ブラウザの許可プロンプトが出たままユーザーが答えていない状態の再現）
	//   2. オンボーディング → ログインスキップまで進める
	//   3. 説明画面の見出しと、中央のダミー OS ダイアログの文言が表示されることを検証
	// 補足: ヘッドレスの既定コンテキストは要求へ即答するため、説明画面の描画は
	//       この «応答保留» の再現でしか検証できない。ダミーダイアログの文言は
	//       locales/ja-JP.json の Onboarding.location.dialog と対応する
	test("応答待ちの間は説明とダミーダイアログが表示される", async ({ page }) => {
		const onboardingPage = new OnboardingPage(page);

		await page.addInitScript(() => {
			if (navigator.geolocation) {
				// 成功も失敗も呼ばない = プロンプトが出たまま。permissions.query は既定の "prompt" のまま
				navigator.geolocation.getCurrentPosition = () => {};
			}
		});

		await page.goto("/");
		await onboardingPage.advanceToLastStep();
		await onboardingPage.pressNext();
		await page.getByTestId("login-screen-skip").click();

		await expect(onboardingPage.locationScreen).toBeVisible();
		await expect(page.getByText("近くのお店を、すぐ見つけよう 📍")).toBeVisible();
		await expect(page.getByText("Appの使用中は許可")).toBeVisible();
	});
});

test.describe("位置情報が回答済みのとき", () => {
	// Playwright の permissions オプションで «granted（回答済み）» の状態を作る。
	// 既定コンテキストは «prompt（未回答）» なので、上のフローテストでは説明画面が表示される
	test.use({ permissions: ["geolocation"], geolocation: { latitude: 35.681236, longitude: 139.767125 } });

	// ─ テストケース: 回答済みなら位置情報の説明画面を出さずに Welcome へ進む ─
	// 手順:
	//   1. MutationObserver を仕込み、位置情報画面が一瞬でも DOM に現れたら記録する
	//   2. オンボーディング → ログインスキップまで進める
	//   3. Welcome に着くこと、位置情報画面が **一度も** 現れなかったことを検証
	// 補足: 「web だと位置情報画面が一瞬出て直ぐ次に進む。拒否されてるなら出ないべきでは」
	//       という報告の回帰テスト。probe（permissions.query）が prompt 以外を返したら
	//       説明画面は描画すらしない設計（OnboardingPermissionScreen の isAskable）。
	//       Welcome 到着後の「count 0」では一瞬の表示を見逃すため、Observer で全期間を監視する
	test("回答済みなら位置情報画面を出さずに Welcome へ進む", async ({ page }) => {
		const onboardingPage = new OnboardingPage(page);

		await page.addInitScript(() => {
			const flagged = window as unknown as { __locationScreenAppeared?: boolean };
			const observer = new MutationObserver(() => {
				if (document.querySelector('[data-testid="onboarding-location"]')) {
					flagged.__locationScreenAppeared = true;
				}
			});
			observer.observe(document.documentElement, { childList: true, subtree: true });
		});

		await page.goto("/");
		await onboardingPage.advanceToLastStep();
		await onboardingPage.pressNext();
		await page.getByTestId("login-screen-skip").click();

		await expect(onboardingPage.welcomeScreen).toBeVisible({ timeout: 60_000 });
		expect(
			await page.evaluate(
				() => (window as unknown as { __locationScreenAppeared?: boolean }).__locationScreenAppeared ?? false,
			),
		).toBe(false);
	});
});
