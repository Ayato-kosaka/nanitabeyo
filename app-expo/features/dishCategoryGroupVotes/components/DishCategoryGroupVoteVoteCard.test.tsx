// #1213 【回帰】友達投票の投票画面で、既に読み込み済みのはずの候補画像が
// 候補送りのたびに一瞬灰色になる不具合の固定テスト。
//
// 原因（詳細は DishCategoryGroupVoteVoteScreen.test.tsx のコメントも参照）:
// DishCategoryGroupVoteVoteCard は候補画像の描画を DishCategoryVisualCard に委譲しているが、
// DishCategoryVisualCard は「画面側が Image.loadAsync で先読みした ImageRef（imageState）」を
// 受け取って初めて "cachePolicy=memory 前提の即時表示" ができる設計になっている
// （features/dishCategories/components/DishCategoryVisualCard.tsx の #785/#802/#929 コメント参照）。
// 修正前の DishCategoryGroupVoteVoteCard は imageState を一切受け取らず、常に生の
// uri をその場で DishCategoryVisualCard へ渡していたため、候補が変わるたびに
// ネットワーク取得が発生し、カード背景色（#EEE）が一瞬見えていた。
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { DishCategoryGroupVoteCandidate } from "@shared/api/v1/res";

const mockImage = jest.fn();
jest.mock("expo-image", () => ({
	Image: (props: Record<string, unknown>) => {
		mockImage(props);
		return null;
	},
}));
jest.mock(
	"lucide-react-native",
	() =>
		new Proxy(
			{},
			{
				get: (_target, prop) =>
					prop === "__esModule"
						? true
						: function MockIcon() {
								return null;
							},
			},
		),
);
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useReducedMotion", () => ({ useReducedMotion: () => false }));

import { DishCategoryGroupVoteVoteCard } from "./DishCategoryGroupVoteVoteCard";

const CANDIDATE: DishCategoryGroupVoteCandidate = {
	id: "candidate-1",
	dishCategoryId: "dish-category-1",
	displayName: "ラーメン",
	tagline: "こってり",
	imageUrl: "https://example.test/ramen.jpg",
	dishMediaIds: [],
	dishMediaSearchStatus: "not_searched",
	displayOrder: 0,
	deletedAt: null,
	likeCount: 0,
	dislikeCount: 0,
	rank: null,
	votes: [],
};

const READY_IMAGE = { uri: "resolved://ramen-preloaded" };

describe("DishCategoryGroupVoteVoteCard の画像プリロード連携", () => {
	it("imageState が ready のとき、生の候補 uri ではなくプリロード済みリソースを Image へ渡す", () => {
		let renderer!: TestRenderer.ReactTestRenderer;
		act(() => {
			renderer = TestRenderer.create(
				<DishCategoryGroupVoteVoteCard
					candidate={CANDIDATE}
					onVote={jest.fn()}
					imageState={{ status: "ready", image: READY_IMAGE }}
				/>,
			);
		});

		expect(mockImage).toHaveBeenCalled();
		const lastCallProps = mockImage.mock.calls[mockImage.mock.calls.length - 1][0];
		// プリロード済みなら resolvedImageSource は imageState.image（生の候補 uri ではない）
		expect(lastCallProps.source).toEqual(READY_IMAGE);
		expect(lastCallProps.source).not.toEqual({ uri: CANDIDATE.imageUrl });

		act(() => {
			renderer.unmount();
		});
	});

	it("imageState が loading のあいだは、未ロードの生 uri で Image を描画しない", () => {
		let renderer!: TestRenderer.ReactTestRenderer;
		act(() => {
			renderer = TestRenderer.create(
				<DishCategoryGroupVoteVoteCard candidate={CANDIDATE} onVote={jest.fn()} imageState={{ status: "loading" }} />,
			);
		});

		// DishCategoryVisualCard は imageState が ready 以外のときは Image 自体を描画しない
		// （かわりに Skeleton を出す）。ここで Image が呼ばれていたら、まだ読み込んでいない
		// 生 uri がそのまま表示されてしまっている＝灰色フラッシュの再現条件。
		expect(mockImage).not.toHaveBeenCalled();

		act(() => {
			renderer.unmount();
		});
	});
});
