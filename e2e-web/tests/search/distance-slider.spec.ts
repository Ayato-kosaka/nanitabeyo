import { test, expect } from "../../fixtures/test";

/**
 * 📏 距離スライダー(#935)の操作テスト
 *
 * 背景: 旧実装は `gestureState.moveX - 50` というマジックナンバーで画面絶対座標を
 * トラック相対座標へ誤変換しており、画面幅に依存してズレる(広い画面ほど端に張り付く)
 * 不具合があった。加えて onPanResponderGrant が無くタップでは値が変わらず、
 * サム(28×28)のみがタッチ対象でヒットスロップも無かった。
 * onLayout で実測したトラック幅を使う実装へ作り直したため、ここでは
 * タップ・ドラッグ・キーボード操作それぞれで値が正しく更新されることを検証する。
 */
test.describe("距離スライダー", () => {
	test("タップでその位置に応じた値へ即座にジャンプする", async ({ appPage }) => {
		await appPage.getByTestId("search-advanced-toggle").click();
		const slider = appPage.getByTestId("search-distance-slider");
		await slider.scrollIntoViewIfNeeded();
		const box = await slider.boundingBox();
		if (!box) throw new Error("slider bounding box not found");

		// 右端付近をタップ → 遠い距離側の高いインデックスへジャンプすること
		await appPage.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
		await expect(slider).toHaveAttribute("aria-valuenow", "9");

		// 左端付近をタップ → 近い距離側の低いインデックスへジャンプすること
		await appPage.mouse.click(box.x + box.width * 0.05, box.y + box.height / 2);
		await expect(slider).toHaveAttribute("aria-valuenow", "0");
	});

	test("ドラッグで指の位置に追従して値が更新される", async ({ appPage }) => {
		await appPage.getByTestId("search-advanced-toggle").click();
		const slider = appPage.getByTestId("search-distance-slider");
		await slider.scrollIntoViewIfNeeded();
		const box = await slider.boundingBox();
		if (!box) throw new Error("slider bounding box not found");

		await appPage.mouse.move(box.x + 2, box.y + box.height / 2);
		await appPage.mouse.down();
		await appPage.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 10 });
		await appPage.mouse.up();

		await expect(slider).toHaveAttribute("aria-valuenow", "6");
		await expect(slider).toHaveAttribute("aria-valuetext", "3km");
	});

	// ─ テストケース: フォーカス後、矢印キーで1段階ずつ増減できる(web専用のキーボード操作) ─
	test("矢印キーで1段階ずつ増減できる", async ({ appPage }) => {
		await appPage.getByTestId("search-advanced-toggle").click();
		const slider = appPage.getByTestId("search-distance-slider");
		await slider.scrollIntoViewIfNeeded();
		await slider.focus();

		const initial = await slider.getAttribute("aria-valuenow");
		await appPage.keyboard.press("ArrowRight");
		await expect(slider).toHaveAttribute("aria-valuenow", String(Number(initial) + 1));

		await appPage.keyboard.press("ArrowLeft");
		await appPage.keyboard.press("ArrowLeft");
		await expect(slider).toHaveAttribute("aria-valuenow", String(Number(initial) - 1));
	});
});
