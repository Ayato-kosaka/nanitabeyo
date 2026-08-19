/*
#1359 【設計】ログイン導線 4 箇所が «同じルートへ、正しい `next` を付けて» push することを固定する。

## なぜ必要か
設計 §2 は「戻り先は履歴、`next` は履歴が無いときの保険（レビュー店詳細だけは «行き先»）」で、
その値は導線ごとに違う。ところがこの値を見ているのは Playwright / Detox だけで、しかも
地図・レビュー店詳細の 2 経路には E2E が無い。実際、PR2 のレビューでは
**4 箇所の `next` を全部別の値へ書き換えても 532 件すべて緑のまま**だった。

## #1386 で「地図の店詳細」が消えた
以前はここに «地図の店詳細（BlurModal の中身）は close してから push する» という順序の固定があった。
#1386 で地図の店詳細シートそのものが無くなり（店詳細は
`/[locale]/(tabs)/review/restaurant/[restaurantId]` ルート 1 本へ統合）、
ログイン導線も店詳細 1 箇所に減ったため、順序の固定は «この画面は portal を持たない» という
不変条件へ置き換えた（下の describe）。地図がその店詳細ルートへ push すること自体は
`__tests__/mapRestaurantRoute.test.tsx` が見ている。

## 方針
各導線の «押した先» だけを観測したいので、周辺（タブ・画像・API・下位コンポーネント）は
すべてスタブへ差し替える。ここで見るのは `router.push` の引数だけ。
testID とボタンの結線そのものは E2E（e2e-mobile / e2e-web）が見ている。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
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
 * `<Portal>` のスタブ。
 *
 * ⚠️ 描かれたこと «自体» が検証対象。#1350 P6 で `features/blurModal` を撤去したので、
 * この検査は «消えたモジュール名» ではなく BlurModal が使っていた **機構そのもの**
 * （react-native-paper の `<Portal>`）を見る。直に `<Portal>` を書いても、凍結コピーの
 * `useLegacyBlurModal` を持ち込んでも、同じようにここが赤くなる。
 */
const mockPortal = jest.fn();
jest.mock("react-native-paper", () => ({
	Portal: () => {
		mockPortal();
		return null;
	},
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

import { SelectedRestaurantDetails as ReviewRestaurantDetails } from "@/features/review/components/SelectedRestaurantDetails";
import ReviewScreen from "../app/[locale]/(tabs)/review/index";
import { ProfileTabsLayout } from "@/features/profile/containers/ProfileTabsLayout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GUEST = { id: "guest-1", is_anonymous: true };
const MEMBER = { id: "user-1", is_anonymous: false };

const RESTAURANT_ID = "restaurant-42";
// #1386 店詳細は 1 実装になった（restaurant + meta を受け取る）。描画に必要な最小限だけ埋め、
// 型は «押した先» の検証に関係しないのでキャストで通す
const restaurantEntry = {
	restaurant: { id: RESTAURANT_ID, name: "テスト食堂", imageUrls: undefined, google_place_id: "place-1" },
	meta: { averageRating: 4.2, reviewCount: 12, totalCents: 0, maxEndDate: null },
};
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
	mockPortal.mockClear();
	mockUser = GUEST;
	mockLocalParams = {};
});

describe("#1359 ログイン導線の push 先と next（#1386 で 4 箇所 → 3 箇所）", () => {
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

	it("店詳細: next は «戻り先» ではなく投稿フォームという «行き先»", async () => {
		const tree = await render(<ReviewRestaurantDetails restaurantEntry={reviewRestaurantEntry} />);

		await press(tree, "restaurant-detail-post-photo-button");

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/auth/login",
			params: { locale: "ja-JP", next: `/ja-JP/review/restaurant/${RESTAURANT_ID}/review` },
		});
	});

	// #1386 地図から来た場合もこの店詳細を通るので、地図専用の `next`（旧: /ja-JP/map）は無くなった。
	// 店が URL に載っている以上、投稿フォームまで戻せるこちらの方が忠実に復帰できる

	// 3 箇所とも isGuestUser ゲートの内側にあること。ログイン済みで押しても login へは飛ばさない
	it("ログイン済みならどの導線もログイン画面へは push しない", async () => {
		mockUser = MEMBER;

		const reviewTree = await render(<ReviewScreen />);
		await press(reviewTree, "review-post-button");

		const detailTree = await render(<ReviewRestaurantDetails restaurantEntry={reviewRestaurantEntry} />);
		await press(detailTree, "restaurant-detail-post-photo-button");

		const pushedToLogin = mockPush.mock.calls.filter(
			([href]) => (href as { pathname?: string })?.pathname === "/[locale]/auth/login",
		);
		expect(pushedToLogin).toHaveLength(0);
	});
});

describe("#1386 ログイン導線を持つ画面は portal を 1 つも持たない", () => {
	/*
	⚠️ これが赤くなったら «閉じてから push» が必要になったということ。
	BlurModal は react-native-paper の `<Portal>` に全画面レイヤを描き、`Portal.Host` は
	`<Stack>` を包んでいる（app/[locale]/_layout.tsx）ので、開いたまま push すると
	ログイン画面は portal の下に潜って見えず触れない（#1364 で実測）。Android の戻るキーも
	オーバーレイ側の BackHandler に食われ、#498 と見分けが付かない症状になる。
	#1386 より前は地図の店詳細がまさにこれで、`onRequestClose()` を push より先に呼ぶ順序を
	ここで固定していた。シートごと無くなったので、守るべきは «そもそも portal を持たない» ことになった。
	*/
	it("店詳細は Portal を 1 つも描かない", async () => {
		const tree = await render(<ReviewRestaurantDetails restaurantEntry={reviewRestaurantEntry} />);
		await press(tree, "restaurant-detail-post-photo-button");

		expect(mockPortal).not.toHaveBeenCalled();
	});

	it("レビュータブは Portal を 1 つも描かない", async () => {
		const tree = await render(<ReviewScreen />);
		await press(tree, "review-guest-login-button");

		expect(mockPortal).not.toHaveBeenCalled();
	});

	it("マイページは Portal を 1 つも描かない", async () => {
		const tree = await render(<ProfileTabsLayout />);
		await press(tree, "profile-login-button");

		expect(mockPortal).not.toHaveBeenCalled();
	});
});
