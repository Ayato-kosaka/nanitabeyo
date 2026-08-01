// #1122 【設計】候補詳細モーダルの「店を見る」が、"モーダルを閉じてから" 遷移することを固定するテスト。
//
// 背景（Issue #1122）:
// 旧実装の handleOpenCandidateDishMedia は BlurModal を閉じずに router.push していた。
// BlurModal の中身は react-native-paper の Portal 経由で Portal.Host 直下（= Stack より上のレイヤー）
// へ描かれるため、遷移しても StyleSheet.absoluteFill のバックドロップが遷移先の上に残り続け、
// Web / Android では遷移先（DishMediaMap）をタップできなかった。
// iOS だけ無事だったのは、遷移先 /search/result が presentation:"transparentModal"
// （= ネイティブ modal presentation）で Portal.Host より上に載るため。
//
// このテストは「router.push の時点で Portal が既にアンマウントされている」ことを
// イベント列で固定する。close を消す / close と push の順序を入れ替えると赤になる。
// setTimeout での先送りに戻した場合も、fake timer を進めずに push が来ないため赤になる。
import React, { act } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";

import type { DishCategoryGroupVoteCandidate, DishCategoryGroupVoteDetailResponse } from "@shared/api/v1/res";

// 観測用のイベント列。jest.mock のファクトリからは `mock` 始まりの変数だけ参照できる
const mockEvents: string[] = [];
const mockRouterPush = jest.fn((..._args: unknown[]) => {
	mockEvents.push("router.push");
});

// ---- 観測対象（Portal のアンマウントと router.push の順序）以外はすべてスタブ化する ----
// lucide のアイコンは名前ごとに export されるため Proxy で一括スタブ化する（searchScreenPreload.test.tsx と同じ）
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
jest.mock("expo-image", () => ({
	Image: function MockExpoImage() {
		return null;
	},
}));
jest.mock("expo-blur", () => ({
	BlurView: function MockBlurView() {
		return null;
	},
}));
// Portal は「どのレイヤーに描かれるか」ではなく「マウント/アンマウントの瞬間」だけ観測できれば足りる
jest.mock("react-native-paper", () => {
	const ReactModule = require("react");
	return {
		Portal: function MockPortal({ children }: { children: React.ReactNode }) {
			ReactModule.useEffect(() => {
				mockEvents.push("portal-mounted");
				return () => {
					mockEvents.push("portal-unmounted");
				};
			}, []);
			return children;
		},
	};
});
// ⚠️ ファクトリ内で `mockRouterPush` を即座に参照すると、babel が import を巻き上げる関係で
// TDZ（宣言前アクセス）になり router.push が undefined になる。必ず呼び出し時に解決すること
jest.mock("expo-router", () => ({
	router: {
		push: (...args: unknown[]) => mockRouterPush(...args),
		replace: jest.fn(),
		back: jest.fn(),
	},
}));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("react-native-safe-area-context", () => {
	const { View: RNView } = require("react-native");
	return { SafeAreaView: RNView, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/lib/share", () => ({ generateShareUrl: () => "https://example.test/share" }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useAPICall", () => ({
	useAPICall: () => ({ callBackend: jest.fn(() => Promise.resolve({ items: [] })) }),
}));
jest.mock("@/contexts/DialogProvider", () => ({
	useDialog: () => ({ confirm: jest.fn(() => Promise.resolve(false)) }),
}));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
jest.mock("@/components/ScreenHeader", () => ({
	ScreenHeader: function MockScreenHeader() {
		return null;
	},
}));
jest.mock("@/components/LoadingIndicator", () => ({
	LoadingIndicator: function MockLoadingIndicator() {
		return null;
	},
}));
// PrimaryButton は押下だけできれば足りる。label をそのまま testID にして詳細モーダル内の
// 「店を見る」を特定する（本物は haptics などを引き込むため差し替える）
jest.mock("@/components/PrimaryButton", () => {
	const ReactModule = require("react");
	const { Pressable } = require("react-native");
	return {
		PrimaryButton: function MockPrimaryButton({
			label,
			onPress,
			disabled,
		}: {
			label: string;
			onPress?: () => void;
			disabled?: boolean;
		}) {
			return ReactModule.createElement(Pressable, {
				testID: `primary-button:${label}`,
				onPress: disabled ? undefined : onPress,
			});
		},
	};
});
// 一覧は「候補を押して詳細モーダルを開く」「一覧から直接店を見る」の 2 導線だけ再現する
jest.mock("./DishCategoryGroupVoteCandidateList", () => {
	const ReactModule = require("react");
	const { Pressable } = require("react-native");
	return {
		DishCategoryGroupVoteCandidateList: function MockList({
			candidates,
			onPressCandidate,
			onPressDishMedia,
		}: {
			candidates: { id: string }[];
			onPressCandidate: (candidate: unknown) => void;
			onPressDishMedia: (candidate: unknown) => void;
		}) {
			return candidates.map((candidate) =>
				ReactModule.createElement(
					ReactModule.Fragment,
					{ key: candidate.id },
					ReactModule.createElement(Pressable, {
						testID: `list-open-detail:${candidate.id}`,
						onPress: () => onPressCandidate(candidate),
					}),
					ReactModule.createElement(Pressable, {
						testID: `list-open-dish-media:${candidate.id}`,
						onPress: () => onPressDishMedia(candidate),
					}),
				),
			);
		},
	};
});
jest.mock("./DishCategoryGroupVoteResultHeader", () => ({
	DishCategoryGroupVoteResultHeader: function MockHeader() {
		return null;
	},
}));
jest.mock("./DishCategoryGroupVoteComments", () => ({
	DishCategoryGroupVoteComments: function MockComments() {
		return null;
	},
}));
jest.mock("../hooks/useDishCategoryGroupVotePolling", () => ({ useDishCategoryGroupVotePolling: jest.fn() }));
jest.mock("../hooks/useDishCategoryGroupVoteActions", () => ({
	useDishCategoryGroupVoteActions: () => ({
		cacheCandidateDishMedia: jest.fn(),
		deleteCandidate: jest.fn(),
		restoreCandidate: jest.fn(),
		submitVote: jest.fn(),
	}),
}));
// dishMediaSearchStatus:"found" の候補だけを扱うので、検索 helper と fallback は呼ばれない
jest.mock("@/features/search/hooks/useGoogleMapsFallback", () => ({
	useGoogleMapsFallback: () => ({ showGoogleMapsFallbackDialog: jest.fn() }),
}));
jest.mock("@/lib/dishMediaSearch", () => ({ createDishItemsForCategory: jest.fn() }));
// 遷移前の dish-media 先読みは非同期なので、store ごとスタブ化して本テストへ持ち込まない
jest.mock("@/stores/useDishMediaEntriesStore", () => ({
	useDishMediaEntriesStore: {
		getState: () => ({
			mediaIdsByKey: {},
			isLoadingByKey: {},
			upsertDishMediaEntries: jest.fn(),
			updateMediaIdsByKeyAsync: jest.fn(),
		}),
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

import { DishCategoryGroupVoteResultScreen } from "./DishCategoryGroupVoteResultScreen";

const CANDIDATE: DishCategoryGroupVoteCandidate = {
	id: "candidate-1",
	dishCategoryId: "dish-category-1",
	displayName: "ラーメン",
	tagline: "こってり",
	imageUrl: "https://example.test/ramen.jpg",
	// #1122 「店を見る」が即座に遷移する（= 検索を挟まない）経路を再現する
	dishMediaIds: ["dish-media-1"],
	dishMediaSearchStatus: "found",
	displayOrder: 0,
	deletedAt: null,
	likeCount: 1,
	dislikeCount: 0,
	rank: 1,
	votes: [{ participantId: "participant-1", displayName: "ねこ", reaction: "like" }],
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
		isHost: true,
		hasVoted: true,
		participantCount: 1,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	},
	candidates: [CANDIDATE],
	participants: [{ id: "participant-1", displayName: "ねこ", comment: null, createdAt: "2026-01-01T00:00:00.000Z" }],
};

const press = (root: ReactTestInstance, testID: string) => {
	const target = root.findByProps({ testID });
	act(() => {
		target.props.onPress?.();
	});
};

describe("DishCategoryGroupVoteResultScreen の「店を見る」", () => {
	beforeEach(() => {
		mockEvents.length = 0;
		mockDetail.current = DETAIL;
	});

	it("詳細モーダルから押すと、遷移より先にモーダルが閉じる", () => {
		let renderer!: TestRenderer.ReactTestRenderer;
		act(() => {
			renderer = TestRenderer.create(<DishCategoryGroupVoteResultScreen shareToken="share-token-1" />);
		});
		const root = renderer.root;

		// 詳細モーダルを開く（= Portal がマウントされる）
		press(root, `list-open-detail:${CANDIDATE.id}`);
		expect(mockEvents).toEqual(["portal-mounted"]);

		// 詳細モーダル内の「店を見る」
		press(root, "primary-button:DishCategoryGroupVotes.viewRestaurants");

		// 遷移は 1 回だけ、かつ Portal のアンマウント（= モーダルのクローズ完了）より後
		expect(mockRouterPush).toHaveBeenCalledTimes(1);
		expect(mockEvents).toEqual(["portal-mounted", "portal-unmounted", "router.push"]);
		expect(mockRouterPush.mock.calls[0][0]).toMatchObject({
			pathname: "/[locale]/(tabs)/search/result",
			params: { entriesKey: `dish-category-group-votes:share-token-1:${CANDIDATE.id}`, category: "ラーメン" },
		});

		act(() => {
			renderer.unmount();
		});
	});

	it("一覧カードから押した場合は、待つモーダルが無いのでそのまま遷移する", () => {
		let renderer!: TestRenderer.ReactTestRenderer;
		act(() => {
			renderer = TestRenderer.create(<DishCategoryGroupVoteResultScreen shareToken="share-token-1" />);
		});

		press(renderer.root, `list-open-dish-media:${CANDIDATE.id}`);

		expect(mockRouterPush).toHaveBeenCalledTimes(1);
		expect(mockEvents).toEqual(["router.push"]);

		act(() => {
			renderer.unmount();
		});
	});
});
