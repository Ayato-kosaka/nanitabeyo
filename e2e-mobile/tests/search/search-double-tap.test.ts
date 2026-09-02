import { element, expect, launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { SearchScreen } from "../../screens/SearchScreen";
import { DishCategoriesScreen } from "../../screens/DishCategoriesScreen";

/**
 * 👆👆 検索ボタンの連打耐性テスト（Tier 2 / #1084・親 #1082）
 *
 * 目的: 検索 FAB を待機なしで連打しても、二重遷移・二重の API 呼び出しが起きないことを保証する。
 *       （e2e-web の tests/search/search-double-tap.spec.ts に対応）
 *
 * ## 連打の再現方法（#1084 設計 §3-2）
 * `submit()` の連続呼び出しは **連打にならない**。Android は Detox の同期機構が有効なため、
 * 1 発目のあと「遷移アニメーション + レコメンド API の完了」まで待ってから 2 発目が飛び、
 * 連打事故が起きる脆弱な窓を確実に外してしまう（= 事故があっても緑になる偽陰性）。
 * Detox のアイドル待機はアクションと**アクションの間**にしか入らないため、
 * n 回のタップを 1 アクションとして送る `multiTap` を使う（`SearchScreen.submitRapid`）。
 *
 * ## e2e-web から落とした検証
 * - **API 呼び出し回数**: Detox には `page.route()` に相当するネットワーク傍受 API が無いため
 *   「レコメンド API が 1 回だけ」は検証できない。web 側で担保する
 * - **履歴段数**: `history.length` に相当する観測点がネイティブに無い。代わりに
 *   **「1 回戻ると検索画面に着くこと」** で二重 push を検知する（二重に積まれていれば
 *   1 回目の戻りではトピック画面に留まり、検索画面のヘッダが出ない）
 */
describe("検索ボタンの連打耐性", () => {
	const search = new SearchScreen();
	const dishCategories = new DishCategoriesScreen();

	// #1027 テストごとに起動し直して独立性を担保する（前のテストが残したキーボード・スクロール位置が
	// iOS の可視判定を壊すため）。#1030 3-1 セッション注入起動は匿名クォータを消費しない
	beforeEach(async () => {
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();
	});

	// ─ テストケース: 場所が未確定のまま連打してもバリデーション通知が出て遷移しない ─
	// 手順:
	//   1. 自動取得された現在地が入っている可能性があるため、明示的にクリアする
	//   2. 検索ボタンを 5 連打する（遷移しないため回数を増やしても安全）
	//   3. スナックバーが表示されることを検証（文言は検証しない。search-form.test.ts の方針）
	//   4. トピック画面へ遷移しておらず、検索画面に留まっていることを検証
	it("場所が未確定のまま検索ボタンを連打しても遷移しない", async () => {
		await search.clearLocationIfPresent();

		await search.submitRapid(5);

		await waitUntilVisible(search.snackbar);
		await expect(element(search.headerTitle)).toBeVisible();
	});

	// ─ テストケース: 必須項目を満たした状態で 2 連打しても検索は 1 回だけ実行される ─
	// 手順:
	//   1. 場所に「渋谷」を入力しサジェスト先頭を選択する（時間帯・同行者は初期値があるため不要）
	//   2. 検索ボタンを 2 連打する
	//      ⚠️ 3 回以上にしないこと。遷移後も同じ座標へ落ちるため、3 発目以降は
	//         トピック画面の要素を叩いてしまう
	//   3. トピック画面が表示されることを検証
	//   4. **1 回だけ**戻り、検索画面に着くことを検証（二重 push ならトピック画面に留まる）
	// 補足: 設計（#1084 §8 未確定 2）では iOS の「1 回戻る」手段が未確定だったが、
	//       トピック画面のヘッダー戻るボタン（#1404 で `dish-categories-header-back`）は `router.back()` を
	//       1 回呼ぶだけの実装（dishCategories.tsx の handleBack）で、両プラットフォームで同じ導線として使える。
	//       Android 専用の `device.pressBack()` を使う必要は無く、Android 限定にも縮退させていない
	it("必須項目を満たした状態で検索ボタンを 2 連打しても検索は 1 回だけ実行される", async () => {
		await search.typeLocation("渋谷");
		await search.selectLocationSuggestion(0);

		await search.submitRapid(2);
		await dishCategories.expectLoaded();

		await dishCategories.goBack();
		await search.expectLoaded();
	});
});
