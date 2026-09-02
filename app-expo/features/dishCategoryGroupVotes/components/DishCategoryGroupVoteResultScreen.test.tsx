// #1122 【設計】候補詳細の「店を見る」が、"詳細レイヤーを閉じてから" 遷移することを固定するテスト。
//
// 背景（Issue #1122）:
// 旧実装の handleOpenCandidateDishMedia は詳細レイヤーを閉じずに router.push していた。
// 当時の詳細レイヤーは react-native-paper の Portal 経由で Portal.Host 直下（= Stack より上のレイヤー）
// へ描かれたため、遷移しても StyleSheet.absoluteFill のバックドロップが遷移先の上に残り続け、
// Web / Android では遷移先（DishMediaMap）をタップできなかった。
// iOS だけ無事だったのは、遷移先 /search/result が presentation:"transparentModal"
// （= ネイティブ modal presentation）で Portal.Host より上に載るため。
//
// #1358 で詳細レイヤーは画面の子（DishCategoryGroupVoteInlineOverlay）へ移り、Portal を通らなくなった。
// そこでこのテストが固定する不変条件も 3 本立てになっている:
//   1. 【構造】結果画面は Portal を一切マウントしない（＝ 画面スタックの外側にレイヤーを積まない）。
//      Portal へ戻すと "portal-mounted" が観測されて赤になる。
//   2. 【構造】詳細レイヤーは画面の最後の子で、その兄弟に zIndex を持つ要素が居ない。
//      Portal をやめた代わりに「最後の子だから最前面」に頼っているので、zIndex を持つ兄弟
//      （ScreenHeader は zIndex:100）が居るとその帯だけレイヤーの上に残る。
//      ヘッダー + 本文を包むラッパー View を外すと赤になる。
//   3. 【順序】router.push の時点で詳細レイヤーが既にアンマウントされている。
//      close を消す / close と push の順序を入れ替えると赤になる。
//      setTimeout での先送りに戻した場合も、fake timer を進めずに push が来ないため赤になる。
//
// 順序（3）は Portal をやめた今も残す。web は遷移しても前画面の DOM が残るため、
// 「開いたまま遷移してよい」を仕様として許すと #1122 と同じ経路が復活しうる（実装側コメント参照）。
import React, { act } from "react";
import { StyleSheet } from "react-native";
import TestRenderer, { type ReactTestInstance, type ReactTestRendererJSON } from "react-test-renderer";

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
// #1358 Portal は「使っていないこと」の見張りとして残す。結果画面（配下のコンポーネント含む）が
// Portal を描いた瞬間に "portal-mounted" が積まれるので、Portal 実装へ戻すと下のアサーションが赤くなる
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
// #1358 詳細レイヤーは**本物のまま**描いたうえで、マウント/アンマウントの瞬間だけ観測する。
// （中身をスタブに置き換えると、右上の X などクローズ導線そのものを検証できなくなる）
jest.mock("./DishCategoryGroupVoteInlineOverlay", () => {
	const ReactModule = require("react");
	const actual = jest.requireActual("./DishCategoryGroupVoteInlineOverlay");
	return {
		// INLINE_OVERLAY_TEST_ID（レイヤー根の目印）は本物をそのまま通す。テスト側で文字列を
		// 書き写すと、実装側で testID を変えたときに兄弟 zIndex 検査が黙って空振りする
		...actual,
		DishCategoryGroupVoteInlineOverlay: function ObservedInlineOverlay(props: Record<string, unknown>) {
			ReactModule.useEffect(() => {
				mockEvents.push("overlay-mounted");
				return () => {
					mockEvents.push("overlay-unmounted");
				};
			}, []);
			return ReactModule.createElement(actual.DishCategoryGroupVoteInlineOverlay, props);
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
// #1358 ScreenHeader だけは**本物のまま**描く。zIndex:100 を持つのはこのコンポーネントで、
// 「詳細レイヤーの兄弟に zIndex を持つ要素が居ない」という不変条件（下の 3 本目のテスト）は
// スタブに置き換えると検査できなくなる（スタブ側へ zIndex を書き写すと本体の変更に追随しない）。
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
// dishMediaSearchStatus:"not_searched" の候補では検索 → cache を経てから遷移するため、
// 「検索中」を任意の長さで保持できるよう cache/検索 helper はテストから制御する
const mockCacheCandidateDishMedia = jest.fn();
jest.mock("../hooks/useDishCategoryGroupVoteActions", () => ({
	useDishCategoryGroupVoteActions: () => ({
		cacheCandidateDishMedia: mockCacheCandidateDishMedia,
		deleteCandidate: jest.fn(),
		restoreCandidate: jest.fn(),
		submitVote: jest.fn(),
	}),
}));
jest.mock("@/features/search/hooks/useGoogleMapsFallback", () => ({
	useGoogleMapsFallback: () => ({ showGoogleMapsFallbackDialog: jest.fn() }),
}));
const mockCreateDishItemsForCategory = jest.fn();
jest.mock("@/lib/dishMediaSearch", () => ({
	createDishItemsForCategory: (...args: unknown[]) => mockCreateDishItemsForCategory(...args),
}));
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
import { INLINE_OVERLAY_TEST_ID } from "./DishCategoryGroupVoteInlineOverlay";

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

// #1122 未検索候補。「店を見る」を押すと検索 → cache を await してから遷移要求が来る
const NOT_SEARCHED_CANDIDATE: DishCategoryGroupVoteCandidate = {
	...CANDIDATE,
	id: "candidate-2",
	dishCategoryId: "dish-category-2",
	displayName: "カレー",
	dishMediaIds: [],
	dishMediaSearchStatus: "not_searched",
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
		isHost: true,
		hasVoted: true,
		participantCount: 1,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	},
	candidates: [CANDIDATE, NOT_SEARCHED_CANDIDATE],
	participants: [{ id: "participant-1", displayName: "ねこ", comment: null, createdAt: "2026-01-01T00:00:00.000Z" }],
};

const press = (root: ReactTestInstance, testID: string) => {
	const target = root.findByProps({ testID });
	act(() => {
		target.props.onPress?.();
	});
};

// 詳細レイヤー右上の X。レイヤーは実物のまま描画されるので accessibilityLabel で引く
// （e2e-web / e2e-mobile も同じ accessibilityLabel = Common.close を観測点にしている）
const pressModalCloseButton = (root: ReactTestInstance) => {
	const target = root.findAllByProps({ accessibilityLabel: "Common.close" })[0];
	act(() => {
		target.props.onPress?.();
	});
};

// #1358 詳細レイヤーと同じ親を持つ要素（＝レイヤー自身を含む兄弟の並び）を、描画結果のツリーから取り出す。
// 兄弟同士の前後関係と zIndex を見るため、composite を含む findAllByProps ではなく toJSON()（＝実際に
// 並ぶ host 要素だけのツリー）を辿る
const findInlineOverlaySiblings = (node: ReactTestRendererJSON): ReactTestRendererJSON[] | null => {
	const children = (node.children ?? []).filter((child): child is ReactTestRendererJSON => typeof child !== "string");
	if (children.some((child) => child.props?.testID === INLINE_OVERLAY_TEST_ID)) return children;
	for (const child of children) {
		const found = findInlineOverlaySiblings(child);
		if (found) return found;
	}
	return null;
};

/** 兄弟の並びのうち、自前で zIndex を持つもの（＝詳細レイヤーより後に描かれてしまうもの）を列挙する */
const describeSiblingsWithZIndex = (siblings: ReactTestRendererJSON[]) =>
	siblings
		.filter((sibling) => sibling.props?.testID !== INLINE_OVERLAY_TEST_ID)
		.map((sibling) => ({
			type: sibling.type,
			testID: sibling.props?.testID,
			accessibilityLabel: sibling.props?.accessibilityLabel,
			zIndex: StyleSheet.flatten(sibling.props?.style)?.zIndex,
		}))
		// zIndex の出所を失敗メッセージから追えるよう、値まで残す
		.filter((sibling) => sibling.zIndex !== undefined);

// 検索 helper の解決タイミングをテスト側に握らせる
const deferSearch = () => {
	let resolve!: (items: { dish_media: { id: string } }[]) => void;
	const promise = new Promise<{ dish_media: { id: string } }[]>((res) => {
		resolve = res;
	});
	mockCreateDishItemsForCategory.mockReturnValueOnce(promise);
	return async (items: { dish_media: { id: string } }[]) => {
		await act(async () => {
			resolve(items);
			// 検索 → cacheCandidateDishMedia の 2 段 await を消化させる
			await promise;
		});
	};
};

describe("DishCategoryGroupVoteResultScreen の「店を見る」", () => {
	beforeEach(() => {
		mockEvents.length = 0;
		mockDetail.current = DETAIL;
		mockRouterPush.mockClear();
		mockCreateDishItemsForCategory.mockReset();
		mockCacheCandidateDishMedia.mockReset();
		mockCacheCandidateDishMedia.mockResolvedValue({
			dishMediaSearchStatus: "found",
			dishMediaIds: ["dish-media-2"],
		});
	});

	// #1358 【構造】#1122 の根本原因（画面スタックの外側 = Portal へレイヤーを積むこと）を直接禁じる。
	// 共通の BlurModal フック（features/blurModal）へ戻すと Portal がマウントされ、このテストが赤くなる。
	it("候補詳細は Portal を使わず、結果画面の内側へ描かれる", () => {
		let renderer!: TestRenderer.ReactTestRenderer;
		act(() => {
			renderer = TestRenderer.create(<DishCategoryGroupVoteResultScreen shareToken="share-token-1" />);
		});
		const root = renderer.root;

		press(root, `list-open-detail:${CANDIDATE.id}`);

		// 詳細（testID は候補詳細本体。e2e も同じ id を観測点にしている）が結果画面のツリー内に居る
		expect(root.findAllByProps({ testID: "dish-category-group-vote-candidate-detail" }).length).toBeGreaterThan(0);
		expect(mockEvents).toEqual(["overlay-mounted"]);
		expect(mockEvents).not.toContain("portal-mounted");

		act(() => {
			renderer.unmount();
		});
	});

	// #1358 【構造】詳細レイヤーは zIndex を積まず「最後の子」であることだけで最前面に載る。
	// この前提は兄弟に zIndex を持つ要素が居ないことに依存しており、実際 ScreenHeader は
	// zIndex:100 と不透明な白背景を持つ（= 兄弟に戻すとヘッダー帯だけレイヤーの上に残り、
	// X が押せず、戻るボタンだけ生きて「閉じてから遷移する」順序を迂回できてしまう）。
	// ヘッダーと本文を包むラッパー View を外すと、このテストが赤くなる。
	it("詳細レイヤーは最後の子で、兄弟に zIndex を持つ要素が居ない", () => {
		let renderer!: TestRenderer.ReactTestRenderer;
		act(() => {
			renderer = TestRenderer.create(<DishCategoryGroupVoteResultScreen shareToken="share-token-1" />);
		});

		press(renderer.root, `list-open-detail:${CANDIDATE.id}`);

		const tree = renderer.toJSON();
		const siblings = tree && !Array.isArray(tree) ? findInlineOverlaySiblings(tree) : null;
		// レイヤーが見つからない（testID が変わった等）まま緑にしない
		expect(siblings).not.toBeNull();

		const overlayIndex = (siblings ?? []).findIndex((sibling) => sibling.props?.testID === INLINE_OVERLAY_TEST_ID);
		expect(overlayIndex).toBe((siblings ?? []).length - 1);
		expect(describeSiblingsWithZIndex(siblings ?? [])).toEqual([]);

		act(() => {
			renderer.unmount();
		});
	});

	it("詳細モーダルから押すと、遷移より先にモーダルが閉じる", () => {
		let renderer!: TestRenderer.ReactTestRenderer;
		act(() => {
			renderer = TestRenderer.create(<DishCategoryGroupVoteResultScreen shareToken="share-token-1" />);
		});
		const root = renderer.root;

		// 詳細モーダルを開く（= 詳細レイヤーがマウントされる）
		press(root, `list-open-detail:${CANDIDATE.id}`);
		expect(mockEvents).toEqual(["overlay-mounted"]);

		// 詳細モーダル内の「店を見る」
		press(root, "primary-button:DishCategoryGroupVotes.viewRestaurants");

		// 遷移は 1 回だけ、かつ詳細レイヤーのアンマウント（= クローズ完了）より後
		expect(mockRouterPush).toHaveBeenCalledTimes(1);
		expect(mockEvents).toEqual(["overlay-mounted", "overlay-unmounted", "router.push"]);
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

	// #1122 【回帰】未検索候補では検索の await を挟むため、その間にモーダルを閉じられる。
	// 押下時点の stale closure（isCandidateDetailVisible === true）のまま遷移を ref へ積むと、
	// 次に別候補のモーダルを開いて閉じただけで、その残留分が発火して全く関係ない店へ飛ぶ。
	it("検索中にモーダルを閉じたら、その後に別候補のモーダルを開閉しても遷移が残留発火しない", async () => {
		const resolveSearch = deferSearch();
		let renderer!: TestRenderer.ReactTestRenderer;
		act(() => {
			renderer = TestRenderer.create(<DishCategoryGroupVoteResultScreen shareToken="share-token-1" />);
		});
		const root = renderer.root;

		// 候補 A（未検索）の詳細モーダルを開いて「店を見る」を押す → 検索の完了待ちに入る
		press(root, `list-open-detail:${NOT_SEARCHED_CANDIDATE.id}`);
		press(root, "primary-button:DishCategoryGroupVotes.viewRestaurants");
		expect(mockCreateDishItemsForCategory).toHaveBeenCalledTimes(1);
		expect(mockRouterPush).not.toHaveBeenCalled();

		// 検索完了前にユーザーが X でモーダルを閉じる
		pressModalCloseButton(root);
		expect(mockEvents).toEqual(["overlay-mounted", "overlay-unmounted"]);

		// 検索が完了する。ユーザーが自分で閉じた以上、勝手に遷移してはならない
		await resolveSearch([{ dish_media: { id: "dish-media-2" } }]);
		expect(mockRouterPush).not.toHaveBeenCalled();

		// 候補 B の詳細モーダルを開いて閉じるだけ。ここで A への遷移が発火したら不具合
		press(root, `list-open-detail:${CANDIDATE.id}`);
		pressModalCloseButton(root);

		expect(mockRouterPush).not.toHaveBeenCalled();
		expect(mockEvents).toEqual(["overlay-mounted", "overlay-unmounted", "overlay-mounted", "overlay-unmounted"]);

		act(() => {
			renderer.unmount();
		});
	});

	// #1122 【回帰】上のキャンセルを効かせすぎて、正常系（閉じずに待った場合）まで
	// 遷移が消えてしまわないことを固定する
	it("未検索候補でも、モーダルを開いたまま検索が終われば閉じてから遷移する", async () => {
		const resolveSearch = deferSearch();
		let renderer!: TestRenderer.ReactTestRenderer;
		act(() => {
			renderer = TestRenderer.create(<DishCategoryGroupVoteResultScreen shareToken="share-token-1" />);
		});
		const root = renderer.root;

		press(root, `list-open-detail:${NOT_SEARCHED_CANDIDATE.id}`);
		press(root, "primary-button:DishCategoryGroupVotes.viewRestaurants");
		await resolveSearch([{ dish_media: { id: "dish-media-2" } }]);

		expect(mockRouterPush).toHaveBeenCalledTimes(1);
		expect(mockEvents).toEqual(["overlay-mounted", "overlay-unmounted", "router.push"]);
		expect(mockRouterPush.mock.calls[0][0]).toMatchObject({
			pathname: "/[locale]/(tabs)/search/result",
			params: {
				entriesKey: `dish-category-group-votes:share-token-1:${NOT_SEARCHED_CANDIDATE.id}`,
				category: "カレー",
			},
		});

		act(() => {
			renderer.unmount();
		});
	});
});
