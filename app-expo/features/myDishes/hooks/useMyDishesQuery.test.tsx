/*
#1439 レビュー B-1（Blocker）: `useMyDishesQuery` の初回取得ガードに `!error` が無いと、
取得失敗のたびに再取得して無限ループする（964MB の `dish_reviews` を叩き続ける）。

`useMyDishesStore.fetchInitial` は成功したときだけ `hasFetchedInitial` を立て、
`isLoading` は `finally` で必ず false へ戻す。したがって失敗時の最終状態は
`hasFetchedInitial === false` / `isLoading === false` になり、`error` を見ないガードは
`hasFetchedInitial || isLoading` を素通りして `fetchInitial` を呼び直してしまう
（`app/[locale]/restaurant/[restaurantId]/feed.tsx` / `RestaurantReviewsTab.tsx` と同じバグ型）。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

const mockCallBackend = jest.fn();
// #1375（9 巡目）一覧の取得に所要時間の記録を足したので、このフックは useLogger を呼ぶ。
// 実体は supabase クライアントを読むため、ここで差し替えないとテストが起動できない
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { useMyDishesQuery, type UseMyDishesQueryResult } from "./useMyDishesQuery";
import { useMyDishesFilterStore } from "../stores/useMyDishesFilterStore";
import { useMyDishesStore } from "../stores/useMyDishesStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** フックの戻り値を毎レンダー記録するだけのハーネス */
let latest: UseMyDishesQueryResult;
function Harness() {
	latest = useMyDishesQuery();
	return null;
}

beforeEach(() => {
	useMyDishesFilterStore.getState().reset();
	useMyDishesStore.getState().clearQuery();
	mockCallBackend.mockClear();
});

describe("#1439 B-1 取得失敗時に無限ループしない", () => {
	it("失敗後、effect が再走しても fetchInitial（callBackend）を再度呼ばない", async () => {
		mockCallBackend.mockRejectedValue(new Error("boom"));

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<Harness />);
		});

		// 失敗の最終状態: hasFetchedInitial=false / isLoading=false / error だけが立つ
		expect(latest.hasFetchedInitial).toBe(false);
		expect(latest.isLoading).toBe(false);
		expect(latest.error).toBeTruthy();
		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		// 親の再レンダーを模してもう一度レンダーさせても、error が立っている間は再取得しない
		await act(async () => {
			tree.update(<Harness />);
		});
		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		await act(async () => {
			tree.unmount();
		});
	});

	it("成功時は 1 回だけ取得し、hasFetchedInitial が立つ", async () => {
		mockCallBackend.mockResolvedValue({ data: [], nextCursor: null, meta: { oldestOccurredAt: null } });

		await act(async () => {
			TestRenderer.create(<Harness />);
		});

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(latest.hasFetchedInitial).toBe(true);
		expect(latest.error).toBeNull();
	});
});
