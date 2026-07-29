import { describeMutation, launchAppWithSession } from "../../fixtures/e2e";
import { ReviewScreen } from "../../screens/ReviewScreen";
import { SelectRestaurantScreen } from "../../screens/SelectRestaurantScreen";
import { TabBar } from "../../screens/TabBar";

/**
 * ✏️ レビュー投稿のテスト @mutation（e2e-web の tests/authenticated/review-post.spec.ts に対応）
 *
 * ## この spec が dev DB に書き込むもの / 戻せるか
 * | 操作                              | 実体                                   | 戻せるか |
 * | --------------------------------- | -------------------------------------- | -------- |
 * | 検索候補から飲食店を選ぶ          | `createAndOpenRestaurant()` → restaurants | ❌ 削除導線が無い |
 * | レビュー投稿                      | POST `v1/dishes` → `v1/dish-media` → レビュー | ❌ 削除導線が無い |
 * | メディアのアップロード            | ストレージへ 8x8 の PNG                | ❌ |
 *
 * ⚠️ **この spec は不可逆**。トグルのように元へ戻す手段が無いため、実行するたびに dev 環境へ
 * レビューが 1 件積み上がる。`RUN_MUTATION=1` を明示した手動実行でのみ走らせること
 * （既定では jest.config.js の `testPathIgnorePatterns` によりファイルすら読み込まれない）。
 * 本文には `[E2E]` プレフィックスを付け、後から機械的に判別できるようにしている。
 *
 * ## OS のフォトピッカーをどう越えているか（#1031 B6 の再開）
 * `ReviewForm` は画面に入った直後に `selectMedia()` を呼び、OS のフォトピッカーを開く。
 * ピッカーは **アプリ外プロセス**で動くため Detox からは操作できず、以前はこの spec 自体を見送っていた。
 * 現在は E2E ビルドに限りメディア選択を固定画像へ差し替えるフックを app-expo 側へ用意している
 * （`app-expo/lib/e2e/selectMediaStub.ts`。本番混入は metro の resolver 差し替えと
 * `scripts/assert-no-e2e-hook.mjs` の sentinel ゲートで二重に防いでいる）。
 * **`EXPO_PUBLIC_E2E_MEDIA_HOOK=1` を立ててビルドしていないとフォームが開かない**ので、
 * 本文入力欄が出てこない場合はまずビルド時の環境変数を疑うこと。
 */
describeMutation("レビュー投稿 @mutation", () => {
	const tabBar = new TabBar();
	const review = new ReviewScreen();
	const selectRestaurant = new SelectRestaurantScreen();

	// #1031 【バグ】beforeAll だと前のテストが残した画面状態を次が引き継ぎ、タップがオーバーレイに阻まれる。
	// セッション注入起動は匿名クォータを消費しないため、テストごとに起動し直して独立性を担保する
	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
	});

	// ─ テストケース: レビューを投稿できる ─
	// 手順:
	//   1. レビュータブ → 投稿 CTA（ログイン済みのみ表示）で「お店選択」画面へ
	//   2. 店名で検索し先頭候補を選ぶ（飲食店カテゴリなら restaurants が作られ詳細が開く）
	//   3. 「写真・動画を投稿」でフォームへ。メディア選択は E2E フックが固定画像を返す
	//   4. 本文 / 料理カテゴリ / 価格 / 星 を埋める（`isValid` が全て必須にしている）
	//   5. 投稿し、フォームが閉じることを検証する（成功時は snackbar のあと onCancel が呼ばれる）
	it("レビューを投稿できる @mutation", async () => {
		await tabBar.gotoReview();
		await review.gotoPostReview();

		// #1031 実在のチェーン店名を使う。`isFoodAndDrinkPlaceForUser()` が true の候補でないと
		// 地図移動だけで終わり、お店の詳細（= 投稿導線）へ進めないため
		await selectRestaurant.expectLoaded();
		await selectRestaurant.searchRestaurant("スターバックスコーヒー 渋谷");
		await selectRestaurant.selectSuggestion(0);

		// 店舗レコードの作成 → 詳細表示までバックエンド往復があるため長めに待つ
		await selectRestaurant.gotoReviewForm(ReviewScreen.FORM_TIMEOUT);

		// メディア選択（E2E では固定画像）が解決するとフォーム本体が描画される
		await review.expectFormLoaded(ReviewScreen.FORM_TIMEOUT);

		await review.fillComment("[E2E] Detox からの自動投稿テストです");
		await review.chooseDishCategory("コーヒー");
		await review.fillPrice("500");
		await review.rate(5);

		await review.submit();

		// 画像アップロード → v1/dishes → v1/dish-media と直列に走るため、投稿完了待ちは長めに取る
		await review.expectFormClosed(ReviewScreen.FORM_TIMEOUT);
	});
});
