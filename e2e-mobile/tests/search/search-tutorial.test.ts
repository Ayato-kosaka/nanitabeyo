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

	// ─ テストケース: 「つぎへ」を連打してもチュートリアルが壊れない（#1084 P3） ─
	// 手順:
	//   1. 「未視聴」を起動引数でシードして起動し直す（直前のテストが完了フラグを立てているため、
	//      beforeAll の起動をそのまま引き継ぐとチュートリアルが出ない）
	//   2. 1 ページ目で「つぎへ」を 3 連打する（multiTap = 待機を挟まない 1 アクション）
	//   3. シートが開いたままで、プライマリ CTA が「つぎへ」「はじめよう」のちょうど一方だけである
	//      ことを検証（= 連打でシートが閉じたり、CTA ごと描画が壊れたりしていない）
	//   4. 連打後も操作が続けられ、最後まで進めて完了できることを検証
	//      （3 連打で最終ページに着いていても completeTutorial() は成立する。#1086 で
	//        「つぎへ」の可視を無条件に待つ実装をやめ、プレス回数に依存しない形にした）
	// 補足: **設計（#1084 §3-2）の「3 連打 → 2 ページ目に居る」は採用していない**。
	//       この前提は「全タップが同じ fromIndex を読む」＝ タップの間に React の再描画が入らない
	//       ことを要求するが、multiTap が 1 ネイティブアクションでも RN 側は 1 プレスずつ
	//       JS イベントとして処理するため成立するとは限らない（設計 §8 未確定 1 のまま）。
	//       e2e-web では同じ前提が **実測で崩れた**（3 連打で 2〜3 ページ進み、3 回中 2 回落ちた）。
	//       そこで web と同じく **プレスが何回処理されても必ず成立する不変条件** に置き換えている
	//       （#1086: この不変条件が検知できるのは「シートが閉じた」「CTA ごと消えた/二重になった」
	//        であって、「currentPage がページ範囲を外れた」ではない。詳細は
	//        SearchScreen.expectTutorialOperable のコメントを参照）。
	//       また最終ページのプライマリ CTA は「現在地を利用する」で、押すと現在地取得を伴い
	//       シートを閉じるため、設計の「最終ページで multiTap(3) → finish が出たまま」は成立しない
	it("「つぎへ」を連打してもチュートリアルが壊れない", async () => {
		await launchAppWithSession({ as: "anon", tutorialSeen: false, waitForReady: false });
		await search.expectTutorialShown(LAUNCH_TIMEOUT);

		await search.tutorialNextRapid(3);
		await search.expectTutorialOperable();

		// 連打後も操作が続けられる（残りのページを通常タップで進み切り、「あとで」で完了できる）
		await search.completeTutorial();
		await search.expectLoaded();
	});
});
