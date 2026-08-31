/*
写真の無い記録（投稿を消した記録を含む）の «中身» を固定する。

#1629 のオーナー実機報告 2 件がここの存在理由である。
 1. 「写真なしで良いから自分の書いたクチコミが見たい」
 2. 「編集&削除できない」— 編集・削除はフィード右レールの «…» にしか無く、
    写真の無い記録はメディアのページに出ないので到達できなかった

#1761 まではこのテストは `MyDishesListView.test.tsx` にあり、**ボトムシート越しに**
中身を押していた。器がフィードのページ 1 つになった（シートを削除した）ので、
**中身そのものへ寄せた**。一覧の責務は «どこへ push するか» までで、
クチコミの読み書きはこの部品の責務である。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
const mockCallBackend = jest.fn();
const mockConfirm = jest.fn();
const mockShowSnackbar = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
jest.mock("@/contexts/DialogProvider", () => ({ useDialog: () => ({ confirm: mockConfirm }) }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => new Proxy({}, { get: () => () => null }));

import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { MyDishItem } from "@shared/api/v1/res";

import { MyDishOwnReviewContent } from "./MyDishOwnReviewContent";
import { DELETED_MEDIA_TOMBSTONE_TEST_ID } from "@/components/DeletedMediaTombstone";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REVIEW = {
	id: "review-1",
	rating: 4,
	comment: "肉が厚くて満足",
	price_cents: 3200,
	currency_code: "JPY",
	created_at: "2026-08-10T12:00:00.000Z",
	lock_no: 3,
};

const makeItem = (overrides: { isOwnMediaDeleted?: boolean; myReview?: Record<string, unknown> | null } = {}) =>
	({
		key: "review:1",
		status: "eaten",
		occurredAt: "2026-08-10T12:00:00.000Z",
		eatenAt: "2026-08-10T12:00:00.000Z",
		restaurant: { id: "restaurant-9", name: "テスト食堂", image_url: null },
		dish: { id: "dish-1", name: "焼肉", categoryImageUrl: null, categoryLabels: { ja: "焼肉" } },
		dishMedia: null,
		myReview: overrides.myReview === undefined ? REVIEW : overrides.myReview,
		isOwnMediaDeleted: overrides.isOwnMediaDeleted ?? false,
	}) as unknown as MyDishItem;

const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
const onClose = jest.fn();
const onOpenRestaurant = jest.fn();

const render = async (item: MyDishItem = makeItem()) => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(
			<MyDishOwnReviewContent item={item} onClose={onClose} onOpenRestaurant={onOpenRestaurant} />,
		);
	});
	mountedTrees.push(tree);
	return tree;
};

/*
⚠️ `findAll` は «合成要素» と «ホスト要素» の両方を拾うので、testID 1 つにつき 2 件返る。
   数を見るアサーションではホスト要素（`type` が文字列）だけに絞ること。
*/
const hostsWithTestId = (tree: TestRenderer.ReactTestRenderer, testID: string) =>
	tree.root.findAll((n) => n.props?.testID === testID && typeof n.type === "string");

/*
押すための要素はホスト側ではなく «onPress を持っているほう» を取る。
TouchableOpacity のホスト View は onResponder* しか持たない（ホストに絞ると押せない）。
*/
const pressableWithTestId = (tree: TestRenderer.ReactTestRenderer, testID: string) =>
	tree.root.findAll((n) => n.props?.testID === testID && typeof n.props?.onPress === "function")[0];

afterEach(() => {
	act(() => {
		for (const tree of mountedTrees.splice(0)) tree.unmount();
	});
	mockCallBackend.mockReset();
	mockConfirm.mockReset();
	mockShowSnackbar.mockReset();
	onClose.mockReset();
	onOpenRestaurant.mockReset();
});

describe("#1629 / #1761 写真の無い記録のクチコミ", () => {
	it("自分の書いた本文が読める", async () => {
		const tree = await render();
		expect(hostsWithTestId(tree, "my-dish-own-review-comment")[0].props.children).toBe("肉が厚くて満足");
		// 3200 は最小単位。JPY は 0 桁なので 100 で割らない
		expect(hostsWithTestId(tree, "my-dish-own-review-price")[0].props.children).toContain("3,200");
	});

	it("投稿を消した記録では墓標を出す（別の絵へ差し替えない。#1513）", async () => {
		const deleted = await render(makeItem({ isOwnMediaDeleted: true }));
		expect(hostsWithTestId(deleted, DELETED_MEDIA_TOMBSTONE_TEST_ID)).toHaveLength(1);

		const noPhoto = await render(makeItem());
		expect(hostsWithTestId(noPhoto, DELETED_MEDIA_TOMBSTONE_TEST_ID)).toHaveLength(0);
	});

	it("「お店の詳細を見る」は出口として残す", async () => {
		const tree = await render();
		await act(async () => {
			pressableWithTestId(tree, "my-dish-own-review-open-restaurant").props.onPress();
		});
		expect(onOpenRestaurant).toHaveBeenCalledWith(expect.objectContaining({ key: "review:1" }));
	});

	/*
	#1629【オーナー実機報告】「編集&削除できない」。ここが唯一の出口なので、両方できることを固定する。
	*/
	describe("編集と削除", () => {
		it("「編集」から開くフォームには、いま保存されている内容が入っている", async () => {
			const tree = await render();
			await act(async () => {
				pressableWithTestId(tree, "my-dish-own-review-edit").props.onPress();
			});

			expect(hostsWithTestId(tree, "edit-review-modal")).toHaveLength(1);
			expect(hostsWithTestId(tree, "edit-review-comment-input")[0].props.value).toBe("肉が厚くて満足");
			expect(hostsWithTestId(tree, "edit-review-price-input")[0].props.value).toBe("3200");
		});

		it("保存は lockNo を必ず送る（競合検知を無効化しない）", async () => {
			mockCallBackend.mockResolvedValue({ ...REVIEW, comment: "書き直した", lock_no: 4 });
			const tree = await render();
			await act(async () => {
				pressableWithTestId(tree, "my-dish-own-review-edit").props.onPress();
			});
			await act(async () => {
				pressableWithTestId(tree, "edit-review-submit-button").props.onPress();
			});

			expect(mockCallBackend).toHaveBeenCalledWith(
				"v1/dish-reviews/review-1",
				expect.objectContaining({
					method: "PATCH",
					requestPayload: expect.objectContaining({ lockNo: 3, priceCents: 3200, currencyCode: "JPY" }),
				}),
			);
		});

		it("削除は確認を挟み、承諾されたときだけレビュー 1 件を消す", async () => {
			mockConfirm.mockResolvedValue(false);
			const tree = await render();

			await act(async () => {
				pressableWithTestId(tree, "my-dish-own-review-delete").props.onPress();
			});
			expect(mockConfirm).toHaveBeenCalled();
			expect(mockCallBackend).not.toHaveBeenCalled();

			mockConfirm.mockResolvedValue(true);
			await act(async () => {
				pressableWithTestId(tree, "my-dish-own-review-delete").props.onPress();
			});
			// 写真は «無い» か «既に削除済み» なので、消せるのはクチコミ 1 件だけ
			expect(mockCallBackend).toHaveBeenCalledWith(
				"v1/dish-reviews/review-1",
				expect.objectContaining({ method: "DELETE" }),
			);
			expect(mockCallBackend).not.toHaveBeenCalledWith(expect.stringContaining("dish-media"), expect.anything());
			// 消したら器を閉じる（#1761 ではフィードごと畳む）。開いたままにしない
			expect(onClose).toHaveBeenCalled();
		});
	});
});
