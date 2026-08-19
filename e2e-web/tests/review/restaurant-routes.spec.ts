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
 * ## 店舗選択からの導線はここでは見ない
 * 店舗選択（`/[locale]/review/selectRestaurant`）のマーカー押下は、ヘッドレスブラウザに
 * 位置情報が無く初期表示の中心が決まらないため到達できない。
 * ⚠️ あの画面の «ストアへ upsert してから push する» 順序は、#1419 で地図タブを消した時点で
 * どのテストにも守られていない（旧 `__tests__/mapRestaurantRoute.test.tsx` は地図側だけを見ていた）。
 */
test.describe("店舗詳細のルート（#1386）", () => {
	// ─ テストケース: 店舗詳細へ直リンクで到達できる ─
	// 手順:
	//   1. 店舗取得 API をモックして /ja-JP/review/restaurant/<id> へ直接遷移する
	//   2. URL が店舗詳細のままで、タイトルと 3 つの導線が表示されることを検証
	test("直リンクで開き、統合後の 2 導線が出る（入札は出ない）", async ({ appPage }) => {
		const detailPage = new RestaurantDetailPage(appPage);
		await mockRestaurantDetail(appPage);

		await detailPage.goto();
		await detailPage.expectOpened();

		// #1386 統合で «地図側にしか無かった» Google マップがレビュー側の投稿ボタンと同じ画面に並ぶ
		await expect(detailPage.postPhotoButton).toBeVisible();
		await expect(detailPage.googleMapsButton).toBeVisible();
		await expect(appPage.getByText(MOCK_RESTAURANT_NAME)).toBeVisible();

		// #1411 【バグ】入札の導線は決済が未実装なので **出してはいけない**。
		// #1386 の統合で地図側から «機能を落とさない» つもりで持ち込んだが、地図タブは
		// `href: null` で到達不能だったため、これは復活であって移設ではなかった。
		await expect(detailPage.placeBidButton).toHaveCount(0);
	});

	// ─ テストケース: ブラウザバックでも店舗詳細へ戻る ─
	// #1386 【設計】戻る責務を Navigator へ渡したこと自体の検証。モーダル時代は
	// ブラウザバックがモーダルを閉じずにタブごと戻していた（URL が変わらないため）。
	// #1411 で入札の導線を落としたので、店舗詳細から «アプリ内 push» で出る唯一の経路である
	// ゲストの投稿導線（→ ログイン）で見る。ここで欲しいのは「push した先からブラウザバックで
	// 戻れる」ことなので、行き先が入札である必要は無い。
	// 手順:
	//   1. 店舗詳細からログイン画面へ push する
	//   2. ブラウザバックする
	//   3. 店舗詳細へ戻ることを検証
	test("ブラウザバックで push 先から店舗詳細へ戻る", async ({ appPage }) => {
		const detailPage = new RestaurantDetailPage(appPage);
		const loginPage = new LoginPage(appPage);
		await mockRestaurantDetail(appPage);

		await detailPage.goto();
		await detailPage.expectOpened();

		await detailPage.postPhotoButton.click();
		await loginPage.expectOpened();

		await appPage.goBack();
		await detailPage.expectOpened();
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
	//
	// #1411 【設計】これは «履歴が無い着地では router.back() が何も起きないので、
	// 離脱は親への replace に倒れる» ことを見る唯一のテストでもある。
	// #1411 まではこれを入札ルートでも見ていたが、入札を消したのでここ 1 本になった。
	//
	// ⚠️ 料理カテゴリ選択（dish-category）へ移してはいけない。あの画面の replace 先は
	// **投稿フォーム**（`.../review`）で、投稿フォームはマウント時にメディア選択を開き、
	// 選ばれなければそのまま離脱する。結果 URL は検索タブへ流れる（実測: E2E Web run
	// 32307163377 で `/ja-JP/search` を受け取って落ちた）。倒れ先が店舗詳細なのは
	// **フィードだけ**である。
	//
	// 手順:
	//   1. /ja-JP/review/restaurant/<id>/feed へ直接遷移する（料理メディアは 0 件のモック）
	//   2. フィード画面が開き、«見るものが無い» 表示になることを検証
	//      （0 件でもスピナーで固着しないこと自体が検証対象）
	//   3. × で閉じると、履歴が無いので店舗詳細へ倒れることを検証
	// ⚠️ 3 は «履歴なし» が前提なので、`appPage` フィクスチャは使わないこと（#1404）。
	// あれは起動確認のために `goto("/")` を済ませているので、そこから子ルートへ行くと
	// **アプリ内の履歴が 1 つ積まれている**。その状態では `canGoBack()` が true になり、
	// 戻るは «直前に見ていた検索画面» へ帰る（それはそれで正しい挙動）。ここで守りたいのは
	// «共有リンクを新しいタブで開いた» 側。実際 E2E Web run 32243079269 では、これを混同して
	// いたため /ja-JP/search へ倒れて落ちた。
	//
	// ⚠️ これは `(tabs)` 配下のルートに限った話である。同 run で `legal.spec.ts` の
	// 「直リンク着地から戻ると設定画面へ倒れる」は `appPage` のまま緑だった。
	// `/legal/[doc]` は `(tabs)` の外にあるため `canGoBack()` が false になるからで、
	// あちらを同じように書き換える必要は無い。
	//
	// ⚠️ 素の `page` フィクスチャを使うこと。あれは `context.newPage()` そのもので、
	// **`goto` を一度もしていない**ので目的を満たす。`browser.newContext()` で自作すると、
	// `fixtures/test.ts` の `context` が張る `addInitScript`（チュートリアル既読のシード）と
	// `page` に張った `consoleErrors` の収集が両方とも外れる（PR #1405 のレビューで実測）。
	test("フィードは独立したルートで、閉じると店舗詳細へ倒れる", async ({ page }) => {
		const detailPage = new RestaurantDetailPage(page);
		await mockRestaurantDetail(page);

		await detailPage.gotoSub("feed");
		await detailPage.expectFeedOpened();
		await expect(detailPage.feedEmpty).toBeVisible();

		await detailPage.feedCloseButton.click();
		await expect(page).toHaveURL(new RegExp(`${restaurantDetailPath()}(\\?.*)?$`));
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
