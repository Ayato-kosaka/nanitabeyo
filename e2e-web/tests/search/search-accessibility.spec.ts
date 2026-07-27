import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";

/**
 * ♿ 検索フォームのアクセシビリティ監査(#934)
 *
 * 背景: 時間帯/同行者(画像グリッド)・価格帯(チップ)・食事時間/系統(チップ)に
 * accessibilityRole/State/Label が一切無く、選択状態も枠線色のみで表現されていた
 * (色のみに依存 = WCAG 1.4.1 違反)。SelectableGridItem/SelectableChip へ切り出し、
 * radio/radiogroup/checkbox のネイティブセマンティクスとチェックマークによる視覚表現を追加した。
 *
 * このファイルは @axe-core/playwright で重大な違反(critical/serious)が無いことを保証する。
 */
test.describe("検索フォームのアクセシビリティ", () => {
	test("axe監査で重大な違反(critical/serious)が無い", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		await searchPage.expectLoaded();

		// 詳細条件も含めて監査対象にする(距離・系統セクション)
		await searchPage.advancedToggle.click();
		await expect(appPage.getByText("どんな系統が食べたい？")).toBeVisible();

		const results = await new AxeBuilder({ page: appPage }).include("body").analyze();

		const seriousOrCritical = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");

		// 失敗時に原因を特定しやすいよう、違反内容をエラーメッセージに含める
		expect(
			seriousOrCritical,
			seriousOrCritical
				.map((v) => `${v.id}(${v.impact}): ${v.description}\n  ${v.nodes.map((n) => n.target).join(", ")}`)
				.join("\n"),
		).toEqual([]);
	});

	// ─ テストケース: 時間帯グリッドが radiogroup/radio セマンティクスを持つ ─
	// #989 【修正】時間帯には現在時刻に応じた初期選択があるため、「夜ごはんは未選択」の
	// 決め打ちは時間帯によって失敗する。未選択のスロットを動的に選び、radio の
	// 排他動作(選ぶと aria-checked が付け替わる)を検証する形に変更
	test("時間帯グリッドが radiogroup/radio ロールを持つ", async ({ appPage }) => {
		const timeSlotDinner = appPage.getByTestId("search-time-slot-dinner");
		await expect(timeSlotDinner).toHaveAttribute("role", "radio");

		// 現在未選択のスロットを1つ探す(初期選択は現在時刻依存)
		const slotIds = ["morning", "lunch", "dinner", "late_night"];
		let uncheckedId: string | null = null;
		for (const slot of slotIds) {
			const el = appPage.getByTestId(`search-time-slot-${slot}`);
			if ((await el.getAttribute("aria-checked")) === "false") {
				uncheckedId = slot;
				break;
			}
		}
		expect(uncheckedId, "未選択の時間帯スロットが存在しない").not.toBeNull();

		const unchecked = appPage.getByTestId(`search-time-slot-${uncheckedId}`);
		await unchecked.click();
		await expect(unchecked).toHaveAttribute("aria-checked", "true");
	});

	// ─ テストケース: 価格帯チップが checkbox セマンティクスを持ち複数選択できる ─
	test("価格帯チップが checkbox ロールを持ち複数選択できる", async ({ appPage }) => {
		const inexpensive = appPage.getByTestId("search-price-level-PRICE_LEVEL_INEXPENSIVE");
		const moderate = appPage.getByTestId("search-price-level-PRICE_LEVEL_MODERATE");
		await expect(inexpensive).toHaveAttribute("role", "checkbox");

		await inexpensive.click();
		await expect(inexpensive).toHaveAttribute("aria-checked", "true");

		// 複数選択可能(radioと異なり他の選択を解除しない)であることを確認
		await moderate.click();
		await expect(inexpensive).toHaveAttribute("aria-checked", "true");
		await expect(moderate).toHaveAttribute("aria-checked", "true");
	});
});
