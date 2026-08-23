/*
#1396 PR5: PR #1442 レビュー M-1 の再発防止（必須）。

M-1 は「`hasFetchedInitial` で EmptyState をふさいだせいで、取得に失敗したことが
ユーザーに伝わらず復帰不能になる」という指摘だった。`MyDishesCalendarView.test.tsx` は
`useMyDishesQuery` ごとモックしているため、`EmptyState` の `onRetry` に渡した `refresh` が
「本物の `fetchInitial` まで辿り着いて `callBackend` を呼ぶか」を検証できない
（`refresh` がただの `jest.fn()` でも同じテストが通ってしまう）。

ここでは `useMyDishesQuery` は本物のまま、`useAPICall`（= `callBackend`）だけをモックし、
**初回失敗 → エラー表示 → 再試行ボタン押下 → callBackend が 2 回目を呼ぶ**を通しで確認する。
あわせて #1439 B-1（`!error` ガード）の再確認として、失敗後に自動再取得しないことも見る。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("expo-router", () => ({
	router: { setParams: jest.fn(), push: jest.fn() },
	usePathname: () => "/ja-JP/my-dishes",
}));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("expo-image", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return { Image: () => ReactActual.createElement(RNView) };
});
jest.mock("@/components/PrimaryButton", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		PrimaryButton: ({ onPress, testID }: { onPress?: () => void; testID?: string }) =>
			ReactActual.createElement(RNView, { testID, onPress }),
	};
});

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { MyDishesCalendarView } from "./MyDishesCalendarView";
import { useMyDishesFilterStore } from "../stores/useMyDishesFilterStore";
import { useMyDishesStore } from "../stores/useMyDishesStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
	useMyDishesFilterStore.getState().reset();
	useMyDishesStore.getState().clearQuery();
	mockCallBackend.mockClear();
});

describe("#1442 M-1 再試行ボタン押下で実際に取得が走る", () => {
	it("初回失敗 → エラー表示の再試行ボタン押下 → callBackend が再び呼ばれる（refresh が本物の fetchInitial まで届く）", async () => {
		mockCallBackend.mockRejectedValueOnce(new Error("boom"));

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<MyDishesCalendarView />);
		});

		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		// #1439 B-1: 失敗後に effect が再走しても自動再取得しない（964MB のテーブルを叩き続けない）
		await act(async () => {
			tree.update(<MyDishesCalendarView />);
		});
		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		// hasFetchedInitial は false のままだが、エラー表示と再試行ボタンは出ている
		const retryButtons = tree.root.findAll((node) => node.props?.testID === "my-dishes-calendar-empty-retry");
		expect(retryButtons.length).toBeGreaterThan(0);

		mockCallBackend.mockResolvedValueOnce({ data: [], nextCursor: null, meta: { oldestOccurredAt: null } });
		await act(async () => {
			retryButtons[0].props.onPress?.();
		});

		expect(mockCallBackend).toHaveBeenCalledTimes(2);
		expect(mockCallBackend).toHaveBeenNthCalledWith(
			2,
			"v1/users/me/dishes",
			expect.objectContaining({ method: "GET" }),
		);

		// 再試行が成功したのでエラー表示は消え、月グリッド（今月）が描かれる
		expect(tree.root.findAll((node) => node.props?.testID === "my-dishes-calendar-empty-retry")).toHaveLength(0);

		await act(async () => {
			tree.unmount();
		});
	});

	it("`onEndReached` は queryKey に view を混ぜないので、Calendar から読んでも一覧と同じ 1 本の取得になる", async () => {
		mockCallBackend.mockResolvedValue({
			data: [],
			nextCursor: null,
			meta: { oldestOccurredAt: null },
		});

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<MyDishesCalendarView />);
		});

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		// 送るのはフィルタ + limit だけ。view / 表示中の月 / cursor は queryKey にも要求にも入らない
		const [, options] = mockCallBackend.mock.calls[0];
		expect(options.requestPayload).toEqual({ limit: 42 });

		// 再レンダー（ビュー切替相当）では取り直さない
		await act(async () => {
			tree.update(<MyDishesCalendarView />);
		});
		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		await act(async () => {
			tree.unmount();
		});
	});
});

/*
#1446 M-2: `sort` が日付順以外だと Calendar が成立しない（空の月が並び、上へ遡っても増えない）。
Calendar は自分の派生 queryKey を使い、`sort` / `featureKeys` を落として
常に既定の `-occurredAt` で読む（#1397 PR2 の `toMyDishesRestaurantQueryParams` と同じ作法）。
*/
describe("#1446 M-2 Calendar は sort を -occurredAt に固定して読む", () => {
	it("共有 sort が -rating でも、Calendar は sort / featureKeys を送らない", async () => {
		mockCallBackend.mockResolvedValue({ data: [], nextCursor: null, meta: { oldestOccurredAt: null } });
		useMyDishesFilterStore.getState().patch({ sort: "-rating", status: ["eaten"], minRating: 4 });

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<MyDishesCalendarView />);
		});

		const [, options] = mockCallBackend.mock.calls[0];
		// 評価フィルタ（ユーザーが選んだ絞り込み）は落とさない。落とすのは並び順だけ
		expect(options.requestPayload).toEqual({ status: ["eaten"], minRating: 4, limit: 42 });
		expect(options.requestPayload.sort).toBeUndefined();

		await act(async () => {
			tree.unmount();
		});
	});

	it("共有 sort が -featureScore でも featureKeys ごと落とす（Sheet と同じ扱い）", async () => {
		mockCallBackend.mockResolvedValue({ data: [], nextCursor: null, meta: { oldestOccurredAt: null } });
		useMyDishesFilterStore.getState().patch({ sort: "-featureScore", featureKeys: ["scene:date"] });

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<MyDishesCalendarView />);
		});

		const [, options] = mockCallBackend.mock.calls[0];
		expect(options.requestPayload).toEqual({ limit: 42 });

		await act(async () => {
			tree.unmount();
		});
	});
});
