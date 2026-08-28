import { strict as assert } from "node:assert";

import { device, launchAppWithSession, localeDeepLink } from "../../fixtures/e2e";
import { DishCategorySelectScreen } from "../../screens/DishCategorySelectScreen";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { RestaurantDetailScreen } from "../../screens/RestaurantDetailScreen";
import { RestaurantFeedScreen } from "../../screens/RestaurantFeedScreen";

/**
 * 🏪 店舗詳細とその配下 3 画面のルーティングテスト（#1386）
 *（e2e-web の tests/my-dishes/restaurant-routes.spec.ts に対応）
 *
 * ## ネイティブで最も重要なのはハードウェアバック
 * #1359 のログイン・#1368 の法務ドキュメントと同じ構図。BlurModal は自前の BackHandler
 *（`app-expo/features/blurModal/hooks/useBlurModal.tsx`）で戻るキーを握っており、
 * 「表示状態が遷移と無関係な boolean」であることが #498 の根だった。#1386 で撤去した 6 枚
 *（店舗詳細 1100 / レビュー投稿 1200 / 入札 1300 / 料理カテゴリ選択 1100 / フィード 1100）は
 * すべてルートになり、戻る責務は Navigator（スタックの pop）へ移った。その乗り換えを実端末で見る。
 *
 * ## Web との差分
 * e2e-web は API をモックして実データ相当の店舗詳細を描き、`toHaveURL` でルート化を守る。
 * Detox には API モックの仕組みが無く、実在する restaurantId を用意するには dev DB へ
 * 店舗を作る（= @mutation 相当の書き込み）ことになる。そこでネイティブ側は
 * **「ディープリンクで着地でき、戻る操作で行き止まりにならない」** ことに絞る。
 * 存在しない id で着地しても各画面のヘッダー（戻る導線）は描かれる——これは
 * 「戻る導線をデータの分岐の外に置く」という実装上の不変条件そのもので、
 * ここが崩れると Web もネイティブも行き止まりになる。
 *
 * ## dev DB への影響
 * 無し（読み取りのみ。存在しない id なので API は 404 を返す）。
 */
/** モックできないので «実在しない» id を使う。画面の «器» が描かれることを見る */
const UNKNOWN_RESTAURANT_ID = "e2e-1386-unknown-restaurant";

describe("店舗詳細のルート（#1386）", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。セッション注入起動は匿名クォータを消費しないため
	// （fixtures/e2e.ts の launchAppWithSession）、テストごとに起動し直して独立性を担保する

	// ─ テストケース: 店舗詳細へディープリンクで着地でき、戻ると行き止まりにならない ─
	// #1386 【設計】以前この画面は地図タブの BlurModal の中身で、**URL を持たなかった**。
	// ルート化で共有・リロード・ディープリンクが成立する。
	// 手順:
	//   1. nanitabeyo:///ja-JP/restaurant/<id> へ直接着地する
	//   2. 画面タイトル（ScreenHeader = BlurModal 実装には無い観測点）が出ることを検証
	//   3. Android はハードウェアバック / iOS はヘッダーの戻るボタンで離脱する
	//   4. 履歴が無いので食べたい/食べたタブ（ゲスト表示）へ倒れることを検証
	it("ディープリンクで着地でき、戻る操作で食べたい/食べたタブへ倒れる", async () => {
		const detailScreen = new RestaurantDetailScreen();
		const myDishesScreen = new MyDishesScreen();

		await launchAppWithSession({
			as: "anon",
			url: localeDeepLink(`restaurant/${UNKNOWN_RESTAURANT_ID}`),
			// タブバー（tab-search）は店舗詳細の下に居ないため、既定の起動完了待ちは使えない
			waitForReady: false,
		});
		await detailScreen.expectOpened();

		if (device.getPlatform() === "android") {
			await device.pressBack();
		} else {
			await detailScreen.goBack();
		}

		// 履歴が無い着地なので、戻る導線は食べたい/食べたタブ（このスタックの根）への replace に倒れる。
		// 匿名セッションなのでゲスト表示になる
		await myDishesScreen.expectGuestViewLoaded();
	});

	// ─ テストケース: 料理カテゴリ選択がルートで開け、戻る操作で離脱できる ─
	// #1386 旧実装は投稿フォームの中の `DishCategoryModal`（既定 z1100 = 親 z1200 より小さい）。
	// オートコンプリートを BlurModal の中に置いた唯一の残りで、#528 の当事者でもある。
	// 手順:
	//   1. nanitabeyo:///ja-JP/restaurant/<id>/dish-category へ直接着地する
	//   2. タイトルと検索入力欄が出ることを検証（= 独立した画面になっている）
	//   3. Android はハードウェアバック / iOS はヘッダーの戻るボタンで離脱する
	//   4. この画面から離れたことを検証
	it("料理カテゴリ選択はディープリンクで着地でき、戻る操作で離脱できる", async () => {
		const dishCategoryScreen = new DishCategorySelectScreen();

		await launchAppWithSession({
			as: "anon",
			url: localeDeepLink(`restaurant/${UNKNOWN_RESTAURANT_ID}/dish-category`),
			waitForReady: false,
		});
		await dishCategoryScreen.expectOpened();

		if (device.getPlatform() === "android") {
			await device.pressBack();
		} else {
			await dishCategoryScreen.goBack();
		}

		// 遷移先（投稿フォーム）はマウント時にメディア選択を起動するため、ここでは
		// 「この画面から離れた」ことまでを見る（フォーム側の検証は @mutation テストが持つ）
		await dishCategoryScreen.expectClosed();
	});

	// ─ テストケース: フィードがルートで開け、× で店舗詳細へ倒れる ─
	// #1386 旧実装は `DishMediaModal`（既定 z1100 = 親と同値）。
	// ⚠️ 存在しない id では料理メディアが 0 件になる。**スピナーで固着しないこと**まで見る
	//    （取得失敗時はストアが hasFetchedInitial を false のまま返すため、
	//     error を見ないと永久にローディングになる。feed.tsx のコメント参照）
	// 手順:
	//   1. nanitabeyo:///ja-JP/restaurant/<id>/feed へ直接着地する
	//   2. フィード画面が開き、«見るものが無い» 表示になることを検証
	//   3. × で閉じると、履歴が無いので店舗詳細へ倒れることを検証
	it("フィードはディープリンクで着地でき、× で店舗詳細へ倒れる", async () => {
		const feedScreen = new RestaurantFeedScreen();
		const detailScreen = new RestaurantDetailScreen();

		await launchAppWithSession({
			as: "anon",
			url: localeDeepLink(`restaurant/${UNKNOWN_RESTAURANT_ID}/feed`),
			waitForReady: false,
		});
		await feedScreen.expectOpened();
		await feedScreen.expectEmpty();

		// 0 件なので投稿 CTA は出ない（出ていたら «存在しないメディアへのレビュー» を開ける導線になる）
		const hasCta = await feedScreen.hasWriteReviewButton();
		assert.equal(hasCta, false, "料理メディアが 0 件のときは投稿 CTA を描かないはず");

		await feedScreen.close();

		await detailScreen.expectOpened();
	});
});
