/*
#1396 取得結果 store（`byKey` スライス）の不変条件を固定する（設計書 (2/2) §3-3）。

見るのは 3 つ。

1. **LRU で 3 本だけ残す。** フィルタを往復したときに再取得しないための保持であって、
   無制限に貯める場所ではない（42 件 × N ページが積み上がる）。
   追い出した `queryKey` の行は `itemByKey` からも消えること。
2. **`nextCursor === null` が唯一の終端条件**（#1395 §6）。終端で `fetchMore` を呼んでも
   フェッチが飛ばないこと。Calendar の `onEndReached` 暴走（設計書 (2/2) §4-4）の防波堤。
3. **この store にも viewport を置かない**（§3-2）。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

import type { MyDishItem } from "@shared/api/v1/res";
import {
	MY_DISHES_QUERY_LRU_SIZE,
	selectMyDishesByQuery,
	useMyDishesStore,
	type MyDishesFetchResult,
} from "../features/myDishes/stores/useMyDishesStore";

const getState = () => useMyDishesStore.getState();

/** 検証に要るのは key だけなので、それ以外は最小限で埋める */
const item = (key: string): MyDishItem => ({ key, status: "eaten", occurredAt: "2026-08-01T00:00:00.000Z" }) as MyDishItem;

const page = (keys: string[], nextCursor: string | null = null, oldestOccurredAt: string | null = null) =>
	({ data: keys.map(item), nextCursor, oldestOccurredAt }) as MyDishesFetchResult;

beforeEach(() => {
	getState().clearQuery();
});

describe("#1396 初回取得", () => {
	it("行を itemByKey へ正規化し、並び順を itemKeysByQuery に持つ", async () => {
		await getState().fetchInitial("q1", async () => page(["review:a", "dish:b"], "cursor-1", "2020-01-01T00:00:00.000Z"));

		const slice = selectMyDishesByQuery("q1")(getState());
		expect(slice.itemKeys).toEqual(["review:a", "dish:b"]);
		expect(slice.hasFetchedInitial).toBe(true);
		expect(slice.hasNextPage).toBe(true);
		expect(slice.oldestOccurredAt).toBe("2020-01-01T00:00:00.000Z");
		expect(Object.keys(getState().itemByKey).sort()).toEqual(["dish:b", "review:a"]);
	});

	it("フィルタを変えた（= queryKey が変わった）ら cursor を捨てて先頭から取り直す", async () => {
		const fetcher = jest.fn(async ({ cursor }: { cursor?: string | null }) =>
			page([`review:${cursor ?? "first"}`], "cursor-1"),
		);
		await getState().fetchInitial("q1", fetcher);
		await getState().fetchInitial("q2", fetcher);

		// 初回取得はどちらも cursor 無しで投げる
		expect(fetcher).toHaveBeenNthCalledWith(1, { cursor: null });
		expect(fetcher).toHaveBeenNthCalledWith(2, { cursor: null });
	});

	it("失敗しても他のキーを壊さず、errorByQuery に入る", async () => {
		await getState().fetchInitial("q1", async () => page(["review:a"]));
		await getState().fetchInitial("q2", async () => {
			throw new Error("boom");
		});

		expect(selectMyDishesByQuery("q1")(getState()).itemKeys).toEqual(["review:a"]);
		expect(selectMyDishesByQuery("q2")(getState()).error).toContain("failedToLoad");
		expect(selectMyDishesByQuery("q2")(getState()).isLoading).toBe(false);
	});
});

describe("#1395 §6 追加取得は nextCursor === null で終端", () => {
	it("nextCursor を渡して追記し、重複キーは足さない", async () => {
		await getState().fetchInitial("q1", async () => page(["review:a"], "cursor-1"));
		await getState().fetchMore("q1", async ({ cursor }) => {
			expect(cursor).toBe("cursor-1");
			return page(["review:a", "review:b"], null);
		});

		expect(selectMyDishesByQuery("q1")(getState()).itemKeys).toEqual(["review:a", "review:b"]);
		expect(selectMyDishesByQuery("q1")(getState()).hasNextPage).toBe(false);
	});

	it("終端（nextCursor === null）で fetchMore を呼んでもフェッチしない（onEndReached の暴走を止める）", async () => {
		await getState().fetchInitial("q1", async () => page(["review:a"], null));
		const fetcher = jest.fn(async () => page(["review:b"]));
		await getState().fetchMore("q1", fetcher);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("未取得のキーに対する fetchMore も何もしない", async () => {
		const fetcher = jest.fn(async () => page(["review:a"]));
		await getState().fetchMore("never-fetched", fetcher);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("追加取得の同時実行は 1 本に絞る", async () => {
		await getState().fetchInitial("q1", async () => page(["review:a"], "cursor-1"));
		let resolvePage: ((value: MyDishesFetchResult) => void) | undefined;
		const fetcher = jest.fn(
			() =>
				new Promise<MyDishesFetchResult>((resolve) => {
					resolvePage = resolve;
				}),
		);

		const first = getState().fetchMore("q1", fetcher);
		await getState().fetchMore("q1", fetcher); // 走っている間の 2 本目は無視される
		resolvePage?.(page(["review:b"], null));
		await first;

		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});

describe("#1396 古い queryKey は LRU で 3 本だけ残す", () => {
	it("4 本目を取ると最も古い 1 本のスライスが消える", async () => {
		expect(MY_DISHES_QUERY_LRU_SIZE).toBe(3);
		for (const key of ["q1", "q2", "q3", "q4"]) {
			await getState().fetchInitial(key, async () => page([`review:${key}`]));
		}

		expect(getState().recentQueryKeys).toEqual(["q4", "q3", "q2"]);
		expect(getState().itemKeysByQuery.q1).toBeUndefined();
		expect(getState().nextCursorByQuery.q1).toBeUndefined();
		expect(getState().hasFetchedInitialByQuery.q1).toBeUndefined();
		// 追い出したキーだけが参照していた行は itemByKey からも消す
		expect(getState().itemByKey["review:q1"]).toBeUndefined();
		expect(getState().itemByKey["review:q4"]).toBeDefined();
	});

	it("往復しても 3 本以内なら再取得しない（hasFetchedInitial が残る）", async () => {
		for (const key of ["q1", "q2", "q3"]) {
			await getState().fetchInitial(key, async () => page([`review:${key}`]));
		}
		expect(selectMyDishesByQuery("q1")(getState()).hasFetchedInitial).toBe(true);
	});

	it("再訪した queryKey は LRU の先頭へ上がる（次の追い出し対象にならない）", async () => {
		for (const key of ["q1", "q2", "q3"]) {
			await getState().fetchInitial(key, async () => page([`review:${key}`]));
		}
		await getState().fetchInitial("q1", async () => page(["review:q1"]));
		await getState().fetchInitial("q4", async () => page(["review:q4"]));

		expect(getState().recentQueryKeys).toEqual(["q4", "q1", "q3"]);
		expect(getState().itemKeysByQuery.q2).toBeUndefined();
		expect(getState().itemKeysByQuery.q1).toEqual(["review:q1"]);
	});

	it("複数キーが同じ行を参照していれば、片方が追い出されても行は残る", async () => {
		for (const key of ["q1", "q2", "q3"]) {
			await getState().fetchInitial(key, async () => page(["review:shared"]));
		}
		await getState().fetchInitial("q4", async () => page(["review:shared"]));
		expect(getState().itemByKey["review:shared"]).toBeDefined();
	});
});

describe("#1396 取得結果 store にも viewport を置かない（§3-2）", () => {
	it("トップレベルのスライスは «取得結果» だけ", () => {
		expect(Object.keys(getState()).sort()).toEqual(
			[
				"clearQuery",
				"errorByQuery",
				"fetchInitial",
				"fetchMore",
				"hasFetchedInitialByQuery",
				"isLoadingByQuery",
				"isLoadingMoreByQuery",
				"itemByKey",
				"itemKeysByQuery",
				"nextCursorByQuery",
				"oldestOccurredAtByQuery",
				"recentQueryKeys",
			].sort(),
		);
	});
});
