/*
#1397 PR2: 料理メディア Sheet 用の派生クエリフック（設計 (2/2) §8-1〜§8-3）。

見るのは 3 つ。

1. 派生 queryKey が `sort` / `featureKeys` を含まないこと（Q5: Sheet 内は常に
   「新しい順」固定）。`restaurantId` を含み、base とは別キーになること。
2. #1439 B-1 / #1396 と同型: 取得失敗後、effect が再走しても再取得しない（`!error` ガード）。
3. R2（本質）: Sheet を開くたびに base の queryKey も touchQuery し、base のスライスが
   LRU から evict されないこと。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

const mockCallBackend = jest.fn();
// #1375（9 巡目）一覧の取得に所要時間の記録を足したので、このフックは useLogger を呼ぶ。
// 実体は supabase クライアントを読むため、ここで差し替えないとテストが起動できない
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { useMyDishesRestaurantQuery, type UseMyDishesRestaurantQueryResult } from "./useMyDishesRestaurantQuery";
import { useMyDishesQuery } from "./useMyDishesQuery";
import { selectFilterQueryKey, useMyDishesFilterStore } from "../stores/useMyDishesFilterStore";
import { MY_DISHES_QUERY_LRU_SIZE, useMyDishesStore } from "../stores/useMyDishesStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RESTAURANT_ID = "11111111-1111-1111-1111-000000000001";

let latest: UseMyDishesRestaurantQueryResult;
function Harness({ restaurantId }: { restaurantId: string | null }) {
	latest = useMyDishesRestaurantQuery(restaurantId);
	return null;
}

beforeEach(() => {
	useMyDishesFilterStore.getState().reset();
	useMyDishesStore.getState().clearQuery();
	mockCallBackend.mockClear();
});

describe("#1397 派生 queryKey", () => {
	it("base とは別キーになり、restaurantId を含む", async () => {
		mockCallBackend.mockResolvedValue({ data: [], nextCursor: null, meta: { oldestOccurredAt: null } });

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<Harness restaurantId={RESTAURANT_ID} />);
		});

		const baseQueryKey = selectFilterQueryKey(useMyDishesFilterStore.getState());
		expect(latest.queryKey).not.toBe(baseQueryKey);
		expect(latest.queryKey).toContain(`restaurantId=${RESTAURANT_ID}`);

		await act(async () => {
			tree.unmount();
		});
	});

	it("sort / featureKeys を含まない（Q5: Sheet 内は常に新しい順に固定する）", async () => {
		mockCallBackend.mockResolvedValue({ data: [], nextCursor: null, meta: { oldestOccurredAt: null } });

		// 共有フィルタの sort をあえて既定以外にしても、派生 queryKey には出てこないこと
		useMyDishesFilterStore.getState().patch({ sort: "-featureScore", featureKeys: ["scene:date", "timeSlot:dinner"] });

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<Harness restaurantId={RESTAURANT_ID} />);
		});

		expect(latest.queryKey).not.toBeNull();
		expect(latest.queryKey).not.toMatch(/sort=/);
		expect(latest.queryKey).not.toMatch(/featureKeys=/);
		expect(latest.queryKey).toContain(`restaurantId=${RESTAURANT_ID}`);

		await act(async () => {
			tree.unmount();
		});
	});

	it("restaurantId が null の間は queryKey も null で、取得しない", async () => {
		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<Harness restaurantId={null} />);
		});

		expect(latest.queryKey).toBeNull();
		expect(latest.hasFetchedInitial).toBe(false);
		expect(mockCallBackend).not.toHaveBeenCalled();

		await act(async () => {
			tree.unmount();
		});
	});
});

describe("#1397 取得失敗時に無限ループしない（#1439 B-1 / #1396 と同型）", () => {
	it("失敗後、effect が再走しても callBackend を再度呼ばない", async () => {
		mockCallBackend.mockRejectedValue(new Error("boom"));

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<Harness restaurantId={RESTAURANT_ID} />);
		});

		expect(latest.hasFetchedInitial).toBe(false);
		expect(latest.isLoading).toBe(false);
		expect(latest.error).toBeTruthy();
		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		// 親の再レンダーを模してもう一度レンダーさせても、error が立っている間は再取得しない
		await act(async () => {
			tree.update(<Harness restaurantId={RESTAURANT_ID} />);
		});
		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		await act(async () => {
			tree.unmount();
		});
	});

	it("成功時は 1 回だけ取得し、hasFetchedInitial が立つ", async () => {
		mockCallBackend.mockResolvedValue({ data: [], nextCursor: null, meta: { oldestOccurredAt: null } });

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<Harness restaurantId={RESTAURANT_ID} />);
		});

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(latest.hasFetchedInitial).toBe(true);
		expect(latest.error).toBeNull();

		await act(async () => {
			tree.unmount();
		});
	});
});

/*
#1397 R2: 「Sheet を 5 店舗開いても base スライスが残る」を固定する。

base（一覧・Map 共有）は Sheet を開くたびに touchQuery されるので、常に LRU の
MRU 側（2 番目に新しい）に留まり続ける。したがって Sheet を何店舗開いても evict
されないのが正しい挙動である。5 店舗という数はこの Issue のリーダー判断コメントの
文言（「Sheet を 5 店舗開いても base スライスが残る」）に合わせた。
*/
describe("#1397 R2 Sheet を5店舗開いても base スライスが残る", () => {
	const restaurantIdAt = (i: number) => `11111111-1111-1111-1111-${String(i).padStart(12, "0")}`;

	it("base の queryKey は5店舗ぶんの Sheet 開閉後も LRU から evict されない", async () => {
		mockCallBackend.mockResolvedValue({ data: [], nextCursor: null, meta: { oldestOccurredAt: null } });

		function BaseHarness() {
			useMyDishesQuery();
			return null;
		}

		let baseTree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			baseTree = TestRenderer.create(<BaseHarness />);
		});

		const baseQueryKey = selectFilterQueryKey(useMyDishesFilterStore.getState());
		expect(useMyDishesStore.getState().hasFetchedInitialByQuery[baseQueryKey]).toBe(true);

		// Map ビューへ切り替わり、一覧の base ハーネスは unmount される（実運用と同じ。
		// unmount 後は base の queryKey を touch する経路が Sheet 側にしか残らない）
		await act(async () => {
			baseTree.unmount();
		});

		for (let i = 1; i <= 5; i++) {
			let sheetTree!: TestRenderer.ReactTestRenderer;
			await act(async () => {
				sheetTree = TestRenderer.create(<Harness restaurantId={restaurantIdAt(i)} />);
			});
			await act(async () => {
				sheetTree.unmount();
			});
		}

		expect(useMyDishesStore.getState().hasFetchedInitialByQuery[baseQueryKey]).toBe(true);
		expect(useMyDishesStore.getState().itemKeysByQuery[baseQueryKey]).toBeDefined();
		expect(useMyDishesStore.getState().recentQueryKeys).toContain(baseQueryKey);
	});

	/*
	上のテストは LRU_SIZE(6) = base + 5 店舗ちょうどなので、`MY_DISHES_QUERY_LRU_SIZE` を
	3→6 にしただけ（base を touch しない）でも偶然通ってしまう。ここでは LRU 容量を
	明確に超える数の Sheet を開閉し、「base を touch しない実装」なら必ず落ちる状況を
	作ることで、touchQuery(base) が本当に効いていることを検証する。
	*/
	it("LRU 容量を超える数の Sheet を開閉しても base だけは evict されない（size 増加だけでは説明できない）", async () => {
		mockCallBackend.mockResolvedValue({ data: [], nextCursor: null, meta: { oldestOccurredAt: null } });

		function BaseHarness() {
			useMyDishesQuery();
			return null;
		}

		let baseTree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			baseTree = TestRenderer.create(<BaseHarness />);
		});
		const baseQueryKey = selectFilterQueryKey(useMyDishesFilterStore.getState());

		await act(async () => {
			baseTree.unmount();
		});

		const restaurantCount = MY_DISHES_QUERY_LRU_SIZE + 3;
		for (let i = 1; i <= restaurantCount; i++) {
			let sheetTree!: TestRenderer.ReactTestRenderer;
			await act(async () => {
				sheetTree = TestRenderer.create(<Harness restaurantId={restaurantIdAt(i)} />);
			});
			await act(async () => {
				sheetTree.unmount();
			});
		}

		expect(useMyDishesStore.getState().hasFetchedInitialByQuery[baseQueryKey]).toBe(true);
		expect(useMyDishesStore.getState().recentQueryKeys).toContain(baseQueryKey);

		// 最初に開いた Sheet の queryKey は LRU から落ちている（base だけが特別扱いで
		// 生き残っているのであって、無制限に貯めているわけではない）
		const hasOldestSheetSlice = Object.keys(useMyDishesStore.getState().itemKeysByQuery).some((key) =>
			key.includes(restaurantIdAt(1)),
		);
		expect(hasOldestSheetSlice).toBe(false);
	});
});
