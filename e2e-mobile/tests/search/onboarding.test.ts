import { LAUNCH_TIMEOUT, describeJapaneseLocale, launchAppWithSession } from "../../fixtures/e2e";
import { LoginScreen } from "../../screens/LoginScreen";
import { OnboardingScreen } from "../../screens/OnboardingScreen";
import { SearchScreen } from "../../screens/SearchScreen";

/**
 * 🚀 オンボーディング（#1486）の表示テスト（Tier 2）
 *
 * 目的: ja-JP 初回起動時の自動表示、矢印による課題 → 解決のフェーズ送り、前へ / 次へ、
 *       完了後の再表示抑止（AsyncStorage フラグ `search_tutorial_seen_v1`）を保証する。
 *       （e2e-web の tests/search/onboarding.spec.ts に対応）
 *
 * ## e2e-web との差分
 * - **未読状態の作り方**: e2e-web は `test.use({ seedTutorialSeen: false })` でシードを外す。
 *   ネイティブも #1027 で同じ方式に揃えた（起動引数 `e2eTutorialSeen`）。
 *   `resetState: true`（アプリのストレージごと消す）は iOS ではアンインストール相当で高コストなため
 *   （#1030 m-5）使わない
 * - **完了フラグの検証**（#1031 m6）: e2e-web は `page.evaluate` で localStorage を直接読んでいるが、
 *   Detox からアプリの AsyncStorage は読めない。**「アプリを再起動しても表示されない」**という
 *   ユーザーから観測できる事実に置き換える。ストレージへの永続化まで含めて検証できるため、
 *   タブ切り替えによる再訪問で代替するより強い検証になっている
 * - **権限ダイアログ**: E2E ビルドは起動時に権限を付与済み（fixtures/e2e.ts の
 *   `platformLaunchOptions()`）なので、位置情報・通知の説明画面は OS のダイアログを出さずに
 *   通り過ぎる。ここでは «Welcome まで着くこと» を見る
 *
 * ## 前提
 * オンボーディングは `isJapanese` のときだけ自動表示される（app-expo の search/index.tsx）。
 * デバイスロケールの ja-JP 固定は fixtures/e2e.ts + utils/locale.ts の責務（#1031 確定判断 B4）。
 */
// #1031 【設計】B4: app-expo 側が isJapanese でゲートしているため、
// 端末ロケールが ja-JP でない環境（ロケール未固定のローカルエミュレータ等）では spec ごと skip する
// （CI は e2e-mobile-test.yml の adb setprop で ja-JP に固定済み）
describeJapaneseLocale("オンボーディング（初回起動）", () => {
	const search = new SearchScreen();
	const onboarding = new OnboardingScreen();
	const login = new LoginScreen();

	beforeAll(async () => {
		// #1027 起動引数で「未読」をシードして初回起動を再現する（他の spec は既定の "既読" で起動する）。
		//
		// ⚠️ `waitForReady: false` にしているのは、起動完了の観測点がタブバー (`tab-search`) だから。
		// オンボーディングは検索画面の上へ push される全画面のルートなので、
		// この spec では「オンボーディングが出ること」自体を起動完了の観測点として直接待つ
		await launchAppWithSession({ as: "anon", tutorialSeen: false, waitForReady: false });
	});

	// ─ テストケース: 初回起動で自動表示され、フェーズ切り替えと前へ/次へが効き、完了すると再表示されない ─
	// 手順:
	//   1. 「未読」をシードして起動する（beforeAll）
	//   2. オンボーディングが自動表示されることを検証
	//   3. 1 枚目で「前へ」が **描画されていない** ことを検証（#1486 §1「1枚目は戻る操作無効」）
	//   4. 「次へ」を押すと解決フェーズが再生されることを検証（自動では再生されない）
	//   5. 2 枚目へ進み、「前へ」が現れることを検証
	//   6. 「前へ」で 1 枚目へ戻り、解決アニメーションが再生され直すことを検証（#1486 §1）
	//   7. 3 枚目まで進めて「次へ」でログイン画面へ出る（#1486 §4）
	//   8. ログインをスキップして許可フローを通し、Welcome まで着く（#1486 §5〜§7）
	//   9. 「はじめる」で完了し、検索画面へ戻ることを検証
	//  10. **シードを外して**（`tutorialSeen: "device"`）アプリを再起動する
	//  11. 自動表示されないことを検証（= 既読フラグが AsyncStorage へ永続化されている）
	//
	// ## ⚠️ 1 本にまとめている理由（旧 search-tutorial.test.ts から引き継ぐ）
	// オンボーディングを «2 度目に» 開く手段は、プラットフォームのどちらかで不安定だった:
	//
	// - 起動引数で未読をシードして開き直す … Android は開くが **iOS は開かない**
	//   （run 31677355367。理由は未特定）
	// - ヘルプボタン（?）から開く … iOS は開くが **Android はボタンが可視判定を通らない**
	//   （run 31698138582。`search-help-button` が 25 秒 75% 可視を満たさなかった）
	//
	// 両方で確実に開くのは **インストール直後の初回自動表示**だけなので、そこへ 1 本化する。
	// 起動が 1 回減る分だけ速くもなる。
	//
	// なお #1486 でヘッダーの `？` 側は「タイトルが可視判定を奪う」問題そのものを直しているが
	//（1 行固定 + ボタン幅の確保。app-expo の search/index.tsx を参照）、
	// この spec の構成はそれとは独立に «起動が 1 回で済む» という理由で維持している。
	// ## ⚠️ 「次へ」は 1 ページにつき 2 回
	// 1 押下目で解決フェーズ、2 押下目で次のページ（自動では切り替わらない）。
	// ページを送るヘルパは `goToNextStep` / `advanceToLastStep`、解決を出すだけなら `revealSolution`
	it("初回起動で自動表示され、フェーズ切り替えと前へ/次へが効き、完了すると再起動しても表示されない", async () => {
		// 初回起動は JS バンドル読込 + セッション注入を含むため、起動待ちと同じスケールで待つ
		await onboarding.expectShown(LAUNCH_TIMEOUT);
		await onboarding.expectStep(1);

		// ── #1486 §1: 1 枚目は戻る操作無効 ────────────────────────────
		const backOnFirstStep = await onboarding.backButtonExists();
		if (backOnFirstStep) {
			throw new Error("1 枚目で「前へ」が描画されている（#1486 §1「1枚目は戻る操作無効」に反する）");
		}

		// ── 矢印を押すと解決フェーズが再生される（自動では出ない） ─────────
		await onboarding.revealSolution(1);

		// ── #1486 §1: 2 枚目では「前へ」が出る ──────────────────────────
		// 1 枚目は解決フェーズで止まっているので、1 押下で 2 枚目へ送られる
		await onboarding.pressNext();
		await onboarding.expectStep(2);
		await onboarding.revealSolution(2);

		// ── #1486 §1: 戻ると課題状態から解決アニメーションを再生し直す ─────
		// 「戻った直後に解決文が見えていないこと」は e2e-web 側で検証する
		//（Detox は不透明度 0 の要素の «見えなさ» を待つのが不得手で、偽の赤になりやすい）。
		// ここでは «戻ったあとに改めて解決フェーズへ到達する» ことだけを見る
		await onboarding.pressBack();
		await onboarding.expectStep(1);
		await onboarding.revealSolution(1);

		// ── #1486 §4: 3 枚目の「次へ」で既存ログイン画面へ ────────────────
		await onboarding.advanceToLastStep();
		await onboarding.revealSolution(3);
		await onboarding.pressNext();

		// ── #1486 §5〜§7: ログインをスキップ → 許可フロー → Welcome ────────
		// ログイン画面の「スキップ」はオンボーディング経由のときだけ描画される（#1486 §4）
		await login.expectOpened();
		await login.skip();
		await onboarding.waitForWelcome();

		// #1486 §7 「はじめる」でアプリ本体（検索画面）へ戻る。
		// ⚠️ 単発の pressStart + expectLoaded にしないこと。Welcome は紙吹雪が
		// 無限ループし（確定仕様）、録画有効時はタップが取りこぼされることがある
		//（詳細は pressStartUntilExited のコメント）。着地するまでタップし直す
		await onboarding.pressStartUntilExited(search.headerTitle);
		await search.expectLoaded();

		// ── #1027: 既読フラグが AsyncStorage へ永続化されている ──────────
		// 【重要】ここで `tutorialSeen: true`（既定）にしてはいけない。
		// シードした値をそのまま読み返すだけになり、**永続化を一切検証しない偽の緑**になる。
		// `"device"` は起動引数を渡さない指定で、アプリは AsyncStorage の実データを読む
		await launchAppWithSession({ as: "anon", tutorialSeen: "device" });
		await search.expectOnboardingAbsent();
	});
});
