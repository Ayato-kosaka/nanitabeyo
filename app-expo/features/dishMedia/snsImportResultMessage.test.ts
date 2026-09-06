/*
#1834【チーム指摘】「読み取れたのか、読み取れてないのかよく分からんかった」の回帰テスト。

守るのは 1 つだけ: **«取りに行って失敗した» と «取れたが手がかりが無かった» を
同じ文言に畳まないこと。** 本番ログでは前者（Instagram の 302 = レート制限）が
実際に起きており、押し直せば取れることがある。後者は何度押しても変わらない。
*/
import { resolveResultSummaryKey, resolveStepHeadingKeys } from "./snsImportResultMessage";

const noCandidates = { dishCategories: [], restaurants: [] };

describe("resolveResultSummaryKey", () => {
	it("候補があれば «読み取りました»", () => {
		expect(
			resolveResultSummaryKey({
				status: "ok",
				candidates: { dishCategories: [], restaurants: [{ restaurantId: "r1" }] },
			} as never),
		).toBe("SnsImport.result.summary");
	});

	it("取りに行って失敗（unknown）は «取得できなかった»", () => {
		expect(resolveResultSummaryKey({ status: "unknown", candidates: noCandidates } as never)).toBe(
			"SnsImport.result.fetchFailed",
		);
	});

	it("取れたが候補ゼロ（ok）は «情報がありませんでした»", () => {
		expect(resolveResultSummaryKey({ status: "ok", candidates: noCandidates } as never)).toBe(
			"SnsImport.result.noInfo",
		);
	});

	it("«取得できなかった» と «情報がありませんでした» は別のキーである", () => {
		expect(resolveResultSummaryKey({ status: "unknown", candidates: noCandidates } as never)).not.toBe(
			resolveResultSummaryKey({ status: "ok", candidates: noCandidates } as never),
		);
	});
});

/*
#1918【チーム指摘】「手入力方式もあるんかな？」の回帰テスト。

守るのは «候補が出ている側の見出しだけが «確認» になる» こと。
店舗と料理を 1 つのフラグでまとめると、候補ゼロの側にも «読み取った◯◯を確認» が出て、
読み取れていないものを «確認してください» と言う嘘になる。
*/
describe("#1918 resolveStepHeadingKeys", () => {
	const candidates = (restaurants: number, dishCategories: number) => ({
		candidates: {
			restaurants: Array.from({ length: restaurants }, (_, i) => ({ restaurantId: `r${i}` })),
			dishCategories: Array.from({ length: dishCategories }, (_, i) => ({ dishCategoryId: `d${i}` })),
		},
	});

	it("両方に候補があれば、両方とも «確認» の見出し", () => {
		expect(resolveStepHeadingKeys(candidates(1, 3) as never)).toEqual({
			restaurant: "SnsImport.steps.restaurantConfirm",
			dishCategory: "SnsImport.steps.dishConfirm",
		});
	});

	it("候補ゼロ（主要経路）は従来どおり «選ぶ» の見出し", () => {
		expect(resolveStepHeadingKeys(candidates(0, 0) as never)).toEqual({
			restaurant: "SnsImport.steps.restaurant",
			dishCategory: "SnsImport.steps.dish",
		});
	});

	it("片方だけ候補があるとき、候補ゼロの側は «選ぶ» のまま", () => {
		expect(resolveStepHeadingKeys(candidates(0, 2) as never)).toEqual({
			restaurant: "SnsImport.steps.restaurant",
			dishCategory: "SnsImport.steps.dishConfirm",
		});
	});

	it("まだ読み取っていない（null）ときは «選ぶ»", () => {
		expect(resolveStepHeadingKeys(null)).toEqual({
			restaurant: "SnsImport.steps.restaurant",
			dishCategory: "SnsImport.steps.dish",
		});
	});
});
