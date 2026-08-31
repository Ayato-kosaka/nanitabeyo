import { test, expect } from "../../fixtures/test";
import { PRERENDER_MISS_HYDRATION_NOISE } from "../../utils/consoleNoise";
import { RestaurantDetailPage } from "../../pages/RestaurantDetailPage";
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
 * 店舗選択（#1375 で `/[locale]/my-dishes/select-restaurant` へ移設）のマーカー押下は、ヘッドレスブラウザに
 * 位置情報が無く初期表示の中心が決まらないため到達できない。
 * ⚠️ あの画面の «ストアへ upsert してから push する» 順序は、#1419 で地図タブを消した時点で
 * どのテストにも守られていない（旧 `__tests__/mapRestaurantRoute.test.tsx` は地図側だけを見ていた）。
 */
test.describe("店舗詳細のルート（#1386）", () => {
	test.use({ allowedConsoleErrors: PRERENDER_MISS_HYDRATION_NOISE });

	// ─ テストケース: 店舗詳細へ直リンクで到達できる ─
	// 手順:
	//   1. 店舗取得 API をモックして /ja-JP/restaurant/<id> へ直接遷移する
	//      （#1375 でレビュータブごと `(tabs)/review/restaurant/**` から移設した）
	//   2. URL が店舗詳細のままで、タイトルと «Google マップで開く» が出ることを検証
	//   3. 入札が出ないこと、投稿導線が出ないことを検証
	test("直リンクで開き、Google マップの導線が出る（入札と投稿導線は出ない）", async ({ appPage }) => {
		const detailPage = new RestaurantDetailPage(appPage);
		await mockRestaurantDetail(appPage);

		await detailPage.goto();
		await detailPage.expectOpened();

		await expect(appPage.getByText(MOCK_RESTAURANT_NAME)).toBeVisible();

		/*
		#1629【オーナー確定】**Google マップは «出す»、写真・動画の投稿は «出さない» へ入れ替わった。**

		#1411 / #1414 B-2 は Google マップを «誰も出すと決めていない機能» として落としたが、
		オーナーの確定で «出してよい» になった。店の場所・営業時間・電話へ辿り着く唯一の導線で、
		これが無いと店舗詳細に «店の情報» が 1 つも無い状態だった。

		投稿は «食べたを記録» のフローへ 1 本化した。店舗詳細にも同じことを始めるボタンがあり、
		画面に出ているものが «店の情報 0 件 / レビューを書く導線 2 件» になっていたため
		（オーナー実機報告「お店の詳細押すとレビューするフローになる」）。

		⚠️ 入札は引き続き出してはいけない。決済が未実装（#1411）。
		*/
		await expect(detailPage.googleMapsButton).toBeVisible();
		await expect(detailPage.placeBidButton).toHaveCount(0);
		await expect(detailPage.postPhotoButton).toHaveCount(0);
	});

	// ─ テストケース: ブラウザバックでも店舗詳細へ戻る ─
	// #1386 【設計】戻る責務を Navigator へ渡したこと自体の検証。モーダル時代は
	// ブラウザバックがモーダルを閉じずにタブごと戻していた（URL が変わらないため）。
	//
	// #1629 経路を «投稿グリッド → feed» に変えた。店舗詳細から «アプリ内 push» で出る経路が
	// これ 1 本だけになったため（写真・動画の投稿ボタンを外し、Google マップは
	// 外部アプリを開くので push しない）。ここで欲しいのは «push した先からブラウザバックで
	// 戻れる» ことなので、行き先が何であるかは本題ではない。
	// 手順:
	//   1. 店舗詳細の投稿グリッドを押して feed へ push する
	//   2. ブラウザバックする
	//   3. 店舗詳細へ戻ることを検証
	test("ブラウザバックで push 先から店舗詳細へ戻る", async ({ appPage }) => {
		const detailPage = new RestaurantDetailPage(appPage);
		await mockRestaurantDetail(appPage, { withDishMedia: true });

		await detailPage.goto();
		await detailPage.expectOpened();

		await detailPage.firstReviewTile.click();
		await expect(appPage).toHaveURL(/\/restaurant\/[^/]+\/feed/);

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
	//   1. /ja-JP/restaurant/<id>/dish-category へ直接遷移する
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
	//   1. /ja-JP/restaurant/<id>/feed へ直接遷移する（料理メディアは 0 件のモック）
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

	/*
	#1629【オーナー確定】**«ゲストの投稿導線 → ログイン» は、この画面から無くなった。**

	«写真・動画を投稿» を外したため（投稿は «食べたを記録» のフローへ 1 本化）。
	そのログイン導線の `next` は `__tests__/loginEntryPoints.test.tsx` が
	記録フロー側（`my-dishes-record-button`）で守っている。

	代わりにここでは «ゲストが店舗詳細で何もログインを求められない» ことを見る。
	店の場所を見るだけの操作でログインを要求しないこと自体が守るべき性質である。
	*/
	test("ゲストでも店舗詳細はログインを求めない", async ({ appPage }) => {
		const detailPage = new RestaurantDetailPage(appPage);
		await mockRestaurantDetail(appPage);

		await detailPage.goto();
		await detailPage.expectOpened();

		await expect(detailPage.googleMapsButton).toBeVisible();
		await expect(appPage).not.toHaveURL(/\/auth\/login/);
	});
});
