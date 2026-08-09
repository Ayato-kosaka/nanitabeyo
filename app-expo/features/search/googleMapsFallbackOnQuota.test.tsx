import { useDishMediaEntriesStore, selectIdsByKey } from "@/stores/useDishMediaEntriesStore";

/**
 * #1196 「上流クォータ枯渇のステータスを 500 → 429 に変えても Google Maps フォールバックが発火する」
 * ことを固定する（入口 A: 検索結果画面）。
 *
 * オーナーから明示的に念を押されている不変条件で、115人/日（実測 92%）が実際に使っている導線。
 *
 * app/[locale]/(tabs)/search/result.tsx はダイアログを
 *   `if (!entriesKey || isLoading || ids.length > 0 || !initialLocation || !category) return;`
 * の否定、つまり **「ids が 0 件」かつ「ロード中でない」** で出す。
 * bulk-import が throw すると store は ids を入れないまま loading を落とすので、
 * 「検索結果 0 件」とまったく同じ状態になり、同じ導線に入る。
 * ここではその前提（store の状態）を固定する。
 *
 * ★ ダイアログを出す条件そのものは #1196 では変更していない。
 *   このテストが赤くなるのは「条件を変えた」か「ステータス変更が導線を壊した」ときだけ。
 * ★ グループ投票側の入口 B は useCandidateDishMediaCache.fallback.test.tsx が担当する。
 */

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

/** 上流クォータ枯渇で bulk-import が 429 を返したときに useAPICall が throw する ApiError */
const quotaApiError = {
	code: "http_error" as const,
	status: 429,
	message: "API call to v1/dishes/bulk-import failed with status 429",
	errorCode: "EXTERNAL_SERVICE_ERROR",
};

/** result.tsx がフォールバックを出すのと同じ条件 */
const fallbackWouldBeShown = (key: string) => {
	const { ids, isLoading } = selectIdsByKey(key, "dish_media")(useDishMediaEntriesStore.getState());
	return !isLoading && ids.length === 0;
};

describe("#1196 検索結果画面: bulk-import の 429 は「0 件」と同じ状態に落ちる", () => {
	afterEach(() => {
		useDishMediaEntriesStore.getState().clearByKey();
	});

	it("429 で reject してもフォールバックの発火条件（0 件 かつ 非ロード中）を満たす", async () => {
		const key = "entries-key-429";

		await useDishMediaEntriesStore
			.getState()
			.updateMediaIdsByKeyAsync(key, Promise.reject(quotaApiError), (_prev, next) => next);

		expect(fallbackWouldBeShown(key)).toBe(true);
	});

	it("従来の 500 でも同じ状態になる（ステータス変更で挙動が変わっていない）", async () => {
		const key = "entries-key-500";

		await useDishMediaEntriesStore
			.getState()
			.updateMediaIdsByKeyAsync(key, Promise.reject({ ...quotaApiError, status: 500 }), (_prev, next) => next);

		expect(fallbackWouldBeShown(key)).toBe(true);
	});

	it("検索結果 0 件（成功して空配列）でも同じ状態になる = 2 つの入口が同じ判定を通る", async () => {
		const key = "entries-key-empty";

		await useDishMediaEntriesStore.getState().updateMediaIdsByKeyAsync(key, Promise.resolve([]), (_prev, next) => next);

		expect(fallbackWouldBeShown(key)).toBe(true);
	});

	it("1 件でも取得できたらフォールバックは出ない（0 件判定が壊れていないことの対照）", async () => {
		const key = "entries-key-found";

		await useDishMediaEntriesStore
			.getState()
			.updateMediaIdsByKeyAsync(key, Promise.resolve(["dish-media-1"]), (_prev, next) => next);

		expect(fallbackWouldBeShown(key)).toBe(false);
	});
});
