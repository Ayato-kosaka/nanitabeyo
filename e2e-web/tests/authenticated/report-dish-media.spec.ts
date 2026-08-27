import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { DishCategoriesPage } from "../../pages/DishCategoriesPage";
import { ResultPage } from "../../pages/ResultPage";
import { CONTENT_REPORT_REASON_CODES } from "@shared/api/v1/constants/contentReports";

/**
 * 🚩 投稿の通報（#1514 / SAF-01）@mutation
 *
 * 実行プロジェクト: desktop-chrome-authenticated(storageState 注入済み)
 * 実行条件: RUN_MUTATION=1 のときのみ(playwright.config.ts の grepInvert 参照)
 *
 * ## ⚠️ このテストは DB マイグレーション適用後にしか通らない
 * `content_reports` テーブルは #1514 の migration
 * (`infra/supabase/migrations/20260823T0100_create_content_reports.sql`) で新設される。
 * **オーナー承認前なので dev には未適用**であり、その状態で実行すると送信が失敗し、
 * 受付完了パネルの代わりに `report-error` が出る。適用後に実行すること。
 *
 * ## dev DB への影響(重要・要注意)
 * いいね/保存(reactions.spec.ts)と違い、**通報を取り消す API は無い**。
 * 通報は「運営が見るまで消えない証跡」であることが要件なので、
 * 削除経路を作らないのが設計判断そのものになっている。
 * したがってこのテストは **dev DB に 1 行残す(不可逆)**。
 *
 * それでも繰り返し実行できるのは、API が冪等だから:
 * 同一ユーザー × 同一投稿の 2 回目以降は
 * `uq_content_reports_reporter_target` に当たるが、409 ではなく
 * **既存の受付番号を返す**。UI の見え方は 1 回目と同じ「受け付けました」になる。
 * 操作は必ずテスト専用ユーザーで行うこと。
 *
 * ## 何を守るテストか
 * 1. 投稿カードから通報できる(導線が存在する)
 * 2. 理由は選択式で、8 言語ぶん i18n が引けている(ja-JP で文言が空でない)
 * 3. 送信すると「受け付けました」が出る
 * 4. **通報しても投稿はフィードから消えない**(通報爆撃を検閲の道具にしない)
 */
test.skip(
	() => !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
	"TEST_USER_EMAIL / TEST_USER_PASSWORD(e2e-web/.env)が未設定のためスキップ",
);

test.describe("投稿の通報 @mutation", () => {
	// 検索 → トピック提案 → 結果フィード遷移は AI 生成待ちで時間がかかる(reactions.spec.ts と同じ理由)
	test.setTimeout(90_000);

	// AI レコメンドが選ぶ料理・店舗によっては dev 環境側のデータ不備(画像未処理等)で
	// 結果フィード取得が 500 になることが実測で確認されている(既知の不安定要素)
	test.describe.configure({ retries: 2 });

	/** 検索フローを通って結果フィード(料理メディアカード)まで進む */
	async function gotoResultFeed(appPage: Page) {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);
		const resultPage = new ResultPage(appPage);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectLoaded();
		await dishCategoriesPage.chooseFirstDishCategory();
		await resultPage.expectLoaded();

		return resultPage;
	}

	// ─ テストケース: 通報導線 → 理由選択 → 受付完了 ─
	// 手順:
	//   1. ログイン済みで起動し、検索フローで結果フィードを表示する
	//   2. «…» メニュー(dish-action-more)を開き、通報(dish-action-report)を押して通報シートを開く
	//      #1629 通報はレール直置きから «…» の中へ移った
	//   3. 理由(スパム)を選ぶ → 送信ボタンが押せるようになる
	//   4. 送信 → 受付完了パネル(report-accepted)が出る
	//      (POST v1/content-reports。dev DB に 1 行残る。取り消し API は無い)
	/**
	 * #1629 通報シートを開く。
	 * 通報はフィード右レールの直置きから «…» メニューの中へ移った（オーナー指示）。
	 * 「report ボタンが見つからない」で落ちたら、まずここを疑う。
	 */
	const openReportSheet = async (resultPage: ResultPage) => {
		await resultPage.moreButton.first().click();
		await resultPage.reportButton.first().click();
	};

	test("投稿を通報すると受け付けられる @mutation", async ({ appPage }) => {
		const resultPage = await gotoResultFeed(appPage);

		await openReportSheet(resultPage);
		await expect(resultPage.reportSheet).toBeVisible();

		// 理由未選択では送れない(誤爆防止)。React Native Web の Pressable は
		// disabled を aria-disabled として出す
		await expect(resultPage.reportSubmitButton).toHaveAttribute("aria-disabled", "true");

		await resultPage.reportReason("spam").click();
		await expect(resultPage.reportReason("spam")).toHaveAttribute("aria-selected", "true");

		await resultPage.reportSubmitButton.click();

		// 受付完了。ここに受付番号は出さない(問い合わせ窓口が無いのに番号だけ見せない)
		await expect(resultPage.reportAccepted).toBeVisible({ timeout: 30_000 });

		await resultPage.reportAcceptedCloseButton.click();
		await expect(resultPage.reportSheet).toBeHidden();

		// 通報しても投稿は消えない・隠れない。
		// ここが崩れると、通報爆撃がそのまま検閲の道具になる
		// #1629 通報は «…» の中へ移ったので、レールに残る «…» と いいね が生きていることで見る
		await expect(resultPage.moreButton.first()).toBeVisible();
		await expect(resultPage.likeButton.first()).toBeVisible();
	});

	// ─ テストケース: 理由の選択肢が i18n で出そろっている ─
	// 手順:
	//   1. 結果フィードで通報シートを開く
	//   2. 定数 CONTENT_REPORT_REASON_CODES の全コードについて行が存在し、
	//      ラベルが空でない(= 翻訳キーの引き漏れが無い)ことを検証
	//
	// i18n のキー欠落は「Report.reasons.spam」のようなキー名がそのまま画面へ出る形で壊れる。
	// 見た目には «何か出ている» ので、存在チェックだけでは検知できない
	test("通報理由が選択式で、ラベルが翻訳されている @mutation", async ({ appPage }) => {
		const resultPage = await gotoResultFeed(appPage);

		await openReportSheet(resultPage);
		await expect(resultPage.reportSheet).toBeVisible();

		for (const code of CONTENT_REPORT_REASON_CODES) {
			const row = resultPage.reportReason(code);
			await expect(row).toBeVisible();

			const label = (await row.innerText()).trim();
			expect(label, `${code} のラベルが空`).not.toBe("");
			// 未翻訳だと i18n-js は "[missing \"ja-JP.Report.reasons.xxx\" translation]" を返す
			expect(label, `${code} が未翻訳`).not.toContain("missing");
			expect(label, `${code} がキー名のまま`).not.toContain("Report.reasons");
		}
	});
});
