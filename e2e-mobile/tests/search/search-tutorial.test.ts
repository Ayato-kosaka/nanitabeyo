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
	//   1. 起動し直し、ヘルプボタン（?）からチュートリアルを開く（直前のテストが完了フラグを
	//      立てているため自動表示は使えない。視聴済みフラグに依存しない実ユーザー導線を使う）
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
		// ⚠️ ここで «起動引数で未視聴をシードして開き直す» をしないこと。
		// 直前のテストが視聴済みフラグを立てているため 2 度目の自動表示が必要になるが、
		// 自動表示は `isFocused && !isLoading && hasSeenTutorial === false` が揃った
		// **マウント 1 回きり**で、iOS では `tutorialSeen: false` で起動し直しても開かず
		// 2 分待って落ちた（run 31677355367。失敗時スクリーンショットは «シートの無い検索画面»）。
		//
		// このテストが見たいのは **開いたシートを連打しても壊れないこと**であって自動表示ではない。
		// 自動表示と永続化は 1 本目が担保しているので、ここは実ユーザーの導線であり
		// 視聴済みフラグに依存しないヘルプボタン（?）から開く。起動が 1 回減る分だけ速くもなる。
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();
		await search.openTutorialFromHelp();

		await search.tutorialNextRapid(3);

		// 連打の結末は **2 通りとも正常**である。ページは 4 枚しかないので、3 回目のタップが
		// 最終ページの「はじめよう」に当たればチュートリアルはその場で完了して閉じる。
		// 「連打後も必ずシートが開いたまま」を要求すると、アプリは正しいのに落ちる
		//（run 31684453333 の iOS で実測: completeTutorial が CTA を 25 秒待って落ちた）。
		if (await search.tutorialStillOpen()) {
			// まだ開いている → 描画が壊れていないこと（CTA がちょうど一方だけ）を見てから、
			// 残りのページを通常タップで進み切り「あとで」で完了できることまで確認する
			await search.expectTutorialOperable();
			await search.completeTutorial();
		}

		// どちらの結末でも、最後に検索画面が操作できる状態へ戻っていることが本命の不変条件
		await search.expectLoaded();
	});
});
