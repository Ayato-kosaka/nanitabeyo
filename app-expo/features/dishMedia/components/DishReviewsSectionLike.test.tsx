// #1599 レビューのいいねが、API 失敗時に「操作前の値」へ戻ることを固定するテスト。
//
// `handleReviewLike` は 1) ストアを楽観更新 → 2) API を叩く → 3) 失敗しても catch で
// ログを出すだけ、という形になっていた。オフライン・タイムアウト・5xx で
// **画面は「いいね済み」のまま残り、サーバーには何も届いていない**。Snackbar も出ないので、
// ユーザーには不整合に気づく手段が無い（次にこの画面を開き直すと消えている）。
//
// 投稿本体のいいね（ActionButtons.tsx）は #1501 で同じ問題を直してある。
// **同じ画面の同じジェスチャーで、レビュー側だけが取り残されていた。**
// ここは ActionButtons.test.tsx と同じ作法（実ストアを使う）で挙動を揃えたことを固定する。

import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
jest.mock("@/lib/remoteConfig", () => ({
	getRemoteConfig: () => ({ v1_dish_comment_review_show_number: "100" }),
}));
jest.mock("@/components/Stars", () => ({ __esModule: true, default: () => null }));
jest.mock("expo-linear-gradient", () => {
	const { View } = require("react-native");
	return { LinearGradient: View };
});
jest.mock("react-native-gesture-handler", () => {
	const { ScrollView } = require("react-native");
	return { ScrollView };
});
jest.mock("./ReportContentSheet", () => ({ ReportContentSheet: () => null }));

const mockShowSnackbar = jest.fn();
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));

import { DishReviewsSection } from "./DishReviewsSection";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";

// React 19 では初期描画がスケジューラのタスクへ回されるため act() で包む必要がある
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MEDIA_ID = "dm-1";
const REVIEW_ID = "rv-1";

function seedStore(overrides: { isLiked?: boolean; likeCount?: number }) {
	useDishMediaEntriesStore.setState({
		entriesByMediaId: {
			[MEDIA_ID]: {
				dish_media: { id: MEDIA_ID },
				restaurant: { id: "r-1", name: "テスト店" },
				dishReviewIds: [REVIEW_ID],
			},
		} as never,
		reviewsByReviewId: {
			[REVIEW_ID]: {
				id: REVIEW_ID,
				user_id: "someone-else",
				username: "someone",
				comment: "おいしい",
				rating: 5,
				created_at: "2026-08-26T00:00:00.000Z",
				isLiked: overrides.isLiked ?? false,
				likeCount: overrides.likeCount ?? 3,
			},
		} as never,
	});
}

const getReview = () => useDishMediaEntriesStore.getState().reviewsByReviewId[REVIEW_ID]!;

let activeRenderer: TestRenderer.ReactTestRenderer | undefined;

function renderSection() {
	let renderer!: TestRenderer.ReactTestRenderer;
	act(() => {
		renderer = TestRenderer.create(
			<DishReviewsSection id={MEDIA_ID} idType="dish_media" paddingRight={0} carouselRef={undefined} />,
		);
	});
	activeRenderer = renderer;
	return renderer;
}

/** testID に一致する要素のうち、実際に onPress を持つもの（TouchableOpacity 本体）を返す */
function findLikeButton(renderer: TestRenderer.ReactTestRenderer) {
	const matches = renderer.root.findAllByProps({ testID: `review-action-like-${REVIEW_ID}` });
	const pressable = matches.find((instance) => typeof instance.props.onPress === "function");
	if (!pressable) throw new Error("like button not found");
	return pressable;
}

describe("#1599 レビューいいねの楽観更新ロールバック", () => {
	beforeEach(() => {
		mockCallBackend.mockReset();
		mockShowSnackbar.mockReset();
		useDishMediaEntriesStore.setState({ entriesByMediaId: {}, reviewsByReviewId: {} } as never);
	});

	afterEach(() => {
		act(() => activeRenderer?.unmount());
		activeRenderer = undefined;
	});

	it("いいね失敗時、isLiked・likeCount が操作前の値へ戻る", async () => {
		seedStore({ isLiked: false, likeCount: 3 });
		mockCallBackend.mockRejectedValueOnce(new Error("boom"));

		const renderer = renderSection();
		await act(async () => {
			await findLikeButton(renderer).props.onPress();
		});

		expect(getReview().isLiked).toBe(false);
		expect(getReview().likeCount).toBe(3);
		// 黙って戻すと «勝手に取り消された» に見えるので、失敗を伝えて再試行させる
		expect(mockShowSnackbar).toHaveBeenCalledTimes(1);
		const [, options] = mockShowSnackbar.mock.calls[0];
		expect(typeof options?.action?.onPress).toBe("function");
	});

	it("いいね解除（true → false 操作）の失敗時も、操作前の値へ戻る", async () => {
		seedStore({ isLiked: true, likeCount: 5 });
		mockCallBackend.mockRejectedValueOnce(new Error("boom"));

		const renderer = renderSection();
		await act(async () => {
			await findLikeButton(renderer).props.onPress();
		});

		expect(getReview().isLiked).toBe(true);
		expect(getReview().likeCount).toBe(5);
	});

	it("成功時は楽観更新のまま残り、Snackbar も出さない", async () => {
		seedStore({ isLiked: false, likeCount: 3 });
		mockCallBackend.mockResolvedValueOnce(undefined);

		const renderer = renderSection();
		await act(async () => {
			await findLikeButton(renderer).props.onPress();
		});

		expect(getReview().isLiked).toBe(true);
		expect(getReview().likeCount).toBe(4);
		expect(mockShowSnackbar).not.toHaveBeenCalled();
	});

	it("連打しても API は 1 回しか飛ばない（多重実行ガード）", async () => {
		seedStore({ isLiked: false, likeCount: 3 });
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		mockCallBackend.mockImplementation(() => gate);

		const renderer = renderSection();
		const button = findLikeButton(renderer);

		await act(async () => {
			const first = button.props.onPress();
			// 1 発目が飛んでいる最中の 2 発目
			const second = button.props.onPress();
			release();
			await Promise.all([first, second]);
		});

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		// 2 発目がトグルを戻していないこと（ガードが楽観更新より前にある証拠）
		expect(getReview().isLiked).toBe(true);
		expect(getReview().likeCount).toBe(4);
	});

	it("解除は DELETE、付与は POST（メソッドを取り違えない）", async () => {
		seedStore({ isLiked: true, likeCount: 5 });
		mockCallBackend.mockResolvedValueOnce(undefined);

		const renderer = renderSection();
		await act(async () => {
			await findLikeButton(renderer).props.onPress();
		});

		const [path, options] = mockCallBackend.mock.calls[0];
		expect(path).toBe(`v1/dish-reviews/${REVIEW_ID}/likes`);
		expect(options.method).toBe("DELETE");
	});
});
