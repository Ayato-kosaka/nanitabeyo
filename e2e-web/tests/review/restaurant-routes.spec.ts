import { test, expect } from "../../fixtures/test";
import { RestaurantDetailPage } from "../../pages/RestaurantDetailPage";
import { LoginPage } from "../../pages/LoginPage";
import {
	MOCK_RESTAURANT_ID,
	MOCK_RESTAURANT_NAME,
	mockRestaurantDetail,
	restaurantDetailPath,
} from "../../utils/restaurantDetail";

/**
 * 🏪 店舗詳細とその配下 3 画面のルーティングテスト（#1386）
 *
 * 実行プロジェクト: desktop-chrome（匿名 storageState）
 *
 * ## 何を守るテストか
 * #1386 は「地図の店舗詳細（BlurModal・手動 zIndex 1100）と、その中に積まれていた
 * レビュー投稿 1200 / 入札 1300 / 料理カテゴリ選択 1100 / フィード 1100」を全部ルートへ移した Issue。
 * 守りたいのは次の 3 つで、どれも **URL でしか観測できない**。
 *
 * 1. **4 画面が URL で指せること** — オーバーレイへ戻す変更を入れると URL が変わらず落ちる
 * 2. **戻る導線があること** — モーダル時代の「×」は Navigator の pop へ置き換わった。
 *    ブラウザバックでも戻れること（モーダル時代は URL が変わらないのでタブごと戻っていた）
 * 3. **履歴が無い着地でも行き止まりにならないこと** — 直リンク / リロードで着地したときの replace
 *
 * ## dev DB への影響
 * 無し（店舗取得 API はモック。詳細は `utils/restaurantDetail.ts`）。
 * 実データで店舗を作ると `POST /v1/restaurants` の書き込みが必要になり @mutation 相当になるため、
 * ルーティングの検証はモックで閉じる。実データを通す経路は
 * `tests/authenticated/review-post.spec.ts` と `tests/catalog/ui-catalog-mutation.spec.ts` が持つ。
 *
 * ## 地図からの導線はここでは見ない
 * 地図（`/[locale]/map`）のマーカー押下は、ヘッドレスブラウザに位置情報が無く初期表示の中心が
 * 決まらないため到達できない（`catalog/screens.json` の map の note と同じ理由）。
 * 「地図が upsert してから push する」ことは app-expo の `__tests__/mapRestaurantRoute.test.tsx` が
 * 呼び出し順ごと固定している。
 */
test.describe("店舗詳細のルート（#1386）", () => {
	// ─ テストケース: 店舗詳細へ直リンクで到達できる ─
	// 手順:
	//   1. 店舗取得 API をモックして /ja-JP/review/restaurant/<id> へ直接遷移する
	//   2. URL が店舗詳細のままで、タイトルと 3 つの導線が表示されることを検証
	test("直リンクで開き、統合後の 3 導線がすべて出る", async ({ appPage }) => {
		const detailPage = new RestaurantDetailPage(appPage);
		await mockRestaurantDetail(appPage);

		await detailPage.goto();
		await detailPage.expectOpened();

		// #1386 統合で «地図側にしか無かった» 2 つ（入札・Google マップ）が
		// レビュー側の投稿ボタンと同じ画面に並ぶ。落とすとここで気付ける
		await expect(detailPage.postPhotoButton).toBeVisible();
		await expect(detailPage.placeBidButton).toBeVisible();
		await expect(detailPage.googleMapsButton).toBeVisible();
		await expect(appPage.getByText(MOCK_RESTAURANT_NAME)).toBeVisible();
	});

	// ─ テストケース: 入札はルートで、戻ると店舗詳細へ帰る ─
	// #1386 旧実装は BidBlurModal（手動 zIndex 1300）。URL は変わらなかった。
	// 手順:
	//   1. 店舗詳細を開く
	//   2. 「入札する」を押し、URL が /bid へ変わることを検証
	//   3. ヘッダーの戻るボタンで店舗詳細へ帰ることを検証
	test("入札はルートへ push され、戻ると店舗詳細へ帰る", async ({ appPage }) => {
		const detailPage = new RestaurantDetailPage(appPage);
		await mockRestaurantDetail(appPage);

		await detailPage.goto();
		await detailPage.expectOpened();

		await detailPage.placeBidButton.click();
		await detailPage.expectBidOpened();

		await detailPage.goBack();
		await detailPage.expectOpened();
	});

	// ─ テストケース: ブラウザバックでも店舗詳細へ戻る ─
	// #1386 【設計】戻る責務を Navigator へ渡したこと自体の検証。モーダル時代は
	// ブラウザバックがモーダルを閉じずにタブごと戻していた（URL が変わらないため）。
	// 手順:
	//   1. 店舗詳細から入札を開く
	//   2. ブラウザバックする
	//   3. 店舗詳細へ戻ることを検証
	test("ブラウザバックで入札から店舗詳細へ戻る", async ({ appPage }) => {
		const detailPage = new RestaurantDetailPage(appPage);
		await mockRestaurantDetail(appPage);

		await detailPage.goto();
		await detailPage.placeBidButton.click();
		await detailPage.expectBidOpened();

		await appPage.goBack();
		await detailPage.expectOpened();
	});

	// ─ テストケース: 入札へ直リンクで着地しても行き止まりにならない ─
	// #1386 【設計】履歴が無い着地では `router.back()` が «何も起きない» ので、
	// 戻るは店舗詳細への replace に倒れる。
	// 手順:
	//   1. /ja-JP/review/restaurant/<id>/bid へ直接着地する（履歴なし）
	//   2. ヘッダーの戻るボタンを押す
	//   3. 店舗詳細へ着地することを検証
	test("入札へ直リンク着地から戻ると店舗詳細へ倒れる", async ({ appPage }) => {
		const detailPage = new RestaurantDetailPage(appPage);
		await mockRestaurantDetail(appPage);

		await detailPage.gotoSub("bid");
		await detailPage.expectBidOpened();

		await detailPage.goBack();
		await expect(appPage).toHaveURL(new RegExp(`${restaurantDetailPath()}(\\?.*)?$`));
		await expect(detailPage.title).toBeVisible();
	});

	// ─ テストケース: 料理カテゴリ選択がルートで開ける ─
	// #1386 旧実装は ReviewForm の中の DishCategoryModal で、**親（1200）より小さい既定 z1100**。
	// ⚠️ ここは «投稿フォーム経由» では検証しない。投稿フォーム（`.../review`）はマウント時に
	//    端末のメディア選択（web はファイル選択ダイアログ）を開くため、URL 直リンクで検証する。
	//    行（`review-dish-category-row`）からこのルートへ push することは
	//    app-expo の `__tests__/reviewFormRoutes.test.tsx` が push 引数ごと固定している。
	// 手順:
	//   1. /ja-JP/review/restaurant/<id>/dish-category へ直接遷移する
	//   2. URL・タイトル・検索入力欄が出ることを検証
	test("料理カテゴリ選択は独立したルートとして開ける", async ({ appPage }) => {
		const detailPage = new RestaurantDetailPage(appPage);
		await mockRestaurantDetail(appPage);

		await detailPage.gotoSub("dish-category");
		await detailPage.expectDishCategoryOpened();
	});

	// ─ テストケース: フィードがルートで開け、閉じると店舗詳細へ倒れる ─
	// #1386 旧実装は RestaurantReviewsTab の DishMediaModal（既定 z1100 = 親と同値）。
	// 手順:
	//   1. /ja-JP/review/restaurant/<id>/feed へ直接遷移する（料理メディアは 0 件のモック）
	//   2. フィード画面が開き、«見るものが無い» 表示になることを検証
	//      （0 件でもスピナーで固着しないこと自体が検証対象）
	//   3. × で閉じると、履歴が無いので店舗詳細へ倒れることを検証
	test("フィードは独立したルートで、閉じると店舗詳細へ倒れる", async ({ appPage }) => {
		const detailPage = new RestaurantDetailPage(appPage);
		await mockRestaurantDetail(appPage);

		await detailPage.gotoSub("feed");
		await detailPage.expectFeedOpened();
		await expect(detailPage.feedEmpty).toBeVisible();

		await detailPage.feedCloseButton.click();
		await expect(appPage).toHaveURL(new RegExp(`${restaurantDetailPath()}(\\?.*)?$`));
		await expect(detailPage.title).toBeVisible();
	});

	// ─ テストケース: ゲストの投稿導線はログイン画面へ、next は投稿フォーム ─
	// #1386 統合前、地図側の店舗詳細は `next` を «地図タブ» にしていた（選択中の店が URL に
	// 無かったため）。統合後は店が URL に載るので、投稿フォームまで戻せる `next` になる。
	// 手順:
	//   1. 匿名セッションで店舗詳細を開く
	//   2. 「写真・動画を投稿」を押す
	//   3. ログイン画面へ遷移し、next に投稿フォームのパスが載ることを検証
	test("ゲストの投稿導線はログイン画面へ行き、next は投稿フォームを指す", async ({ appPage }) => {
		const detailPage = new RestaurantDetailPage(appPage);
		const loginPage = new LoginPage(appPage);
		await mockRestaurantDetail(appPage);

		await detailPage.goto();
		await detailPage.expectOpened();

		await detailPage.postPhotoButton.click();
		await loginPage.expectOpened();

		// `next` はエンコードされて URL に載るので、生の文字列比較ではなく searchParams で読む
		const next = new URL(appPage.url()).searchParams.get("next");
		expect(next).toBe(`/ja-JP/review/restaurant/${MOCK_RESTAURANT_ID}/review`);
	});
});
