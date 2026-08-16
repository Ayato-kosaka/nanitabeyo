/*
#1359 【設計】ログイン導線 4 箇所が «同じルートへ、正しい `next` を付けて» push することを固定する。

## なぜ必要か
設計 §2 は「戻り先は履歴、`next` は履歴が無いときの保険（レビュー店詳細だけは «行き先»）」で、
その値は導線ごとに違う。ところがこの値を見ているのは Playwright / Detox だけで、しかも
地図・レビュー店詳細の 2 経路には E2E が無い。実際、PR2 のレビューでは
**4 箇所の `next` を全部別の値へ書き換えても 532 件すべて緑のまま**だった。

## 地図だけ「閉じてから push」まで見る理由
地図の店詳細は BlurModal（= react-native-paper の `<Portal>`）の中身で、`Portal.Host` は
`<Stack>` を包んでいる（app/[locale]/_layout.tsx）。つまり portal レイヤは常にナビゲータより «上»。
シートを開いたまま login ルートへ push すると、ログイン画面は portal の下に潜って見えず触れない。
Android のハードウェアバックも useBlurModal 側の BackHandler に食われ、#498 と同じ症状に見える。
順序を逆にすると赤くなるように、呼び出し «順» まで固定する（#1122 の回帰テストと同じ発想）。

## 方針
各導線の «押した先» だけを観測したいので、周辺（タブ・画像・API・下位コンポーネント）は
すべてスタブへ差し替える。ここで見るのは `router.push` の引数だけ。
testID とボタンの結線そのものは E2E（e2e-mobile / e2e-web）が見ている。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { QueryRestaurantsResponse } from "@shared/api/v1/res";
import type { RestaurantEntry } from "@/features/review/stores/useRestaurantStore";

const mockPush = jest.fn();
let mockUser: { id: string; is_anonymous?: boolean } | null = null;

let mockLocalParams: Record<string, string | undefined> = {};
// ⚠️ スタブ本体をファクトリの «外» に置かないこと。import 文はこのファイルの const 宣言より前へ
// 巻き上げられるため、ファクトリが走る時点では外の変数がまだ undefined で `router.push` が落ちる。
// 中身の参照（mockPush / mockLocalParams）は «呼び出し時» に解決されるので問題ない
// （loginScreenAuthGate.test.tsx と同じ注意）
jest.mock("expo-router", () => {
	const stub = {
		push: (href: unknown) => mockPush(href),
		replace: () => {},
		back: () => {},
		canGoBack: () => true,
	};
	return {
		router: stub,
		useRouter: () => stub,
		useLocalSearchParams: () => mockLocalParams,
		useGlobalSearchParams: () => ({}),
	};
});

jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({ user: mockUser, isAuthResolved: true }),
}));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }),
}));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: () => {} }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));

jest.mock("react-native-safe-area-context", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
		useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 800 }),
		SafeAreaView: ({ children }: { children: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
	};
});

// 描画判定に関係しない外部依存を素の host 要素へ落とす
jest.mock("expo-image", () => ({ Image: "Image" }));
jest.mock("lottie-react-native", () => "LottieView");
jest.mock("expo-linear-gradient", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		LinearGradient: ({ children }: { children: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
	};
});
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

// collapsible tabs は「ヘッダーを描く器」としてだけ必要。renderHeader を同期的に呼ぶ形へ潰す
// （導線ボタンは 3 箇所とも renderHeader の中に居る）
jest.mock("@/components/collapsible-tabs", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		Tabs: {
			Container: ({ renderHeader, children }: { renderHeader?: () => React.ReactNode; children?: React.ReactNode }) =>
				ReactActual.createElement(RNView, null, renderHeader?.(), children),
			Tab: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
			FlatList: () => null,
			ScrollView: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
		},
	};
});

// タブの中身は API を叩くだけでこのテストの関心外
jest.mock("@/features/map/components/tabs/RestaurantReviewsTab", () => ({ RestaurantReviewsTab: () => null }));
jest.mock("@/features/map/components/tabs/RestaurantBidsTab", () => ({ RestaurantBidsTab: () => null }));
jest.mock("@/features/map/components/ReviewForm", () => ({ ReviewForm: () => null }));
jest.mock("@/features/map/components/BidForm", () => ({ BidForm: () => null }));

/**
 * useBlurModal のスタブ。
 *
 * ⚠️ 地図の店詳細が «自前で» 開くモーダル（レビュー / 入札）用。`close` は呼び出し順の観測に使う。
 * 店詳細シート自身の close は map.tsx から render-prop で降ってくる別物なので、
 * こちらは混ぜないこと。
 */
const mockBlurModalOpen = jest.fn();
const mockBlurModalClose = jest.fn();
jest.mock("@/features/blurModal/hooks/useBlurModal", () => ({
	useBlurModal: () => ({
		BlurModal: () => null,
		open: () => mockBlurModalOpen(),
		close: () => mockBlurModalClose(),
		visible: false,
	}),
}));

// マイページ: 導線ボタンは ProfileHeader が描く。ここで見たいのは
// 「ProfileTabsLayout が onLogin に何を渡しているか」なので、ヘッダーは onLogin だけ露出する器へ潰す
// （testID とボタンの結線は e2e-mobile の profile-login-button が見ている）
jest.mock("@/features/profile/components/ProfileHeader", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		ProfileHeader: ({ onLogin }: { onLogin?: () => void }) =>
			ReactActual.createElement(RNView, { testID: "profile-login-button", onPress: onLogin }),
	};
});
jest.mock("@/features/profile/components/ProfileTabsBar", () => ({ ProfileTabsBar: () => null }));
jest.mock("@/features/profile/tabs/ReviewTab", () => ({ ReviewTab: () => null }));
jest.mock("@/features/profile/tabs/LikeTab", () => ({ LikeTab: () => null }));
jest.mock("@/features/profile/tabs/SavedPostsTab", () => ({ SavedPostsTab: () => null }));
jest.mock("@/features/profile/tabs/SavedTopicsTab", () => ({ SavedTopicsTab: () => null }));
jest.mock("@/features/profile/components/ProfileEditForm", () => ({ ProfileEditForm: () => null }));
jest.mock("@/features/profile/hooks/useEnsureOwnProfileLoaded", () => ({ useEnsureOwnProfileLoaded: () => {} }));
jest.mock("@/features/profile/stores/useProfileStore", () => ({
	useProfileStore: (selector: (state: { profile: unknown }) => unknown) =>
		selector({ profile: { id: "profile-1", username: "tester" } }),
}));

import { SelectedRestaurantDetails as MapRestaurantDetails } from "@/features/map/components/SelectedRestaurantDetails";
import { SelectedRestaurantDetails as ReviewRestaurantDetails } from "@/features/review/components/SelectedRestaurantDetails";
import ReviewScreen from "../app/[locale]/(tabs)/review/index";
import { ProfileTabsLayout } from "@/features/profile/containers/ProfileTabsLayout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GUEST = { id: "guest-1", is_anonymous: true };
const MEMBER = { id: "user-1", is_anonymous: false };

const RESTAURANT_ID = "restaurant-42";
// 店詳細 2 種は同じ形（restaurant + meta）を受け取る。描画に必要な最小限だけ埋め、
// 型は «押した先» の検証に関係しないのでキャストで通す
const restaurantEntry = {
	restaurant: { id: RESTAURANT_ID, name: "テスト食堂", imageUrls: undefined, google_place_id: "place-1" },
	meta: { averageRating: 4.2, reviewCount: 12, totalCents: 0, maxEndDate: null },
};
const mapRestaurantEntry = restaurantEntry as unknown as QueryRestaurantsResponse[number];
const reviewRestaurantEntry = restaurantEntry as unknown as RestaurantEntry;

// ⚠️ 描画したツリーは必ず unmount すること。ProfileTabsLayout は ?tab= 指定があると
// jumpToTab のリトライ（setInterval / #1272）を回し、その cleanup は unmount でしか走らない。
// 放置するとテスト終了後に setState が走り、環境の破棄と競って別のテストが謎の失敗をする
const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
const render = async (element: React.ReactElement) => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(element);
	});
	mountedTrees.push(tree);
	return tree;
};

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

/** 指定 testID の要素を押す */
const press = async (tree: TestRenderer.ReactTestRenderer, testID: string): Promise<void> => {
	const target = tree.root.find((node) => node.props?.testID === testID);
	await act(async () => {
		await target.props.onPress();
	});
};

beforeEach(() => {
	mockPush.mockClear();
	mockBlurModalOpen.mockClear();
	mockBlurModalClose.mockClear();
	mockUser = GUEST;
	mockLocalParams = {};
});

describe("#1359 ログイン導線 4 箇所の push 先と next", () => {
	it("マイページ: next はマイページ", async () => {
		const tree = await render(<ProfileTabsLayout />);

		await press(tree, "profile-login-button");

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/auth/login",
			params: { locale: "ja-JP", next: "/ja-JP/profile" },
		});
	});

	// #954 の `?tab=` で来ていれば、そのタブまで next に載る（履歴が無い着地でも選択タブを再現する）
	it("マイページ: ?tab= 付きで来ていれば next にもタブが載る", async () => {
		mockLocalParams = { tab: "liked" };

		const tree = await render(<ProfileTabsLayout />);

		await press(tree, "profile-login-button");

		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/auth/login",
			params: { locale: "ja-JP", next: "/ja-JP/profile?tab=liked" },
		});
	});

	it("レビュータブ: next はレビュータブ自身（この画面は URL だけで再現できる）", async () => {
		const tree = await render(<ReviewScreen />);

		await press(tree, "review-guest-login-button");

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/auth/login",
			params: { locale: "ja-JP", next: "/ja-JP/review" },
		});
	});

	it("レビュー店詳細: next は «戻り先» ではなく投稿フォームという «行き先»", async () => {
		const tree = await render(<ReviewRestaurantDetails restaurantEntry={reviewRestaurantEntry} />);

		await press(tree, "restaurant-detail-post-photo-button");

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/auth/login",
			params: { locale: "ja-JP", next: `/ja-JP/review/restaurant/${RESTAURANT_ID}/review` },
		});
	});

	it("地図の店詳細: next は地図タブ（選択中の店は URL に無いのでここが限界）", async () => {
		const tree = await render(<MapRestaurantDetails {...mapRestaurantEntry} onRequestClose={jest.fn()} />);

		await press(tree, "map-restaurant-post-review-button");

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/auth/login",
			params: { locale: "ja-JP", next: "/ja-JP/map" },
		});
	});

	// 4 箇所とも isGuestUser ゲートの内側にあること。ログイン済みで押しても login へは飛ばさない
	it("ログイン済みならどの導線もログイン画面へは push しない", async () => {
		mockUser = MEMBER;

		const reviewTree = await render(<ReviewScreen />);
		await press(reviewTree, "review-post-button");

		const mapTree = await render(<MapRestaurantDetails {...mapRestaurantEntry} onRequestClose={jest.fn()} />);
		await press(mapTree, "map-restaurant-post-review-button");

		const pushedToLogin = mockPush.mock.calls.filter(
			([href]) => (href as { pathname?: string })?.pathname === "/[locale]/auth/login",
		);
		expect(pushedToLogin).toHaveLength(0);
	});
});

describe("#1359 地図の店詳細は «閉じてから» ログイン画面へ push する", () => {
	// ⚠️ この順序が逆になると、ログイン画面が BlurModal の portal の下に潜って «見えず触れない»。
	// 症状としては #498（OAuth 成功後もログイン UI が残る）と見分けが付かない
	it("onRequestClose が push より先に呼ばれる", async () => {
		const order: string[] = [];
		const onRequestClose = jest.fn(() => {
			order.push("close");
		});
		mockPush.mockImplementation(() => {
			order.push("push");
		});

		const tree = await render(<MapRestaurantDetails {...mapRestaurantEntry} onRequestClose={onRequestClose} />);
		await press(tree, "map-restaurant-post-review-button");

		expect(onRequestClose).toHaveBeenCalledTimes(1);
		expect(order).toEqual(["close", "push"]);
	});

	it("ログイン済み（＝シートの中でレビューフォームを開く）ときは閉じない", async () => {
		mockUser = MEMBER;
		const onRequestClose = jest.fn();

		const tree = await render(<MapRestaurantDetails {...mapRestaurantEntry} onRequestClose={onRequestClose} />);
		await press(tree, "map-restaurant-post-review-button");

		expect(onRequestClose).not.toHaveBeenCalled();
		// シートは開いたまま、その中でレビューフォームの BlurModal を開く
		expect(mockBlurModalOpen).toHaveBeenCalled();
	});
});
