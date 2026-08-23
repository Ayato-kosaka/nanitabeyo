import { test, expect } from "../../fixtures/test";
import { TabBar } from "../../pages/TabBar";
import { MyDishesPage } from "../../pages/MyDishesPage";

/**
 * 🧹 #1403 (PR1) 旧レビュータブが «消えたこと» と «行き先があること» の固定
 *
 * ## この spec の役割
 *
 * #1396 でレビュータブ（`tab-review` / `app/[locale]/(tabs)/review/**`）は削除され、
 * 食べたい/食べたタブ（`tab-my-dishes`）へ置き換わった。旧タブを守っていた spec は
 * すべて新タブへ移設済みだが、**「旧タブがもう無い」ことを主張する spec はどこにも無かった**。
 * 置き換えの spec（tests/my-dishes/my-dishes-guest.spec.ts）は新 testID を見るだけなので、
 * 仮に旧タブが復活しても緑のままになる。ここがその穴を塞ぐ。
 *
 * ## 旧 URL は 404 にしない（#1396 設計確定A）
 *
 * `/[locale]/review` と `/[locale]/review/selectRestaurant` は 8 ロケール分が sitemap 経由で
 * 公開インデックス対象になっていたため、`app/[locale]/review/**` に **リダイレクト専用ファイル**
 * （`<Redirect href="/[locale]/my-dishes" />`）だけが残っている。
 * この «消したが 404 にはしていない» 判断は、これまで web / mobile のどちらの spec にも
 * 固定されていなかった（`lib/seo/sitemap.ts` のコメントに書いてあるだけだった）。
 * 消し忘れの検知と同じくらい **「消したつもりで 404 を作っていない」** ことが大事なので、
 * 両方をこの 1 ファイルで見る。
 *
 * ## Tier
 * Tier 2（無タグ）。匿名ユーザーで完結し、dev DB へは読み書きとも行かない。
 */
test.describe("旧レビュータブの撤去（#1396 / #1403）", () => {
	// ─ テストケース: タブバーに tab-review が存在せず、tab-my-dishes が出る ─
	// 手順:
	//   1. appPage で起動（匿名状態）
	//   2. tab-review が **1 つも存在しない**ことを検証（復活の検知）
	//   3. tab-my-dishes が表示されることを検証（置き換え先が実在すること）
	test("tab-review は存在せず、tab-my-dishes が表示される", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);

		// 「見えていない」ではなく「1 つも無い」で見る。href: null で隠されているだけの状態
		// （お知らせタブが匿名時にそうなる）と、ルートごと消えた状態を区別するため
		await expect(appPage.getByTestId("tab-review")).toHaveCount(0);
		await expect(tabBar.myDishesTab).toBeVisible();
	});

	// ─ テストケース: 旧レビュータブの URL が新タブへリダイレクトされる ─
	// 手順:
	//   1. /ja-JP/review へ直接着地する
	//   2. URL が /ja-JP/my-dishes へ倒れることを検証（404 にはしない）
	//   3. 着地先が食べたい/食べたタブのゲスト表示であることを検証
	//   4. 旧レビュータブの観測点（review-guest-*）が 1 つも残っていないことを検証
	test("/ja-JP/review は /ja-JP/my-dishes へリダイレクトされる", async ({ appPage }) => {
		const myDishesPage = new MyDishesPage(appPage);

		await appPage.goto("/ja-JP/review");

		await expect(appPage).toHaveURL(/\/ja-JP\/my-dishes(\?|$)/);
		await myDishesPage.expectGuestViewLoaded();

		// 旧タブのゲスト表示（Review.guest.*）は my-dishes-guest-* へ移った。
		// 両方が出ている＝移設ではなく増殖、という回帰をここで止める
		await expect(appPage.getByTestId("review-guest-description")).toHaveCount(0);
		await expect(appPage.getByTestId("review-guest-login-button")).toHaveCount(0);
	});

	// ─ テストケース: 旧「お店選択」URL も新タブへリダイレクトされる ─
	// 手順:
	//   1. /ja-JP/review/selectRestaurant へ直接着地する
	//   2. URL が /ja-JP/my-dishes へ倒れ、ゲスト表示になることを検証
	// 補足: お店選択画面そのものは /ja-JP/my-dishes/select-restaurant へ移設済みで、
	//       そこへの導線（記録 CTA）はログイン済み専用のため tests/authenticated/ 側が持つ。
	test("/ja-JP/review/selectRestaurant も /ja-JP/my-dishes へリダイレクトされる", async ({ appPage }) => {
		const myDishesPage = new MyDishesPage(appPage);

		await appPage.goto("/ja-JP/review/selectRestaurant");

		await expect(appPage).toHaveURL(/\/ja-JP\/my-dishes(\?|$)/);
		await myDishesPage.expectGuestViewLoaded();
	});
});
