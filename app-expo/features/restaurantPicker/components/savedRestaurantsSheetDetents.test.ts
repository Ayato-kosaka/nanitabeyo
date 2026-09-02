import { SMALL_DETENT_HEIGHT, computeSmallDetent } from "./savedRestaurantsSheetDetents";

/**
 * #1074 SavedRestaurantsSheet の small detent はウィンドウ高さから算出する。
 *
 * PR #1118 以前はモジュール評価時の固定値だったため、縦横回転や web のリサイズで
 * ウィンドウ高さが変わっても detent（TrueSheet へ渡す 0〜1 の割合）が追従しなかった。
 * `computeSmallDetent` がウィンドウ高さに応じて値を変え、かつ 0〜0.5 の範囲を
 * 逸脱しないことを固定する。
 */
describe("#1074 computeSmallDetent", () => {
	it("縦長（844）と横長（390）でウィンドウ高さに追従して戻り値が変わる", () => {
		const portrait = computeSmallDetent(844);
		const landscape = computeSmallDetent(390);
		expect(portrait).not.toBe(landscape);
	});

	it("縦長（844）は SMALL_DETENT_HEIGHT / 844 を返す", () => {
		expect(computeSmallDetent(844)).toBe(SMALL_DETENT_HEIGHT / 844);
	});

	it("横長（390）は SMALL_DETENT_HEIGHT / 390 を返す", () => {
		expect(computeSmallDetent(390)).toBe(SMALL_DETENT_HEIGHT / 390);
	});

	it("非常に小さい高さでも clamp 上限の 0.5 を超えない", () => {
		expect(computeSmallDetent(200)).toBe(0.5);
	});

	it("0 は clamp 上限の 0.5 を返す（ゼロ除算にしない）", () => {
		expect(computeSmallDetent(0)).toBe(0.5);
	});

	it("負数は 0.5 を返す", () => {
		expect(computeSmallDetent(-100)).toBe(0.5);
	});

	it("NaN は 0.5 を返す（NaN を返さない）", () => {
		expect(computeSmallDetent(NaN)).toBe(0.5);
	});

	it("Infinity は 0.5 を返す（Infinity を返さない）", () => {
		expect(computeSmallDetent(Infinity)).toBe(0.5);
	});

	it("戻り値は常に (0, 0.5] の範囲に収まる（TrueSheet の detent は 0〜1 の割合のため）", () => {
		const heights = [0, -100, NaN, Infinity, 1, 100, 200, 390, 844, 1024, 2000];
		for (const height of heights) {
			const detent = computeSmallDetent(height);
			expect(detent).toBeGreaterThan(0);
			expect(detent).toBeLessThanOrEqual(0.5);
		}
	});
});
