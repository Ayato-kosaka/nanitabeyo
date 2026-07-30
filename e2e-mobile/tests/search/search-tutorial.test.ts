import { LAUNCH_TIMEOUT, describeJapaneseLocale, launchAppWithSession } from "../../fixtures/e2e";
import { SearchScreen } from "../../screens/SearchScreen";

/**
 * 🎓 検索チュートリアルの表示テスト（Tier 2）
 *
 * 目的: ja-JP 初回起動時のチュートリアル自動表示と、完了後の再表示抑止
 *       （AsyncStorage フラグ `search_tutorial_seen_v1`）を保証する。
 *       （e2e-web の tests/search/search-tutorial.spec.ts に対応。#1031 確定判断 B5 で PR-3 のスコープ）
 *
 * ## e2e-web との差分
 * - **未視聴状態の作り方**: e2e-web は `test.use({ seedTutorialSeen: false })` でシードを外す。
 *   ネイティブも #1027 で同じ方式に揃えた（起動引数 `e2eTutorialSeen`）。
 *   `resetState: true`（アプリのストレージごと消す）は iOS ではアンインストール相当で高コストなため
 *   （#1030 m-5）使わない
 * - **完了フラグの検証**（#1031 m6）: e2e-web は `page.evaluate` で localStorage を直接読んでいるが、
 *   Detox からアプリの AsyncStorage は読めない。**「アプリを再起動しても表示されない」**という
 *   ユーザーから観測できる事実に置き換える。ストレージへの永続化まで含めて検証できるため、
 *   タブ切り替えによる再訪問で代替するより強い検証になっている
 * - **完了操作**: 最終ページのプライマリ CTA「はじめよう」は現在地取得（OS の位置情報アクセス）を伴うため、
 *   e2e-web と同じくセカンダリ CTA「あとで」で完了させる（どちらも markTutorialAsSeen を通る）
 *
 * ## 前提
 * チュートリアルは `isJapanese` のときだけ自動表示される（app-expo の search/index.tsx）。
 * デバイスロケールの ja-JP 固定は fixtures/e2e.ts + utils/locale.ts の責務（#1031 確定判断 B4）。
 */
// #1031 【設計】B4: チュートリアルは app-expo 側が isJapanese でゲートしているため、
// 端末ロケールが ja-JP でない環境（ロケール未固定のローカルエミュレータ等）では spec ごと skip する
// （CI は e2e-mobile-test.yml の adb setprop で ja-JP に固定済み）
describeJapaneseLocale("検索チュートリアル（初回起動）", () => {
	const search = new SearchScreen();

	beforeAll(async () => {
		// #1027 起動引数で「未視聴」をシードして初回起動を再現する（他の spec は既定の "視聴済み" で起動する）。
		//
		// ⚠️ `waitForReady: false` にしているのは、起動完了の観測点がタブバー (`tab-search`) だから。
		// チュートリアルは BottomSheet（Android では別ウィンドウの Modal）として最前面に出るため、
		// この spec では「チュートリアルが出ること」自体を起動完了の観測点として直接待つ
		await launchAppWithSession({ as: "anon", tutorialSeen: false, waitForReady: false });
	});

	// ─ テストケース: 初回起動で自動表示され、完了すると次回以降は表示されない ─
	// 手順:
	//   1. 「未視聴」をシードして起動する（beforeAll）
	//   2. チュートリアル（search-tutorial-overlay）が自動表示されることを検証
	//   3. 「つぎへ」で最終ページまで進め、「あとで」で完了させる
	//   4. チュートリアルが閉じ、検索画面が操作できる状態になることを検証
	//   5. **シードを外して**（`tutorialSeen: "device"`）アプリを再起動する
	//   6. チュートリアルが自動表示されないことを検証（= 視聴済みフラグが AsyncStorage へ永続化されている）
	it("初回起動で自動表示され、完了すると再起動しても表示されない", async () => {
		// 初回起動は JS バンドル読込 + セッション注入を含むため、起動待ちと同じスケールで待つ
		await search.expectTutorialShown(LAUNCH_TIMEOUT);

		await search.completeTutorial();
		await search.expectLoaded();

		// #1027 【重要】ここで `tutorialSeen: true`（既定）にしてはいけない。
		// シードした値をそのまま読み返すだけになり、**永続化を一切検証しない偽の緑**になる。
		// `"device"` は起動引数を渡さない指定で、アプリは AsyncStorage の実データを読む
		await launchAppWithSession({ as: "anon", tutorialSeen: "device" });
		await search.expectTutorialAbsent();
	});
});
