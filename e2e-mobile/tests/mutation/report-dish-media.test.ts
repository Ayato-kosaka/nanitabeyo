import { strict as assert } from "node:assert";

import { describeMutation, launchAppWithSession } from "../../fixtures/e2e";
import { ResultScreen } from "../../screens/ResultScreen";
import { SearchScreen } from "../../screens/SearchScreen";
import { DishCategoriesScreen } from "../../screens/DishCategoriesScreen";

/**
 * 通報理由コード。
 *
 * ⚠️ e2e-web は `@shared/api/v1/constants/contentReports` を直接 import しているが、
 * e2e-mobile の tsconfig / jest には `@shared` の別名が無く（このワークスペースで
 * shared を参照している spec が 1 つも無い）、別名を足すと ts-jest の
 * moduleNameMapper まで揃える必要がある。テスト 1 本のために解決経路を増やさず、
 * ここに写しを置く。**shared 側の CONTENT_REPORT_REASON_CODES と同じ集合を保つこと**
 * （増減したらこのテストがラベルの欠落として検知する）。
 */
const CONTENT_REPORT_REASON_CODES = [
	"spam",
	"sexual",
	"violence",
	"harassment",
	"illegal",
	"misinformation",
	"rights",
	"privacy",
	"irrelevant",
	"other",
] as const;

/**
 * 🚩 投稿の通報のテスト @mutation（#1514 / SAF-01。e2e-web の tests/authenticated/report-dish-media.spec.ts に対応）
 *
 * ## ⚠️ このテストは DB マイグレーション適用後にしか通らない
 * `content_reports` は #1514 の migration
 * （`infra/supabase/migrations/20260823T0100_create_content_reports.sql`）で新設される。
 * **オーナー承認前なので dev には未適用**であり、その状態では送信が失敗して
 * 受付完了ではなく `report-error` が出る。どちらになったかは
 * `ResultScreen.waitForReportOutcome()` が区別して返すので、失敗の原因が読める。
 *
 * ## この spec が dev DB に書き込むもの / 戻せるか
 * | 操作   | API                        | 戻せるか |
 * | ------ | -------------------------- | -------- |
 * | 通報   | POST `v1/content-reports`  | ❌ 取り消す API は無い |
 *
 * いいね・保存（reactions.test.ts）と違い、**通報は取り消せない**。
 * 「運営が見るまで消えない証跡」であることが要件なので、削除経路を作らないことが
 * 設計判断そのものになっている。したがってこのテストは dev DB に 1 行残す（不可逆）。
 *
 * それでも繰り返し実行できるのは API が冪等だから: 同一ユーザー × 同一投稿の
 * 2 回目以降は一意制約に当たるが、409 ではなく **既存の受付番号を返す**ので、
 * UI の見え方は 1 回目と同じ「受け付けました」になる。
 * 操作は必ずテスト専用ユーザーで行うこと。
 *
 * ## 状態の検証方法
 * 選ばれた理由かどうかは `aria-selected` と色でしか表現されておらず、Detox には
 * `accessibilityState` を検証する API が無い（#1031 と同型）。app-expo 側が
 * 状態別の accessibilityLabel を付けているため、`getAttributes()` でラベルを読んで
 * 「タップ前後で変化したこと」を検証する。
 */
describeMutation("投稿の通報 @mutation", () => {
	const search = new SearchScreen();
	const dishCategories = new DishCategoriesScreen();
	const result = new ResultScreen();

	// reactions.test.ts と同じ理由（#1031）で、テストごとに結果フィードまでやり直して独立性を担保する
	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
		await search.expectLoaded();

		await search.clearLocationIfPresent();
		await search.typeLocation("渋谷");
		await search.selectLocationSuggestion(0);
		await search.submit();

		await dishCategories.expectLoaded();
		await dishCategories.chooseFirstDishCategory();
		await result.expectLoaded();
	});

	// ─ テストケース: 通報導線 → 理由選択 → 受付完了 ─
	// 手順:
	//   1. 表示中カードの「報告」（dish-action-report）をタップして通報シートを開く
	//   2. 理由（スパム）を選び、ラベルが «選択中» に変わることを検証
	//   3. 送信 → 受付完了パネル（report-accepted）が出ることを検証
	//      （POST v1/content-reports。dev DB に 1 行残る。取り消し API は無い）
	//   4. 閉じたあとも投稿がフィードに残っていることを検証
	//      （通報しても即時非表示にしない = 通報爆撃を検閲の道具にしない）
	it("投稿を通報すると受け付けられる @mutation", async () => {
		await result.openReportSheet();

		const before = await result.reportReasonLabel("spam");
		await result.chooseReportReason("spam");
		const after = await result.reportReasonLabel("spam");
		assert.notEqual(after, before, "理由を選ぶと accessibilityLabel が «選択中» へ変化するはず");

		await result.submitReport();

		const outcome = await result.waitForReportOutcome();
		assert.equal(
			outcome,
			"accepted",
			"通報が受け付けられるはず（error のときは content_reports の migration が dev へ未適用の可能性が高い）",
		);

		await result.closeReportAccepted();

		// 通報しても投稿は消えない・隠れない
		await result.expectLoaded();
	});

	// ─ テストケース: 理由の選択肢が出そろっている ─
	// 手順:
	//   1. 通報シートを開く
	//   2. 定数 CONTENT_REPORT_REASON_CODES の全コードについて行が見えること、
	//      ラベルが空でも翻訳キーのままでもないことを検証
	//
	// このテストは送信しないので dev DB へは書き込まない（開いて閉じるだけ）。
	// それでも @mutation 側に置いてあるのは、到達に検索フロー（実 API）が要るため
	it("通報理由が選択式で、ラベルが翻訳されている @mutation", async () => {
		await result.openReportSheet();

		for (const code of CONTENT_REPORT_REASON_CODES) {
			const label = await result.reportReasonLabel(code);
			assert.notEqual(label, "", `${code} のラベルが空`);
			// 未翻訳だと i18n-js は `[missing "ja-JP.Report.reasons.xxx" translation]` を返す
			assert.ok(!label.includes("missing"), `${code} が未翻訳: ${label}`);
			assert.ok(!label.includes("Report.reasons"), `${code} がキー名のまま: ${label}`);
		}
	});
});
