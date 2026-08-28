// #1213 【回帰】友達投票の投票画面（候補を1枚ずつスワイプ/ボタンで送る画面）で、
// 既にネットワークから読み込み済みのはずの候補画像が、候補を送るたびに一瞬灰色になっていた不具合の固定テスト。
//
// 原因の切り分け（Issue #1213 の A〜D）:
//   候補一覧・投票結果側の小さいサムネイル（DishCategoryGroupVoteCandidateCard 等）と違い、
//   この画面の大きな候補カードは features/dishCategories/components/DishCategoryVisualCard を再利用している。
//   DishCategoryVisualCard は cachePolicy="memory" 固定で、DishCategories 検索画面では
//   features/dishCategories/hooks/useDishCategoryImageResources が画面マウント時に Image.loadAsync で
//   候補「全件」を先読みし、ready になった ImageRef を渡すことで初めて即時表示できる
//   （#785/#802/#929 のコメント参照：同一 URL を異なる cachePolicy で読むと iOS の
//   画像パイプラインが分かれてイベントが欠落しうるため、生の uri をその場で渡してはいけない）。
//
//   修正前の DishCategoryGroupVoteVoteScreen / DishCategoryGroupVoteVoteCard はこの
//   プリロード契約に一切参加しておらず、候補が表示されるたびに DishCategoryVisualCard へ生の uri を
//   渡していた（＝ Image キャッシュキー/プリロードなしで毎回ネットワークから取り直す。Issue の A）。
//   このテストは、画面マウント直後（＝ユーザーがまだ1枚もスワイプする前）に候補「全件」の
//   先読みが cacheKey 付きで開始されること、そして表示中の候補へその読み込み結果
//   （imageState）が渡っていることを固定する。
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { DishCategoryGroupVoteCandidate, DishCategoryGroupVoteDetailResponse } from "@shared/api/v1/res";

const mockLoadAsync = jest.fn();
jest.mock("expo-image", () => ({
	Image: {
		loadAsync: (...args: unknown[]) => mockLoadAsync(...args),
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
jest.mock("expo-blur", () => ({
	BlurView: function MockBlurView() {
		return null;
	},
}));
jest.mock("expo-router", () => ({
	router: {
		replace: jest.fn(),
		push: jest.fn(),
		back: jest.fn(),
	},
}));
jest.mock("react-native-safe-area-context", () => {
	const { View: RNView } = require("react-native");
	return { SafeAreaView: RNView, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
jest.mock("@/components/LoadingIndicator", () => ({
	LoadingIndicator: function MockLoadingIndicator() {
		return null;
	},
}));
jest.mock("@/components/PrimaryButton", () => {
	const ReactModule = require("react");
	const { Pressable } = require("react-native");
	return {
		PrimaryButton: function MockPrimaryButton({ label, onPress }: { label: string; onPress?: () => void }) {
			return ReactModule.createElement(Pressable, { testID: `primary-button:${label}`, onPress });
		},
	};
});
jest.mock("./DishCategoryGroupVoteCompletionModal", () => ({
	DishCategoryGroupVoteCompletionModal: function MockCompletionModal() {
		return null;
	},
}));
jest.mock("./DishCategoryGroupVoteInlineOverlay", () => ({
	DishCategoryGroupVoteInlineOverlay: function MockInlineOverlay() {
		return null;
	},
}));

const mockRefresh = jest.fn(() => Promise.resolve());
const mockDetail: { current: DishCategoryGroupVoteDetailResponse | null } = { current: null };
jest.mock("../hooks/useDishCategoryGroupVoteDetail", () => ({
	useDishCategoryGroupVoteDetail: () => ({
		detail: mockDetail.current,
		isLoading: false,
		error: null,
		refresh: mockRefresh,
	}),
}));
jest.mock("../hooks/useDishCategoryGroupVoteActions", () => ({
	useDishCategoryGroupVoteActions: () => ({
		submitVote: jest.fn(),
	}),
}));

// カード自体のプリロード連携は DishCategoryGroupVoteVoteCard.test.tsx で固定済みなので、
// ここでは「画面が何を渡そうとしたか」だけを観測するスタブに差し替える
const mockVoteCardRender = jest.fn();
jest.mock("./DishCategoryGroupVoteVoteCard", () => ({
	DishCategoryGroupVoteVoteCard: function MockVoteCard(props: Record<string, unknown>) {
		mockVoteCardRender(props);
		return null;
	},
}));

import { DishCategoryGroupVoteVoteScreen } from "./DishCategoryGroupVoteVoteScreen";

const CANDIDATE_A: DishCategoryGroupVoteCandidate = {
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

const CANDIDATE_B: DishCategoryGroupVoteCandidate = {
	...CANDIDATE_A,
	id: "candidate-2",
	dishCategoryId: "dish-category-2",
	displayName: "カレー",
	imageUrl: "https://example.test/curry.jpg",
	displayOrder: 1,
};

const DETAIL: DishCategoryGroupVoteDetailResponse = {
	session: {
		id: "session-1",
		shareToken: "share-token-1",
		hostUserId: "user-1",
		searchContext: {
			location: { latitude: 35.1, longitude: 139.1 },
			radius: 1000,
			priceLevels: [],
			localLanguageCode: "ja",
		},
		isHost: false,
		hasVoted: false,
		participantCount: 1,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	},
	candidates: [CANDIDATE_A, CANDIDATE_B],
	participants: [],
};

describe("DishCategoryGroupVoteVoteScreen の画像プリロード", () => {
	beforeEach(() => {
		mockDetail.current = DETAIL;
		mockLoadAsync.mockReset();
		mockVoteCardRender.mockReset();
		// #1213 useDishCategoryImageResources は Image.loadAsync の resolve を待って ready にする。
		// テストでは pending のまま観測したいケースが無いので常に解決させておく。
		mockLoadAsync.mockImplementation(() => Promise.resolve({ uri: "resolved" }));
	});

	it("画面マウント直後、ユーザーがまだ何も操作していない時点で候補全件の先読みが始まる", async () => {
		await act(async () => {
			TestRenderer.create(<DishCategoryGroupVoteVoteScreen shareToken="share-token-1" />);
			// loadAsync 呼び出し自体は同期的に発火するマイクロタスク起点なので、1 tick 待って確定させる
			await Promise.resolve();
		});

		// 表示中の候補（index=0）だけでなく、まだ表示していない次の候補も先読み対象に入っている。
		// 「表示された瞬間に取りに行く」実装（#1213 の原因B寄りの実装）だと2件目はここでまだ呼ばれない。
		expect(mockLoadAsync).toHaveBeenCalledTimes(2);
		expect(mockLoadAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				uri: CANDIDATE_A.imageUrl,
				cacheKey: `${CANDIDATE_A.dishCategoryId}::${CANDIDATE_A.imageUrl}`,
			}),
		);
		expect(mockLoadAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				uri: CANDIDATE_B.imageUrl,
				cacheKey: `${CANDIDATE_B.dishCategoryId}::${CANDIDATE_B.imageUrl}`,
			}),
		);
	});

	it("先読みが完了(ready)すると、表示中の候補カードへ生のuriではなくプリロード結果(imageState)を渡す", async () => {
		await act(async () => {
			TestRenderer.create(<DishCategoryGroupVoteVoteScreen shareToken="share-token-1" />);
			await Promise.resolve();
			await Promise.resolve();
		});

		const lastCall = mockVoteCardRender.mock.calls[mockVoteCardRender.mock.calls.length - 1][0];
		expect(lastCall.candidate.id).toBe(CANDIDATE_A.id);
		expect(lastCall.imageState).toEqual({ status: "ready", image: { uri: "resolved" } });
	});
});
