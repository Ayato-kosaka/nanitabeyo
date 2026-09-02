import { by, launchAppWithSession, localeDeepLink, waitUntilGone, waitUntilVisible } from "../../fixtures/e2e";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { TabBar } from "../../screens/TabBar";

/**
 * 🧹 #1403 (PR1) 旧レビュータブが «消えたこと» と «行き先があること» の固定
 *（e2e-web の tests/navigation/legacy-review-tab-removed.spec.ts に対応）
 *
 * ## この spec の役割
 *
 * #1396 でレビュータブ（`tab-review` / `app/[locale]/(tabs)/review/**`）は削除され、
 * 食べたい/食べたタブ（`tab-my-dishes`）へ置き換わった。旧タブを守っていた spec は
 * すべて新タブへ移設済みだが、**「旧タブがもう無い」ことを主張する spec はどこにも無かった**。
 * 置き換え先の spec（tests/my-dishes/my-dishes-guest.test.ts）は新 testID を見るだけなので、
 * 仮に旧タブが復活しても緑のままになる。ここがその穴を塞ぐ。
 *
 * ## 旧 URL は 404 にしない（#1396 設計確定A）
 *
 * `/[locale]/review` と `/[locale]/review/selectRestaurant` は 8 ロケール分が sitemap 経由で
 * 公開インデックス対象になっていたため、`app/[locale]/review/**` に **リダイレクト専用ファイル**
 *（`<Redirect href="/[locale]/my-dishes" />`）だけが残っている。web と native は同じ
 * expo-router のルートツリーを共有するので、**ネイティブでも同じディープリンクが
 * `+not-found` ではなく my-dishes へ倒れる**ことをここで固定する。
 *
 * ## この spec での起動方法
 * #1030 【設計】3-1 の原則どおり、匿名サインインのレート制限(30 回/時/IP)を避けるため
 * `launchAppWithSession({ as: "anon" })` でセッションを注入して起動する。
 *
 * ## dev DB への影響
 * 無し（匿名ユーザーのゲスト表示までしか進まない）。
 */
describe("旧レビュータブの撤去（#1396 / #1403）", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態を次が引き継ぐ。
	// セッション注入起動は匿名クォータを消費しないため、テストごとに起動し直して独立性を担保する

	// ─ テストケース: タブバーに tab-review が存在せず、tab-my-dishes が出る ─
	// 手順:
	//   1. 匿名セッションを注入して起動する
	//   2. tab-review が **ビューツリーに 1 つも無い**ことを検証（復活の検知）
	//   3. tab-my-dishes が表示されることを検証（置き換え先が実在すること）
	it("tab-review は存在せず、tab-my-dishes が表示される", async () => {
		await launchAppWithSession({ as: "anon" });
		const tabBar = new TabBar();

		// #1031 【設計】existsNow は「待たない・分岐用」のため、確定的なアサートには waitUntilGone を使う。
		// 「見えていない」ではなく「存在しない」で見るのは、href: null で隠されているだけの状態
		// （お知らせタブが匿名時にそうなる）とルートごと消えた状態を区別するため
		await waitUntilGone(by.id("tab-review"));
		await waitUntilVisible(tabBar.myDishesTab);
	});

	// ─ テストケース: 旧レビュータブのディープリンクが新タブへ倒れる ─
	// 手順:
	//   1. nanitabeyo:///ja-JP/review へ直接着地する
	//   2. 食べたい/食べたタブのゲスト表示（my-dishes-guest-login-button）が出ることを検証
	//      = `+not-found` へ落ちていない、かつ新タブへリダイレクトされている
	//   3. 旧レビュータブの観測点（review-guest-*）が 1 つも残っていないことを検証
	//      （移設ではなく «増殖» になっていないこと）
	it("nanitabeyo:///ja-JP/review は食べたい/食べたタブへリダイレクトされる", async () => {
		await launchAppWithSession({ as: "anon", url: localeDeepLink("review") });
		const myDishesScreen = new MyDishesScreen();

		await myDishesScreen.expectGuestViewLoaded();
		await waitUntilGone(by.id("review-guest-description"));
		await waitUntilGone(by.id("review-guest-login-button"));
	});

	// ─ テストケース: 旧「お店選択」ディープリンクも新タブへ倒れる ─
	// 手順:
	//   1. nanitabeyo:///ja-JP/review/selectRestaurant へ直接着地する
	//   2. 食べたい/食べたタブのゲスト表示が出ることを検証
	// 補足: お店選択画面そのものは /[locale]/my-dishes/select-restaurant へ移設済みで、
	//       そこへの導線（記録 CTA）はログイン済み専用のため tests/mutation/ 側が持つ。
	it("nanitabeyo:///ja-JP/review/selectRestaurant も食べたい/食べたタブへリダイレクトされる", async () => {
		await launchAppWithSession({ as: "anon", url: localeDeepLink("review/selectRestaurant") });
		const myDishesScreen = new MyDishesScreen();

		await myDishesScreen.expectGuestViewLoaded();
	});
});
