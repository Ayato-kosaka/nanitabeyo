/*
#1396 PR4: `useMyDishesMapPinsQuery` の初回取得ガードに `!error` が無いと、`useMyDishesQuery`
（#1439 レビュー B-1）と同じ理由で取得失敗のたびに再取得し、無限ループする。
`useMyDishesStore.fetchPins` は成功したときだけ `hasFetchedInitialPinsByQuery` を立て、
`isLoadingPinsByQuery` は `finally` で必ず false へ戻すため、失敗時の最終状態は
`hasFetchedInitial === false` / `isLoading === false` になる。`error` を見ないガードは
`hasFetchedInitial || isLoading` を素通りして `fetchPins` を呼び直してしまう。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { useMyDishesMapPinsQuery, type UseMyDishesMapPinsQueryResult } from "./useMyDishesMapPinsQuery";
import { useMyDishesFilterStore } from "../stores/useMyDishesFilterStore";
import { useMyDishesStore } from "../stores/useMyDishesStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let latest: UseMyDishesMapPinsQueryResult;
function Harness() {
	latest = useMyDishesMapPinsQuery();
	return null;
}

beforeEach(() => {
	useMyDishesFilterStore.getState().reset();
	useMyDishesStore.getState().clearQuery();
	mockCallBackend.mockClear();
});

describe("#1396 Map ピン取得失敗時に無限ループしない", () => {
	it("失敗後、effect が再走しても callBackend を再度呼ばない", async () => {
		mockCallBackend.mockRejectedValue(new Error("boom"));

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<Harness />);
		});

		expect(latest.hasFetchedInitial).toBe(false);
		expect(latest.isLoading).toBe(false);
		expect(latest.error).toBeTruthy();
		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		await act(async () => {
			tree.update(<Harness />);
		});
		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		await act(async () => {
			tree.unmount();
		});
	});

	it("成功時は 1 回だけ取得し、hasFetchedInitial が立つ", async () => {
		mockCallBackend.mockResolvedValue({ data: [], truncated: false });

		await act(async () => {
			TestRenderer.create(<Harness />);
		});

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(mockCallBackend).toHaveBeenCalledWith(
			"v1/users/me/dishes/map-pins",
			expect.objectContaining({ method: "GET" }),
		);
		expect(latest.hasFetchedInitial).toBe(true);
		expect(latest.error).toBeNull();
	});
});

describe("#1396 一覧ビューと同じ queryKey を共有する", () => {
	it("queryKey はフィルタの直列化そのもの（一覧の queryKey と同一の関数から作られる）", async () => {
		mockCallBackend.mockResolvedValue({ data: [], truncated: false });

		await act(async () => {
			TestRenderer.create(<Harness />);
		});

		expect(latest.queryKey).toBe("default");
	});
});

/**
 * #1396 PR4 レビュー m-2（設計 §8-4 リスク2 の本丸）: `MyDishesMapView.test.tsx` は
 * `useMyDishesMapPinsQuery` ごとモックしているため、`fetchPins` の依存配列や `fetcher` の
 * `useMemo` に viewport（`Region`）由来の値が将来混ざっても検知できない。
 *
 * ここではフックをモックせず、`filter` / `queryKey` を変えない再レンダー（Map の pan は
 * `onRegionChangeComplete` が `useRef` に書くだけなので、親コンポーネントが再レンダーされる
 * ことはあっても `filter` は一切変わらない — その状況を模す）を何度繰り返しても
 * `callBackend` の呼び出し回数が増えないことを直接固定する。
 */
describe("#1396 m-2 pan 相当の再レンダーでは fetch が走らない", () => {
	it("filter / queryKey を変えない再レンダーを繰り返しても callBackend は 1 回のまま", async () => {
		mockCallBackend.mockResolvedValue({ data: [], truncated: false });

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<Harness />);
		});
		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		const queryKeyAfterMount = latest.queryKey;

		// pan 相当: MyDishesMapView 側の viewport ローカル state（isTooWide 等）が変わるたびに
		// 親は再レンダーされるが、filter store には一切触れない。ここでは同じ Harness を
		// 何度も re-render して、その状況を直接シミュレートする。
		for (let i = 0; i < 5; i++) {
			await act(async () => {
				tree.update(<Harness />);
			});
		}

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(latest.queryKey).toBe(queryKeyAfterMount);

		await act(async () => {
			tree.unmount();
		});
	});
});
