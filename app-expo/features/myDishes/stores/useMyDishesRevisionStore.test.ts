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
import { DEFAULT_MY_DISHES_FILTER, selectFilterQueryKey, useMyDishesFilterStore } from "./useMyDishesFilterStore";
import { useMyDishesRevisionStore } from "./useMyDishesRevisionStore";
import { useMyDishesStore, type MyDishesFetcher } from "./useMyDishesStore";

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

/*
飛行中の取得が «捨てた世代» の行を書き戻さないこと。

この一覧の取得は平均 4.48 秒・最大 11.23 秒（#1395 §0(A) の実測）なので、
「一覧を開いた直後に want カードの CTA を押して記録する」という普通の操作で、
取得が飛行中のまま `bump()` が走る。世代を見ずに書き戻すと **記録前の行が
`hasFetchedInitial: true` 付きで復活し、`!error` ガード付きの effect はもう取り直さない**。
つまりこの PR が消しに来た「記録直後に食べたいカードが残る」がそのまま出る。
*/
describe("bump と飛行中の取得の競合", () => {
	const fetcherFor = (resolve: { current?: (v: unknown) => void }) =>
		jest.fn(
			() =>
				new Promise((res) => {
					resolve.current = res as (v: unknown) => void;
				}),
		) as unknown as MyDishesFetcher;

	it("飛行中に bump したら、遅れて返ってきた «記録前» の行を書き戻さない", async () => {
		const resolve: { current?: (v: unknown) => void } = {};
		const fetcher = fetcherFor(resolve);

		const inFlight = useMyDishesStore.getState().fetchInitial(QUERY_KEY, fetcher);
		expect(useMyDishesStore.getState().isLoadingByQuery[QUERY_KEY]).toBe(true);

		// 記録が成功した（= 一覧を捨てた）
		useMyDishesRevisionStore.getState().bump();

		// 取得が «あとから» 返る
		resolve.current?.({ data: [makeItem("dish:1")], nextCursor: null, oldestOccurredAt: null });
		await inFlight;

		const state = useMyDishesStore.getState();
		expect(state.itemKeysByQuery[QUERY_KEY]).toBeUndefined();
		expect(state.hasFetchedInitialByQuery[QUERY_KEY]).toBeUndefined();
		// ここが残ると、新しい世代の取得が «二重投げ防止» に引っかかって永久に走らない
		expect(state.isLoadingByQuery[QUERY_KEY]).toBeUndefined();
	});

	it("飛行中に bump したら、遅れて返ってきた失敗も error として書き戻さない", async () => {
		const resolve: { current?: (v: unknown) => void } = {};
		const fetcher = jest.fn(
			() =>
				new Promise((_res, rej) => {
					resolve.current = () => rej(new Error("boom"));
				}),
		) as unknown as MyDishesFetcher;

		const inFlight = useMyDishesStore.getState().fetchInitial(QUERY_KEY, fetcher);
		useMyDishesRevisionStore.getState().bump();
		resolve.current?.(undefined);
		await inFlight;

		// error が生えると `!error` ガードが «取り直すべきときに取り直さない» 側へ倒れる
		expect(useMyDishesStore.getState().errorByQuery[QUERY_KEY]).toBeUndefined();
	});

	it("bump が無ければ従来どおり書き戻す（世代ガードが普通の取得を殺していない）", async () => {
		const resolve: { current?: (v: unknown) => void } = {};
		const fetcher = fetcherFor(resolve);

		const inFlight = useMyDishesStore.getState().fetchInitial(QUERY_KEY, fetcher);
		resolve.current?.({ data: [makeItem("dish:1")], nextCursor: null, oldestOccurredAt: null });
		await inFlight;

		const state = useMyDishesStore.getState();
		expect(state.itemKeysByQuery[QUERY_KEY]).toEqual(["dish:1"]);
		expect(state.hasFetchedInitialByQuery[QUERY_KEY]).toBe(true);
		expect(state.isLoadingByQuery[QUERY_KEY]).toBe(false);
	});
});
