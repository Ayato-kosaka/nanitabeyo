/*
#1774 **通貨の分からないレビュー行で、編集が壊れないことを固定する。**

`price_cents` は最小単位の整数で、桁数は通貨ごとに違う（JPY は 0 桁、USD は 2 桁）。
通貨が無ければ «その整数が何円なのか» を決められない。

dev の `dish_reviews` に `currency_code IS NULL` の行が 2 件残っている
（通貨未確定のまま既定 2 桁で換算していた頃の残骸。¥500 が 50,000 になっている）。
この行を開いて保存すると `toMinorAmountInteger()` が **try の外で throw** し、
`finally` の `setIsSubmitting(false)` にも届かないので、
**保存ボタンが二度と押せなくなる**（画面上は無反応）。

作成側は API の `@CurrencyCodeWithPrice()` で塞いだので、以後この形の行は増えない。
ここが守るのは «既に壊れている行を、ユーザーが直せること» である。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
const mockCallBackend = jest.fn();
const mockShowSnackbar = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => new Proxy({}, { get: () => () => null }));

import React, { act } from "react";
import TestRenderer from "react-test-renderer";

import { EditDishReviewModal, type EditableDishReview } from "./EditDishReviewModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const review = (overrides: Partial<EditableDishReview> = {}): EditableDishReview => ({
	id: "review-1",
	comment: "肉が厚くて満足",
	rating: 4,
	price_cents: 3200,
	currency_code: "JPY",
	lock_no: 3,
	...overrides,
});

const render = (target: EditableDishReview) => {
	let tree!: TestRenderer.ReactTestRenderer;
	act(() => {
		tree = TestRenderer.create(<EditDishReviewModal review={target} onClose={jest.fn()} onSaved={jest.fn()} />);
	});
	return tree;
};

const press = async (tree: TestRenderer.ReactTestRenderer, testID: string) => {
	await act(async () => {
		tree.root.findByProps({ testID }).props.onPress();
	});
};

beforeEach(() => {
	mockCallBackend.mockReset();
	mockShowSnackbar.mockReset();
	mockCallBackend.mockResolvedValue({ id: "review-1" });
});

describe("#1774 通貨の無い残骸行", () => {
	it("価格の入力欄を出さない（何円か決められないため）", () => {
		const tree = render(review({ price_cents: 50_000, currency_code: null }));
		expect(tree.root.findAllByProps({ testID: "edit-review-price-input" })).toHaveLength(0);
	});

	it("保存しても throw せず、価格・通貨を送らない（据え置き）", async () => {
		const tree = render(review({ price_cents: 50_000, currency_code: null }));

		await press(tree, "edit-review-submit-button");

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		const payload = mockCallBackend.mock.calls[0][1].requestPayload;
		expect(payload.priceCents).toBeUndefined();
		expect(payload.currencyCode).toBeUndefined();
		expect(payload).toMatchObject({ lockNo: 3, rating: 4 });
	});

	it("通貨がある行では今までどおり価格を編集できる", async () => {
		const tree = render(review());
		// TextInput は composite と host の 2 ノードで拾えるので «0 でないこと» だけ見る
		expect(tree.root.findAllByProps({ testID: "edit-review-price-input" }).length).toBeGreaterThan(0);

		await press(tree, "edit-review-submit-button");

		expect(mockCallBackend.mock.calls[0][1].requestPayload).toMatchObject({
			priceCents: 3200,
			currencyCode: "JPY",
		});
	});
});
