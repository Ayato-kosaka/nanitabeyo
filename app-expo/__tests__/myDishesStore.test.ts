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

describe("#1396 古い queryKey は LRU で MY_DISHES_QUERY_LRU_SIZE 本だけ残す", () => {
	// #1397 §8-2 / R2: 3 → 6 に増やした。「3 本」に固定するのではなく定数から本数を作ることで、
	// このテストがサイズ変更それ自体で腐らないようにする
	const keysUpToLimit = Array.from({ length: MY_DISHES_QUERY_LRU_SIZE }, (_, i) => `q${i + 1}`);

	it("LRU 容量+1 本目を取ると最も古い 1 本のスライスが消える", async () => {
		const keys = [...keysUpToLimit, "extra"];
		for (const key of keys) {
			await getState().fetchInitial(key, async () => page([`review:${key}`]));
		}

		const oldest = keys[0];
		const newest = keys[keys.length - 1];
		expect(getState().recentQueryKeys).toEqual([...keys].reverse().slice(0, MY_DISHES_QUERY_LRU_SIZE));
		expect(getState().itemKeysByQuery[oldest]).toBeUndefined();
		expect(getState().nextCursorByQuery[oldest]).toBeUndefined();
		expect(getState().hasFetchedInitialByQuery[oldest]).toBeUndefined();
		// 追い出したキーだけが参照していた行は itemByKey からも消す
		expect(getState().itemByKey[`review:${oldest}`]).toBeUndefined();
		expect(getState().itemByKey[`review:${newest}`]).toBeDefined();
	});

	it("往復しても LRU 容量以内なら再取得しない（hasFetchedInitial が残る）", async () => {
		for (const key of keysUpToLimit) {
			await getState().fetchInitial(key, async () => page([`review:${key}`]));
		}
		expect(selectMyDishesByQuery(keysUpToLimit[0])(getState()).hasFetchedInitial).toBe(true);
	});

	it("再訪した queryKey は LRU の先頭へ上がる（次の追い出し対象にならない）", async () => {
		for (const key of keysUpToLimit) {
			await getState().fetchInitial(key, async () => page([`review:${key}`]));
		}
		await getState().fetchInitial(keysUpToLimit[0], async () => page([`review:${keysUpToLimit[0]}`]));
		await getState().fetchInitial("extra", async () => page(["review:extra"]));

		// 再訪した keysUpToLimit[0] ではなく、再訪していない keysUpToLimit[1] が追い出される
		expect(getState().recentQueryKeys[0]).toBe("extra");
		expect(getState().recentQueryKeys).toContain(keysUpToLimit[0]);
		expect(getState().itemKeysByQuery[keysUpToLimit[1]]).toBeUndefined();
		expect(getState().itemKeysByQuery[keysUpToLimit[0]]).toEqual([`review:${keysUpToLimit[0]}`]);
	});

	it("複数キーが同じ行を参照していれば、片方が追い出されても行は残る", async () => {
		for (const key of keysUpToLimit) {
			await getState().fetchInitial(key, async () => page(["review:shared"]));
		}
		await getState().fetchInitial("extra", async () => page(["review:shared"]));
		expect(getState().itemByKey["review:shared"]).toBeDefined();
	});
});

describe("#1396 m-1 touchQuery はキャッシュヒット（fetchInitial を呼ばない経路）でも LRU を touch する", () => {
	const keysUpToLimit = Array.from({ length: MY_DISHES_QUERY_LRU_SIZE }, (_, i) => `q${i + 1}`);

	it("fetchInitial を伴わない touchQuery だけで LRU の先頭へ上がる", async () => {
		for (const key of keysUpToLimit) {
			await getState().fetchInitial(key, async () => page([`review:${key}`]));
		}
		expect(getState().recentQueryKeys).toEqual([...keysUpToLimit].reverse());

		// 実フックは queryKey が変わるたびに touchQuery を呼ぶ（キャッシュヒットでも）。
		// fetchInitial を経由しない再訪でも LRU の先頭へ上がることを固定する
		getState().touchQuery(keysUpToLimit[0]);
		expect(getState().recentQueryKeys[0]).toBe(keysUpToLimit[0]);

		await getState().fetchInitial("extra", async () => page(["review:extra"]));

		// touch していた keysUpToLimit[0] ではなく、touch していない keysUpToLimit[1] が追い出される
		expect(getState().recentQueryKeys[0]).toBe("extra");
		expect(getState().recentQueryKeys).toContain(keysUpToLimit[0]);
		expect(getState().itemKeysByQuery[keysUpToLimit[1]]).toBeUndefined();
		expect(getState().itemKeysByQuery[keysUpToLimit[0]]).toEqual([`review:${keysUpToLimit[0]}`]);
	});

	it("touchQuery だけでは再取得しない（LRU の並び順だけを動かす）", async () => {
		const fetcher = jest.fn(async () => page(["review:q1"]));
		await getState().fetchInitial("q1", fetcher);
		getState().touchQuery("q1");
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});

describe("#1396 取得結果 store にも viewport を置かない（§3-2）", () => {
	it("トップレベルのスライスは «取得結果»（一覧 + PR4 の Map ピン）だけ", () => {
		expect(Object.keys(getState()).sort()).toEqual(
			[
				"clearQuery",
				"errorByQuery",
				"errorPinsByQuery",
				"fetchInitial",
				"fetchMore",
				"fetchPins",
				// #1398 (PR4/7) 破棄の世代。viewport の類ではなく «飛行中の取得を捨てるための版数» なので
				// このガードの趣旨（Map の pan/zoom を store へ流し込ませない）には反しない
				"generation",
				"hasFetchedInitialByQuery",
				"hasFetchedInitialPinsByQuery",
				"isLoadingByQuery",
				"isLoadingMoreByQuery",
				"isLoadingPinsByQuery",
				"itemByKey",
				"itemKeysByQuery",
				"nextCursorByQuery",
				"oldestOccurredAtByQuery",
				"pinsByQuery",
				"recentQueryKeys",
				"touchQuery",
				"truncatedByQuery",
			].sort(),
		);
	});
});

/*
#1396 PR4: `pinsByQuery`（Map ピン）の不変条件。一覧（`itemKeysByQuery` 等）と同じ形で、
- 同一 `queryKey` の飛行中は二重に投げない
- 失敗しても他のキーを壊さない
- 一覧と同じ LRU（`recentQueryKeys`）を共有し、追い出されたキーのピンも一緒に消える
ことを見る。`useMyDishesMapPinsQuery.test.tsx` が持つ B-1 型の無限ループ回避は
フック側のガードなのでそちらの責務。ここでは store 単体の不変条件だけを見る。
*/
describe("#1396 pinsByQuery（Map ピン）", () => {
	const pinsPage = (ids: string[], truncated = false) =>
		({
			data: ids.map((id) => ({ restaurant: { id } }) as unknown as import("@shared/api/v1/res").MyDishPin),
			truncated,
		}) as const;

	it("成功すると pinsByQuery / truncatedByQuery / hasFetchedInitialPinsByQuery に反映する", async () => {
		await getState().fetchPins("q1", async () => pinsPage(["r1", "r2"], true));

		expect(getState().pinsByQuery.q1?.map((p) => p.restaurant.id)).toEqual(["r1", "r2"]);
		expect(getState().truncatedByQuery.q1).toBe(true);
		expect(getState().hasFetchedInitialPinsByQuery.q1).toBe(true);
		expect(getState().errorPinsByQuery.q1 ?? null).toBeNull();
	});

	it("失敗しても他のキーを壊さず、errorPinsByQuery に入る", async () => {
		await getState().fetchPins("q1", async () => pinsPage(["r1"]));
		await getState().fetchPins("q2", async () => {
			throw new Error("boom");
		});

		expect(getState().pinsByQuery.q1?.map((p) => p.restaurant.id)).toEqual(["r1"]);
		expect(getState().errorPinsByQuery.q2).toContain("failedToLoad");
		expect(getState().isLoadingPinsByQuery.q2).toBe(false);
		expect(getState().hasFetchedInitialPinsByQuery.q2 ?? false).toBe(false);
	});

	it("同一キーの取得が飛行中は二重に投げない", async () => {
		let resolvePins: ((value: ReturnType<typeof pinsPage>) => void) | undefined;
		const fetcher = jest.fn(
			() =>
				new Promise<ReturnType<typeof pinsPage>>((resolve) => {
					resolvePins = resolve;
				}),
		);

		const first = getState().fetchPins("q1", fetcher);
		const second = getState().fetchPins("q1", fetcher);
		resolvePins?.(pinsPage(["r1"]));
		await Promise.all([first, second]);

		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it("一覧と同じ LRU を共有し、queryKey が追い出されるとピンも一緒に消える", async () => {
		const keys = Array.from({ length: MY_DISHES_QUERY_LRU_SIZE + 1 }, (_, i) => `q${i + 1}`);
		for (const key of keys) {
			await getState().fetchPins(key, async () => pinsPage([`r-${key}`]));
		}

		const oldest = keys[0];
		const newest = keys[keys.length - 1];
		expect(getState().recentQueryKeys).toEqual([...keys].reverse().slice(0, MY_DISHES_QUERY_LRU_SIZE));
		expect(getState().pinsByQuery[oldest]).toBeUndefined();
		expect(getState().hasFetchedInitialPinsByQuery[oldest]).toBeUndefined();
		expect(getState().pinsByQuery[newest]?.map((p) => p.restaurant.id)).toEqual([`r-${newest}`]);
	});
});

/**
 * #1599 引っ張って更新に追い抜かれた追加取得を捨てる。
 *
 * #1398 が入れた `generation` ガードは **`clearQuery` を通る破棄**しか見ていない。
 * `fetchInitial`（= 引っ張って更新）は `clearQuery` を呼ばないので `generation` を
 * 進めず、飛行中の `fetchMore` はガードをすり抜けて書き込んでしまう。
 *
 * `fetchMore` は `isLoadingByQuery` を見て «更新中には始めない» が、逆
 * （追加取得の飛行中に更新が始まる）は塞がれていない。`fetchInitial` が見ているのは
 * `isLoadingByQuery` だけで、`isLoadingMoreByQuery` は見ていないためである。
 *
 * この一覧の取得は平均 4.48 秒・最大 11.23 秒（#1395 §0(A) の実測）なので、
 * 窓はミリ秒ではなく秒の幅で開いている。
 */
describe("#1599 追加取得が引っ張って更新に追い抜かれたとき", () => {
	it("遅れて返った古いページを一覧へ混ぜず、カーソルも上書きしない", async () => {
		await getState().fetchInitial("q1", async () => page(["review:old-1"], "cursor-1"));
		expect(selectMyDishesByQuery("q1")(getState()).itemKeys).toEqual(["review:old-1"]);

		// 追加取得（cursor-1）を投げる。まだ返さない
		let release!: (value: MyDishesFetchResult) => void;
		const pending = new Promise<MyDishesFetchResult>((resolve) => {
			release = resolve;
		});
		const morePromise = getState().fetchMore("q1", async () => pending);

		// 返る前に引っ張って更新。«食べたい» を外したので old-1 は消えている
		await getState().fetchInitial("q1", async () => page(["review:fresh-1"], "cursor-FRESH"));
		expect(selectMyDishesByQuery("q1")(getState()).itemKeys).toEqual(["review:fresh-1"]);

		// ここで遅れて cursor-1 の応答が返る
		release(page(["review:old-2"], "cursor-2"));
		await morePromise;

		// 更新前のページが末尾へ紛れ込まないこと
		expect(selectMyDishesByQuery("q1")(getState()).itemKeys).toEqual(["review:fresh-1"]);
		// カーソルも «更新前の連鎖» の値で上書きされないこと。
		// ここが壊れると、以降の「もっと読む」が画面と別系統を辿る
		expect(getState().nextCursorByQuery["q1"]).toBe("cursor-FRESH");
	});

	it("追い抜かれていなければ、これまでどおり末尾へ追記する（直しすぎていない）", async () => {
		await getState().fetchInitial("q1", async () => page(["review:a"], "cursor-1"));
		await getState().fetchMore("q1", async () => page(["review:b"], "cursor-2"));

		expect(selectMyDishesByQuery("q1")(getState()).itemKeys).toEqual(["review:a", "review:b"]);
		expect(getState().nextCursorByQuery["q1"]).toBe("cursor-2");
	});

	it("追い抜かれた取得のエラーで、更新後の一覧をエラー表示にしない", async () => {
		await getState().fetchInitial("q1", async () => page(["review:a"], "cursor-1"));

		let fail!: (reason: Error) => void;
		const pending = new Promise<MyDishesFetchResult>((_resolve, reject) => {
			fail = reject;
		});
		const morePromise = getState().fetchMore("q1", async () => pending);

		await getState().fetchInitial("q1", async () => page(["review:fresh"], "cursor-FRESH"));

		fail(new Error("boom"));
		await morePromise;

		expect(getState().errorByQuery["q1"]).toBeNull();
	});
});
