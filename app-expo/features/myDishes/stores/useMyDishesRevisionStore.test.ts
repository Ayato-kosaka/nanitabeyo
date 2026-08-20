/*
#1398 (PR4/7) 記録成功時の一覧無効化（`revision` bump）。

見るのは 3 つ。

1. `bump()` が my-dishes のキャッシュを **丸ごと** 捨てること（設計 §3 の「クライアントキャッシュ」）
2. **`queryKey` に版数が混ざらない**こと（PR4 の地雷 (b)。混ざると LRU 6 本を版が食い潰し、
   記録するたびに base の一覧が追い出される）
3. 捨てたあとのスライスが `hasFetchedInitial` / `error` ともに落ちていること。
   ここが落ちていないと、`!error` ガード付きの取得 effect（#1439 B-1 の対策）が
   «取り直すべきときに取り直さない» か «error のまま毎レンダー叩く» のどちらかに倒れる
*/
import type { MyDishItem } from "@shared/api/v1/res";
import {
	DEFAULT_MY_DISHES_FILTER,
	selectFilterQueryKey,
	useMyDishesFilterStore,
} from "./useMyDishesFilterStore";
import { useMyDishesRevisionStore } from "./useMyDishesRevisionStore";
import { useMyDishesStore } from "./useMyDishesStore";

const QUERY_KEY = "default";
const OTHER_KEY = "restaurantId=restaurant-9";

const makeItem = (key: string): MyDishItem =>
	({
		key,
		status: "want",
		occurredAt: "2026-08-01T00:00:00.000Z",
		savedAt: "2026-08-01T00:00:00.000Z",
		eatenAt: null,
		restaurant: { id: "restaurant-1", name: "テスト食堂", image_url: null },
		dish: { id: "dish-1", name: "唐揚げ定食", categoryImageUrl: "https://example.com/c.jpg" },
		dishMedia: { id: "media-1", thumbnailImageUrl: null },
		myReview: null,
		distanceMeters: null,
	}) as unknown as MyDishItem;

const seed = () => {
	useMyDishesStore.setState({
		itemByKey: { "dish:1": makeItem("dish:1") },
		itemKeysByQuery: { [QUERY_KEY]: ["dish:1"], [OTHER_KEY]: ["dish:1"] },
		hasFetchedInitialByQuery: { [QUERY_KEY]: true, [OTHER_KEY]: true },
		errorByQuery: { [QUERY_KEY]: "network error" },
		recentQueryKeys: [QUERY_KEY, OTHER_KEY],
	});
};

beforeEach(() => {
	useMyDishesStore.getState().clearQuery();
	useMyDishesRevisionStore.setState({ revision: 0 });
	useMyDishesFilterStore.setState({ filter: DEFAULT_MY_DISHES_FILTER });
});

describe("useMyDishesRevisionStore", () => {
	it("bump で版が 1 つ進む", () => {
		useMyDishesRevisionStore.getState().bump();
		expect(useMyDishesRevisionStore.getState().revision).toBe(1);
	});

	it("bump は my-dishes のスライスを丸ごと捨てる（部分無効化にしない）", () => {
		seed();
		useMyDishesRevisionStore.getState().bump();

		const state = useMyDishesStore.getState();
		// 1 件の記録は base の一覧・Map のピン・Calendar の月・他店の Sheet いずれにも波及する。
		// どのキーが影響を受けるかをクライアントで再現するとサーバの SQL と二重管理になる
		expect(state.itemKeysByQuery).toEqual({});
		expect(state.itemByKey).toEqual({});
		expect(state.recentQueryKeys).toEqual([]);
	});

	it("捨てたあとは hasFetchedInitial も error も落ちている（取得 effect が取り直せる）", () => {
		seed();
		useMyDishesRevisionStore.getState().bump();

		const state = useMyDishesStore.getState();
		// `!error` ガードは «error が立っている間は叩かない» なので、error が残っていると
		// 版を進めても永久に取り直せなくなる
		expect(state.errorByQuery[QUERY_KEY]).toBeUndefined();
		expect(state.hasFetchedInitialByQuery[QUERY_KEY]).toBeUndefined();
	});

	it("版数は queryKey に混ざらない（LRU 6 本を版が食い潰さない）", () => {
		const before = selectFilterQueryKey(useMyDishesFilterStore.getState());
		useMyDishesRevisionStore.getState().bump();
		useMyDishesRevisionStore.getState().bump();
		const after = selectFilterQueryKey(useMyDishesFilterStore.getState());
		expect(after).toBe(before);
	});

	it("bump はフィルタを 1 つも書き換えない（3 ビューの絞り込みを勝手に変えない）", () => {
		useMyDishesFilterStore.setState({ filter: { ...DEFAULT_MY_DISHES_FILTER, status: ["eaten"] } });
		useMyDishesRevisionStore.getState().bump();
		expect(useMyDishesFilterStore.getState().filter.status).toEqual(["eaten"]);
	});
});
