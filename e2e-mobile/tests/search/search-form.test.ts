import { element, expect, launchAppWithSession, waitUntilExists, waitUntilVisible } from "../../fixtures/e2e";
import { SearchScreen } from "../../screens/SearchScreen";

/**
 * 📝 検索フォームのロジックテスト（API 不要 / Tier 2）
 *
 * 目的: 検索フォームの必須項目制御・選択操作・詳細条件の展開という、
 *       クライアント内で完結するロジックがネイティブでも成立することを保証する。
 *       （e2e-web の tests/search/search-form.spec.ts に対応）
 * 前提: 実 API を呼ばないシナリオのみを扱う。実 API を伴う検索実行は dish-categories-flow.test.ts が担当する。
 *
 * ## e2e-web から落とした検証（#1031 確定判断）
 * - **B1**: 時間帯・同行者の「選択されている」状態（Web は `toHaveCSS("border-color")` で検証）は
 *   Detox に `accessibilityState` / role を検証する API が無いため対象外。
 *   ネイティブでは「タップが通り、その条件で検索が成立する」ことまでを検証範囲とする
 * - **B3**: 距離に応じたおすすめ移動時間は **順序検証（`toHaveCount` + `nth()`）を落とし**、
 *   おすすめ行と「もっと見る」で開くおすすめ外の行の**表示有無のみ**を検証する
 * - スナックバーの**文言**は検証しない。UI 文字列の直書きは i18n ポリシーで禁止されており、
 *   e2e-mobile から ja-JP.json を引くヘルパ（#1031 M3）はまだ共通基盤に無いため。
 *   代わりに「通知が出ること」＋「トピック画面へ遷移していないこと」で回帰を検知する
 */
describe("検索フォーム", () => {
	const search = new SearchScreen();

	// #1027 【バグ】beforeAll だと前のテストが残した状態（開いたキーボード・スクロール位置）を
	// 次のテストが引き継ぎ、iOS では画面下部の要素が可視判定を通らなくなる。
	// セッション注入起動は匿名クォータを消費しないため、テストごとに起動し直して独立性を担保する
	// （profile 系 spec が #1031 で同じ理由から beforeEach へ移したのと同じ判断）
	beforeEach(async () => {
		// #1030 【設計】3-1: 匿名サインインのクォータを消費しないよう、確立済みセッションを注入して起動する
		await launchAppWithSession({ as: "anon" });
		// #1027 検索チュートリアルは起動引数のシード（`tutorialSeen` の既定 true）で抑止されるため、
		// ここでは素直にフォームの表示だけを待てばよい
		await search.expectLoaded();
	});

	// ─ テストケース: 場所が未確定のまま検索すると通知が出て遷移しない ─
	// 手順:
	//   1. 自動取得された現在地が入っている可能性があるため、明示的にクリアして「場所未確定」を作る
	//   2. 検索ボタン（search-submit-button）をタップする
	//      #973 以降ボタンは常にタップ可能で、未充足時は handleSearch 内のバリデーションが
	//      global-snackbar を出したうえで遷移をガードする
	//   3. スナックバーが表示されることを検証
	//   4. トピック画面へ遷移しておらず、検索画面に留まっていることを検証
	it("場所が未確定のまま検索するとバリデーション通知が出て遷移しない", async () => {
		await search.clearLocationIfPresent();

		await search.submit();

		await waitUntilVisible(search.snackbar);
		// 遷移していないこと = 検索画面のヘッダが出続けていること（トピック画面には別のヘッダ testID がある）
		await expect(element(search.headerTitle)).toBeVisible();
	});

	// ─ テストケース: 時間帯・同行者を選び、詳細条件を開くと距離まわりの UI が現れる ─
	// 手順:
	//   1. 時間帯（dinner）と同行者（friends）をタップする
	//      → #1031 B1 により「選択状態」そのものは検証できないため、タップが通ることまでを見る
	//   2. 詳細条件トグル（search-advanced-toggle）を開く
	//   3. 距離スライダーと、距離に応じたおすすめ移動時間の行が現れることを検証（#1031 B3: 表示有無のみ）
	//   4. 既定の 500m では自転車・徒歩だけがおすすめされ、車・電車は「もっと見る」でだけ現れることを検証
	//      （#987 の仕様。e2e-web は所要時間の分数と並び順まで見ているが、B3 の確定判断により順序検証は落とす）
	it("時間帯と同行者を選び、詳細条件を開くと距離とおすすめ移動時間が表示される", async () => {
		await search.selectTimeSlot("dinner");
		await search.selectScene("friends");

		await search.openAdvancedFilters();

		// #1027 スライダーも可視ではなく存在で見る。詳細条件を開いた直後の距離セクションは
		// 画面下部（iOS では検索 FAB / ホームインジケータの領域）へ来ることがあり、
		// `toBeVisible`（既定 75% 以上の露出が必要）はスクロール位置に左右されてフレークになる
		//（run 30470033327 の iOS で実測）。直後のチップ群と同じ理由・同じ判定に揃える
		await waitUntilExists(search.distanceSlider);
		// #1031 【設計】チップ行の可視性ではなく存在を見る。距離セクションは画面下部固定の検索 FAB と
		// 重なる位置に来ることがあり、`toBeVisible`（既定 75% 以上の露出が必要）はスクロール位置に
		// 左右されてフレークになる。おすすめ / おすすめ外の出し分けは**条件付きレンダリング**なので、
		// 存在の有無で仕様どおりに切り替わっていることを検証できる
		await waitUntilExists(search.distanceRecommendedEstimates);
		await expect(element(search.distanceEstimate("bike"))).toExist();
		await expect(element(search.distanceEstimate("walk"))).toExist();
		await expect(element(search.distanceEstimate("car"))).not.toExist();
		await expect(element(search.distanceEstimate("train"))).not.toExist();

		// おすすめ外の移動時間は明示操作したときだけ表示される
		await expect(element(search.distanceOtherEstimates)).not.toExist();
		await search.toggleOtherDistanceEstimates();
		await waitUntilExists(search.distanceOtherEstimates);
		await expect(element(search.distanceEstimate("car"))).toExist();
		await expect(element(search.distanceEstimate("train"))).toExist();

		await search.toggleOtherDistanceEstimates();
		await expect(element(search.distanceOtherEstimates)).not.toExist();
	});
});
