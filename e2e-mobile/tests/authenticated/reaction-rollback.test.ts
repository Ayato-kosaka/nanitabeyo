import { strict as assert } from "node:assert";

import { describeAuthenticated, device, launchAppWithSession, visibleNow, waitUntilVisible } from "../../fixtures/e2e";
import { ResultScreen } from "../../screens/ResultScreen";
import { SearchScreen } from "../../screens/SearchScreen";
import { DishCategoriesScreen } from "../../screens/DishCategoriesScreen";
import { disableNetwork, enableNetwork, isNetworkControlAvailable } from "../../utils/network";

/**
 * ↩️ いいね / 保存の楽観更新が API 失敗時にロールバックされることのテスト（DAT-01 / #1501）
 *
 * e2e-web の tests/authenticated/reaction-rollback.spec.ts に対応する。
 *
 * ## 何を守っているか（#1501）
 * `ActionButtons.handleLike` / `handleSave` は押下と同時にストアを楽観更新する。
 * 修正前は API が失敗しても catch でログを出すだけで **楽観更新を戻していなかった**ため、
 * 「画面ではいいね済みなのにサーバには保存されていない」状態がリロードするまで残り続けた。
 * #1501 で `isLiked` / `likeCount` / `isSaved` と liked・saved タブの一覧を
 * **楽観更新の直前に読んだ値そのもの**へ戻し、`showSnackbar` で再試行できるようにした。
 *
 * ## API をどうやって失敗させるか
 * **Detox には `page.route()` に相当する仕組みが無い**（tests/mutation/review-submit-loading.test.ts の
 * 「web 側とのカバレッジ差」に同じ記述がある）。そこで端末の Wi-Fi / モバイルデータを
 * adb で落とし、`useAPICall` から見て通常のネットワークエラーになる状態を作る
 * （utils/network.ts。`device.setURLBlacklist` は同期機構の除外であってブロックではないので使えない）。
 *
 * ⚠️ **Android 専用**。iOS シミュレータには通信を落とす公式手段が無いため、
 * iOS では spec ごと skip する（通信ありのまま走らせると「緑だが検証内容が嘘」になる）。
 *
 * ## dev DB への影響 → 無し（@mutation ではない）
 * リアクションのリクエストは端末から出る前に失敗するため、書き込みは 1 件も発生しない。
 * フィードへ辿り着くまでの導線（検索・トピック提案・料理メディア取得）はすべて参照系。
 * 成功パスの検証は tests/mutation/reactions.test.ts が担当する。
 *
 * ## 観測点（#1031 B1 の回避策 + スナックバー）
 * いいね済みかどうかは `accessibilityLabel`（`likeActive` / `likeInactive`）で観測する
 * （ResultScreen 参照）。ただし **「元の値へ戻った」だけでは不十分**で、
 * そもそもタップが効いていない場合も同じ結果になる。そこで
 *
 *   1. **失敗スナックバー（`global-snackbar`）が出る** = catch 経路（= ロールバックの置き場）を通った
 *   2. **ラベルが押す前と同一** = 楽観更新が残っていない
 *
 * の 2 点を組で検証する。1 だけ・2 だけでは証拠にならない。
 *
 * ⚠️ 楽観更新の「一瞬反転している状態」は観測点にしない。通信断による失敗は即座に返るため、
 * Detox は原理的にその窓を取り逃がす（tests/smoke/share-link.test.ts で 2 度 CI を赤くした教訓）。
 * 反転そのものは e2e-web 側（リクエストを保留して assert できる）で担保している。
 */
describeAuthenticated("いいね / 保存の失敗時ロールバック", () => {
	const search = new SearchScreen();
	const dishCategories = new DishCategoriesScreen();
	const result = new ResultScreen();

	/** ネットワーク制御が使えるか。使えない環境（iOS / adb 不在）では各テストを skip する */
	let networkControllable = false;

	// #1031 【バグ】beforeAll だと前のテストが残した画面状態を次が引き継ぎ、タップがオーバーレイに阻まれる。
	// ログイン済みセッションの注入は匿名クォータを消費しないため、毎回「起動 → 検索 → 結果フィード」をやり直す
	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
		networkControllable = isNetworkControlAvailable();
		if (!networkControllable) return;

		await search.expectLoaded();
		await search.clearLocationIfPresent();
		await search.typeLocation("渋谷");
		await search.selectLocationSuggestion(0);
		await search.submit();

		await dishCategories.expectLoaded();
		await dishCategories.chooseFirstDishCategory();
		await result.expectLoaded();
	});

	// ⚠️ 通信断と同期機構の停止は **絶対に持ち越さない**。持ち越すと後続の spec が軒並み落ちる
	afterEach(async () => {
		enableNetwork();
		await device.enableSynchronization();
	});

	/**
	 * 通信を落とした状態を作る。
	 *
	 * 同期機構を先に切るのは、スナックバーが 4 秒で自動的に消えるタイマーを持っており、
	 * 有効なままだと「タイマーが終わるまで idle にならない」＝ 消えてから評価されるため
	 * （tests/mutation/review-submit-loading.test.ts と同じ理由）。
	 */
	async function goOffline(): Promise<void> {
		await device.disableSynchronization();
		disableNetwork();
	}

	/** iOS / adb 不在で skip するときの共通メッセージ */
	function warnSkipped(): void {
		console.warn(
			"⚠️ 通信を落とせない環境（iOS シミュレータ、または adb 不在）のため、ロールバック検証を skip します。",
		);
	}

	// ─ テストケース: いいねが失敗したら表示が元へ戻る ─
	// 手順:
	//   1. ログイン済みで結果フィードを開き、いいねボタンのラベル（= 現在の状態）を控える
	//   2. 端末の通信を落とす
	//   3. いいねをタップする（POST v1/dish-media/{id}/reaction がネットワークエラーになる）
	//   4. 失敗スナックバーが出ることを検証 = catch 経路を通った
	//   5. ラベルが手順 1 と同一であることを検証 = 楽観更新が残っていない
	//      修正前はここで「いいね済み」のラベルのままになる
	it("いいねの API が失敗したら、ボタンの状態が押す前へ戻る", async () => {
		if (!networkControllable) {
			warnSkipped();
			return;
		}

		const before = await result.likeLabel();

		await goOffline();
		await result.like();

		await waitUntilVisible(result.snackbar);

		const after = await result.likeLabel();
		assert.equal(after, before, "API 失敗後はいいねボタンのラベルが押す前へ戻るはず（楽観更新のロールバック）");
	});

	// ─ テストケース: 保存が失敗したら表示が元へ戻る ─
	// 手順はいいねと同じ（保存ボタン dish-action-save に対して実施）
	it("保存の API が失敗したら、ボタンの状態が押す前へ戻る", async () => {
		if (!networkControllable) {
			warnSkipped();
			return;
		}

		const before = await result.saveLabel();

		await goOffline();
		await result.save();

		await waitUntilVisible(result.snackbar);

		const after = await result.saveLabel();
		assert.equal(after, before, "API 失敗後は保存ボタンのラベルが押す前へ戻るはず（楽観更新のロールバック）");
	});

	// ─ テストケース: 失敗しても押し直せる（#1205 の連打ガードが解除されている） ─
	// ロールバックは `catch` に、ガード解除は `finally` にある。ロールバックを足したあとも
	// finally が壊れていないこと = 失敗後にもう一度押せることを確認する。
	//
	// 手順:
	//   1. 通信を落としていいねをタップし、失敗スナックバーが出るまで待つ
	//   2. スナックバーが消えるのを待ってから **もう一度**タップする
	//      （消える前に押すとタップがスナックバーに吸われ、ガードの検証にならない）
	//   3. 再びスナックバーが出ることを検証 = 2 回目の handleLike が最後まで走った
	//   4. ラベルは依然として押す前の値であることを検証
	it("失敗しても連打ガードが解除され、もう一度押せる", async () => {
		if (!networkControllable) {
			warnSkipped();
			return;
		}

		const before = await result.likeLabel();

		await goOffline();
		await result.like();
		await waitUntilVisible(result.snackbar);

		// スナックバーは 4 秒で自動的に消える。同期機構を切っているので実時間で待つ
		await new Promise((resolve) => setTimeout(resolve, 5_000));
		assert.equal(await visibleNow(result.snackbar), false, "スナックバーは自動的に消えているはず");

		await result.like();
		await waitUntilVisible(result.snackbar);

		const after = await result.likeLabel();
		assert.equal(after, before, "2 回目も失敗するため、ラベルは押す前のままのはず");
	});
});
