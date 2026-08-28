/*
#1446 M-2: Calendar 用の派生クエリフック（`useMyDishesCalendarQuery`）。

見るのは 3 つ。

1. 共有 `sort` が既定（`-occurredAt`）のとき、**base と同じ queryKey・同じスライス**を引くこと。
   ここが崩れると、Calendar を開くだけで一覧・Map と別の取得が走り、964MB の
   `dish_reviews` を無駄に 2 回叩くうえ LRU も余計に消費する。
2. 共有 `sort` が日付順以外のときは base と別キーになり、`sort` を送らないこと。
3. #1397 PR2 R2 と同型: 別キーで読む間も **base の queryKey を touchQuery する**こと
   （base を LRU から落とさない）。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

const mockCallBackend = jest.fn();
// #1375（9 巡目）一覧の取得に所要時間の記録を足したので、このフックは useLogger を呼ぶ。
// 実体は supabase クライアントを読むため、ここで差し替えないとテストが起動できない
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { useMyDishesCalendarQuery, type UseMyDishesCalendarQueryResult } from "./useMyDishesCalendarQuery";
import { useMyDishesQuery } from "./useMyDishesQuery";
import { selectFilterQueryKey, useMyDishesFilterStore } from "../stores/useMyDishesFilterStore";
import { MY_DISHES_QUERY_LRU_SIZE, useMyDishesStore } from "../stores/useMyDishesStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let latest: UseMyDishesCalendarQueryResult;
function CalendarHarness() {
	latest = useMyDishesCalendarQuery();
	return null;
}

function BaseHarness() {
	useMyDishesQuery();
	return null;
}

const baseKey = () => selectFilterQueryKey(useMyDishesFilterStore.getState());

beforeEach(() => {
	useMyDishesFilterStore.getState().reset();
	useMyDishesStore.getState().clearQuery();
	mockCallBackend.mockClear();
});

describe("#1446 M-2 共有 sort が既定なら base と同一キー（追加の取得も LRU 消費も起きない）", () => {
	it("既定の sort では base と同じ queryKey になり、一覧を開いた後に Calendar を開いても取得は 1 回", async () => {
		mockCallBackend.mockResolvedValue({ data: [], nextCursor: null, meta: { oldestOccurredAt: null } });

		let baseTree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			baseTree = TestRenderer.create(<BaseHarness />);
		});
		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		let calendarTree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			calendarTree = TestRenderer.create(<CalendarHarness />);
		});

		expect(latest.queryKey).toBe(baseKey());
		// ★ 本命: キャッシュヒットするので 2 回目の取得は起きない
		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(useMyDishesStore.getState().recentQueryKeys).toEqual([baseKey()]);

		await act(async () => {
			calendarTree.unmount();
			baseTree.unmount();
		});
	});

	it("フィルタ（status / minRating / area）が載っていても base と同一キーのまま", async () => {
		mockCallBackend.mockResolvedValue({ data: [], nextCursor: null, meta: { oldestOccurredAt: null } });
		useMyDishesFilterStore.getState().patch({ status: ["eaten"], minRating: 4 });
		useMyDishesFilterStore.getState().commitArea({ lat: 35.68, lng: 139.76, radius: 1200 });

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<CalendarHarness />);
		});

		expect(latest.queryKey).toBe(baseKey());

		await act(async () => {
			tree.unmount();
		});
	});
});

describe("#1446 M-2 共有 sort が日付順以外のとき", () => {
	it("base と別キーになり、sort / featureKeys を送らない", async () => {
		mockCallBackend.mockResolvedValue({ data: [], nextCursor: null, meta: { oldestOccurredAt: null } });
		useMyDishesFilterStore.getState().patch({ sort: "-featureScore", featureKeys: ["scene:date", "timeSlot:dinner"] });

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<CalendarHarness />);
		});

		expect(latest.queryKey).not.toBe(baseKey());
		expect(latest.queryKey).not.toMatch(/sort=/);
		expect(latest.queryKey).not.toMatch(/featureKeys=/);

		const [, options] = mockCallBackend.mock.calls[0];
		expect(options.requestPayload).toEqual({ limit: 42 });

		await act(async () => {
			tree.unmount();
		});
	});

	it("自分のキーと base のキーの両方を touch する", async () => {
		mockCallBackend.mockResolvedValue({ data: [], nextCursor: null, meta: { oldestOccurredAt: null } });
		useMyDishesFilterStore.getState().patch({ sort: "-rating" });

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<CalendarHarness />);
		});

		const { recentQueryKeys } = useMyDishesStore.getState();
		expect(latest.queryKey).not.toBe(baseKey());
		expect(recentQueryKeys).toContain(latest.queryKey);
		// ★ base も touch する。これが #1397 PR2 R2 の本質
		expect(recentQueryKeys).toContain(baseKey());

		await act(async () => {
			tree.unmount();
		});
	});

	// #1397 PR2 R2 と同型。base を touch しないと、Calendar 用キーと他のクエリだけが LRU を埋めて
	// 一覧・Map が見ている base のスライスが落ちる。
	// 「Calendar を開き直すたびに base が MRU へ戻る」ことを、LRU 容量を超える数の
	// 無関係な queryKey を挟みながら確認する（base を touch しない実装なら必ず落ちる）
	it("LRU 容量を超える数の別クエリを挟んでも、base のスライスは evict されない", async () => {
		mockCallBackend.mockResolvedValue({ data: [], nextCursor: null, meta: { oldestOccurredAt: null } });
		useMyDishesFilterStore.getState().patch({ sort: "-rating" });

		// 一覧が先に読んだ base のスライス。以降 base を touch する経路は Calendar 側にしか無い
		let baseTree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			baseTree = TestRenderer.create(<BaseHarness />);
		});
		const originalBaseKey = baseKey();
		expect(useMyDishesStore.getState().hasFetchedInitialByQuery[originalBaseKey]).toBe(true);
		await act(async () => {
			baseTree.unmount();
		});

		const { touchQuery } = useMyDishesStore.getState();
		for (let i = 0; i < MY_DISHES_QUERY_LRU_SIZE + 3; i++) {
			// 無関係なクエリ（別フィルタの一覧・Map など）が LRU を押し出しにかかる
			act(() => {
				touchQuery(`unrelated-${i}`);
			});

			let tree!: TestRenderer.ReactTestRenderer;
			await act(async () => {
				tree = TestRenderer.create(<CalendarHarness />);
			});
			await act(async () => {
				tree.unmount();
			});
		}

		expect(useMyDishesStore.getState().recentQueryKeys).toContain(originalBaseKey);
		expect(useMyDishesStore.getState().hasFetchedInitialByQuery[originalBaseKey]).toBe(true);
		// 無制限に貯めているわけではないこと（最初の無関係クエリは落ちている）
		expect(useMyDishesStore.getState().recentQueryKeys).not.toContain("unrelated-0");
	});
});

describe("#1439 B-1 と同型: 取得失敗後に自動再取得しない", () => {
	it("失敗後に再レンダーしても callBackend は 1 回のまま（!error ガード）", async () => {
		mockCallBackend.mockRejectedValueOnce(new Error("boom"));

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<CalendarHarness />);
		});
		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(latest.error).not.toBeNull();

		await act(async () => {
			tree.update(<CalendarHarness />);
		});
		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		await act(async () => {
			tree.unmount();
		});
	});
});
