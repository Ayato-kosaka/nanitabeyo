/*
#1834【チーム指摘】「読み取れたのか、読み取れてないのかよく分からんかった」の回帰テスト。

守るのは 1 つだけ: **«取りに行って失敗した» と «取れたが手がかりが無かった» を
同じ文言に畳まないこと。** 本番ログでは前者（Instagram の 302 = レート制限）が
実際に起きており、押し直せば取れることがある。後者は何度押しても変わらない。
*/
import { resolveResultSummaryKey } from "./snsImportResultMessage";

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
