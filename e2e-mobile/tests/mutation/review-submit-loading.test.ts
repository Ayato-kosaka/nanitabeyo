import { strict as assert } from "node:assert";

import { describeMutation, device, launchAppWithSession, waitUntil } from "../../fixtures/e2e";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { SelectRestaurantScreen } from "../../screens/SelectRestaurantScreen";
import { TabBar } from "../../screens/TabBar";

/**
 * ⏳ レビュー投稿中のローディング表示テスト @mutation（#1136 / PR #1166）
 *
 * e2e-web の tests/authenticated/review-submit-loading.spec.ts に対応する。
 *
 * ## 何を守っているか（#1136）
 * `ReviewForm.handleSubmit` はメディアアップロードと 3 本の API 呼び出しを直列で行うため、
 * 完了まで無反応に見える時間が長い。#1136 で `isSubmitting`(useState) を追加し、
 * `PrimaryButton` の `loading` に渡すことで **ボタン内にスピナー(Lottie)を出しつつ押下も止める**
 * （`PrimaryButton` は `isDisabled = disabled || loading`）。
 *
 * ## ⚠️ web 側とのカバレッジ差（意図的）
 * e2e-web は `page.route()` で POST `v1/dishes` を遅延・失敗させ、
 * 「投稿中の維持」と **「失敗時にローディングが解除されること」** の 2 本を持つ。
 * **Detox には `page.route()` に相当する仕組みが無い。**
 * app-expo 側の E2E フックも `lib/e2e/` にある 4 つ（セッション注入・チュートリアル種・
 * メディア選択差し替え・先読みプローブ）だけで、**ネットワークを差し替えるものは存在しない**。
 * そのため mobile 側は **実投稿の途中でスピナーが出て押下が止まること**だけを見る。
 * `finally` での解除（失敗時の解除）は **web 側だけで担保している**。
 *
 * ## dev DB への影響
 * ネットワークを止められない = 投稿は最後まで実際に走るため、この spec は
 * tests/mutation/review-post.test.ts と同じく **不可逆**（レビューが 1 件積み上がる）。
 * `RUN_MUTATION=1` を明示した手動実行でのみ走らせること。本文には `[E2E]` を付ける。
 *
 * ## 同期機構を切っている理由
 * Android の Detox は **通信中を「busy」とみなして待つ**ため、既定のままだと
 * 「投稿中」のアサーションが投稿完了まで待たされ、**見たかったスピナーが消えた後に評価される**。
 * 投稿ボタンを押す直前に `device.disableSynchronization()` を呼び、検証後に戻す
 * （iOS は fixtures/e2e.ts の `detoxEnableSynchronization: 0` により元から無効）。
 */
describeMutation("レビュー投稿中のローディング @mutation", () => {
	const tabBar = new TabBar();
	const myDishes = new MyDishesScreen();
	const selectRestaurant = new SelectRestaurantScreen();

	// #1031 【バグ】beforeAll だと前のテストが残した画面状態を次が引き継ぎ、タップがオーバーレイに阻まれる
	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
	});

	// 同期機構を切ったまま次のテストへ持ち越さない（切りっぱなしだと後続が全て前のめりに評価される）
	afterEach(async () => {
		await device.enableSynchronization();
	});

	// ─ テストケース: 投稿中はボタンにスピナーが出て押下も止まる ─
	// 手順:
	//   1. レビューフォームを投稿可能な状態まで埋める（review-post.test.ts と同一の導線）
	//   2. 同期機構を切ってから投稿ボタンを押す
	//   3. ボタン内スピナー（review-submit-button-loading）が出るまで待つ
	//      = `isSubmitting` が true になった瞬間を捉える
	//   4. その状態でボタンが無効（enabled=false）であることを検証
	//   5. 投稿が完了してフォームが閉じることを検証（後片付けを兼ねる）
	it("投稿中はボタンにスピナーが出て押下も止まる @mutation", async () => {
		await tabBar.gotoMyDishes();
		await myDishes.gotoRecordDish();

		// #1031 実在のチェーン店名を使う。`isFoodAndDrinkPlaceForUser()` が true の候補でないと
		// 地図移動だけで終わり、お店の詳細（= 投稿導線）へ進めないため
		await selectRestaurant.expectLoaded();
		await selectRestaurant.searchRestaurant("スターバックスコーヒー 渋谷");
		await selectRestaurant.selectSuggestion(0);

		// #1375（3 巡目）pick モードでは詳細画面へ行かず、選んだ時点で統合フォームへ戻る。
		// #1375（6 巡目）そこで最初に出るのは **料理カテゴリー**（オーナー指示の «お店 → 料理 → 写真»）
		await myDishes.chooseDishCategoryInRecordFlow("コーヒー", MyDishesScreen.FORM_TIMEOUT);
		await myDishes.chooseMediaInRecordFlow({}, MyDishesScreen.FORM_TIMEOUT);
		await myDishes.expectFormLoaded(MyDishesScreen.FORM_TIMEOUT);

		await myDishes.fillComment("[E2E] 投稿中ローディング表示テストです");
		await myDishes.fillPrice("500");
		await myDishes.rate(5);

		// 通信中を待たれるとスピナーが消えた後の状態しか見えない（冒頭コメント参照）
		await device.disableSynchronization();
		await myDishes.submit();

		// スピナーは `loading` が true の間しかマウントされないため、出現したこと自体が
		// 「isSubmitting が立った」証跡になる。画像アップロードから始まるので数秒は維持される
		await waitUntil(() => myDishes.isSubmitting(), {
			timeout: MyDishesScreen.FORM_TIMEOUT,
			interval: 250,
			description: "投稿ボタン内のスピナー（投稿中の表示）",
		});

		// 見た目だけでなく押下も止まっていること。`PrimaryButton` が `Pressable` へ渡す
		// `disabled`（= loading）がネイティブの enabled 属性へ落ちる
		const enabled = await myDishes.isSubmitButtonEnabled();
		assert.notEqual(
			enabled,
			true,
			"投稿中にもかかわらず投稿ボタンが押下可能なままになっている（PrimaryButton の loading→disabled 連動が壊れている疑い）",
		);
		// null（属性が取れなかった）を黙って通すと「押せてしまう」退行を見逃すため、その場合は明示的に落とす
		assert.notEqual(enabled, null, "投稿ボタンの enabled 属性を取得できず、押下可否を判定できなかった");

		// 後片付け: 投稿を最後まで走らせ、フォームが閉じる（= 成功）ところまで見届ける。
		// ここは通信完了待ちなので同期機構を戻してから待つ
		await device.enableSynchronization();
		await myDishes.expectFormClosed(MyDishesScreen.FORM_TIMEOUT);
	});
});
