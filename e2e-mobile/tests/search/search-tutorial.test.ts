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

	// ─ テストケース: 初回起動で自動表示され、連打しても壊れず、完了すると再表示されない ─
	// 手順:
	//   1. 「未視聴」をシードして起動する（beforeAll）
	//   2. チュートリアルが自動表示されることを検証
	//   3. 1 ページ目で「つぎへ」を 3 連打する（#1084 P3。multiTap = 待機を挟まない 1 アクション）
	//   4. 連打の結末を検証（開いたままなら CTA がちょうど一方だけ / 閉じていればそれも正常）
	//   5. まだ開いていれば最後まで進めて「あとで」で完了させる
	//   6. チュートリアルが閉じ、検索画面が操作できる状態になることを検証
	//   7. **シードを外して**（`tutorialSeen: "device"`）アプリを再起動する
	//   8. チュートリアルが自動表示されないことを検証（= 視聴済みフラグが AsyncStorage へ永続化されている）
	//
	// ## ⚠️ 連打の検証を «別テスト» に分けないこと（3 度作り直して分かった）
	// 連打を別テストにすると「チュートリアルを **2 度目に** 開く」手段が必要になる。
	// ところが 2 度目を開く手段は **プラットフォームのどちらかで必ず失敗する**:
	//
	// - 起動引数で未視聴をシードして開き直す … Android は開くが **iOS は開かない**
	//   （run 31677355367。失敗時スクリーンショットは «シートの無い検索画面»。理由は未特定）
	// - ヘルプボタン（?）から開く … iOS は開くが **Android はボタンが可視判定を通らない**
	//   （run 31698138582。`search-help-button` が 25 秒 75% 可視を満たさなかった）
	//
	// 両方で確実に開くのは **インストール直後の初回自動表示**だけなので、そこへ 1 本化する。
	// 連打は «開いた直後のシート» に対して行うのが本来の P3 のシナリオでもあり、
	// 起動が 1 回減る分だけ速くもなる。検証している事実（自動表示 / 連打耐性 / 永続化）は
	// 分割していた頃から 1 つも減っていない。
	it("初回起動で自動表示され、連打しても壊れず、完了すると再起動しても表示されない", async () => {
		// 初回起動は JS バンドル読込 + セッション注入を含むため、起動待ちと同じスケールで待つ
		await search.expectTutorialShown(LAUNCH_TIMEOUT);

		// ── #1084 P3: 「つぎへ」の連打でシートが壊れない ──────────────
		await search.tutorialNextRapid(3);

		// 連打の結末は **2 通りとも正常**である。ページは 4 枚しかないので、3 回目のタップが
		// 最終ページの「はじめよう」に当たればチュートリアルはその場で完了して閉じる
		//（run 31684453333 の iOS で実測: 閉じた後に completeTutorial が CTA を 25 秒待って落ちた）。
		if (await search.tutorialStillOpen()) {
			// まだ開いている → 描画が壊れていないこと（CTA がちょうど一方だけ）を見てから、
			// 残りのページを通常タップで進み切り「あとで」で完了できることまで確認する
			await search.expectTutorialOperable();
			await search.completeTutorial();
		}
		// 「はじめよう」で閉じた場合も「あとで」で閉じた場合も markTutorialAsSeen を通るため、
		// どちらの結末でも次の永続化の検証は成立する
		await search.expectLoaded();

		// ── #1027: 視聴済みフラグが AsyncStorage へ永続化されている ──────
		// 【重要】ここで `tutorialSeen: true`（既定）にしてはいけない。
		// シードした値をそのまま読み返すだけになり、**永続化を一切検証しない偽の緑**になる。
		// `"device"` は起動引数を渡さない指定で、アプリは AsyncStorage の実データを読む
		await launchAppWithSession({ as: "anon", tutorialSeen: "device" });
		await search.expectTutorialAbsent();
	});
});
