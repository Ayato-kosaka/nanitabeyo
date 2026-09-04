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
`/[locale]/restaurant/[restaurantId]` ルート 1 本へ統合）、
ログイン導線も店詳細 1 箇所に減ったため、順序の固定は «この画面は portal を持たない» という
不変条件へ置き換えた（下の describe）。

#1419 で地図タブごと削除したので、地図側の push を見ていた
`__tests__/mapRestaurantRoute.test.tsx` も消えている。

## 方針
各導線の «押した先» だけを観測したいので、周辺（タブ・画像・API・下位コンポーネント）は
すべてスタブへ差し替える。ここで見るのは `router.push` の引数だけ。
testID とボタンの結線そのものは E2E（e2e-mobile / e2e-web）が見ている。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { RestaurantEntry } from "@/stores/useRestaurantStore";

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
// #1375（5 巡目・性能）画面はタブのフォーカスを見て «見えているビューだけ取得する»。
// ナビゲータの外で画面を描くテストなので、フォーカスは «前面» 固定でよい
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }),
}));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
// #1375（5 巡目）チュートリアルは **必ずスタブ化する**。
// 実体は Modal + 無限ループのアニメーション + 座標の測り直しを持つので、
// マウントすると jest がアイドルにならず OOM で落ちる（実際に落ちた）。
// 料理提案画面のテスト（groupVoteShareTokenGuard.test.tsx）が
// TopicsSpotlightTutorial をスタブ化しているのと同じ理由。
jest.mock("@/features/myDishes/components/MyDishesSpotlightTutorial", () => ({
	MY_DISHES_TUTORIAL_STORAGE_KEY: "my_dishes_spotlight_tutorial_seen_v1",
	MyDishesSpotlightTutorial: () => null,
}));
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: () => {} }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
// #1402 マイページ本体がログアウトの確認ダイアログを持つようになった（旧設定画面から移動）。
// このテストで見たいのは «押した先» だけなので、プロバイダごと潰す
jest.mock("@/contexts/DialogProvider", () => ({
	useDialog: () => ({ showDialog: jest.fn(), confirm: jest.fn().mockResolvedValue(false) }),
}));

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
// #1629 店詳細のボタンは «Google マップで開く» になった。外へ出る処理は口だけ塞ぐ
jest.mock("@/lib/googlePlaces", () => ({
	getGoogleMapsLink: jest.fn(async () => ({ mapUrl: "https://maps.google.com/?q=test", canOpen: true })),
}));
jest.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: jest.fn(async () => {}) }));
// #843 «Google マップで開く» はアプリ内地図モーダルを開くようになった。Provider 抜きで
// SelectedRestaurantDetails を描くため、フックだけ差し替える
// （MapsEmbedModal 自体は Provider 側でしか描かれないので、この画面の Portal 不変条件には影響しない）
jest.mock("@/features/maps/hooks/useMapsEmbedModal", () => ({
	useMapsEmbedModal: () => ({ showMapsEmbedModal: jest.fn() }),
}));

/**
 * `<Portal>` のスタブ。
 *
 * ⚠️ 描かれたこと «自体» が検証対象。#1350 P6 で `features/blurModal` を撤去したので、
 * この検査は «消えたモジュール名» ではなく BlurModal が使っていた **機構そのもの**
 * （react-native-paper の `<Portal>`）を見る。
 *
 * ⚠️ ここが守るのは «**開いた** オーバーレイを持たないこと» だけである（#1389 のレビューで実測）。
 * `{visible && <Portal>…}` のように閉じたまま置かれた Portal は描かれないので記録されない。
 * «そもそも Portal を import しないこと» は静的検査
 * （`scripts/assert-legacy-blur-modal-boundary.mjs` の許可リスト）が受け持つ。2 つで 1 組。
 */
const mockPortal = jest.fn();
jest.mock("react-native-paper", () => ({
	// Portal 以外は本物のまま通す。テーマ（constants/PaperTheme.ts の MD3DarkTheme）など、
	// この画面が «今は» 使っていないだけの export を undefined にすると、将来 useThemeColor を
	// 1 つ足しただけで «Portal と無関係な» TypeError で落ちるため
	...jest.requireActual("react-native-paper"),
	// children を返すのは #1358 の先例（DishCategoryGroupVoteResultScreen.test.tsx）に揃えたもの。
	// null を返すと、将来 Portal の中身へアサーションを置いたときに «赤くならずに要素が消える» 側へ倒れる
	Portal: ({ children }: { children?: unknown }) => {
		mockPortal();
		return children ?? null;
	},
}));

// マイページ: 導線ボタンは ProfileHeader が描く。ここで見たいのは
// 「マイページ画面が onLogin に何を渡しているか」なので、ヘッダーは onLogin だけ露出する器へ潰す
// （testID とボタンの結線は e2e-mobile の profile-login-button が見ている）
// #1402 マイページは ProfileTabsLayout（4 グリッドタブ）ではなくルート本体になった
jest.mock("@/features/profile/components/ProfileHeader", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		ProfileHeader: ({ onLogin }: { onLogin?: () => void }) =>
			ReactActual.createElement(RNView, { testID: "profile-login-button", onPress: onLogin }),
	};
});
jest.mock("@/features/profile/components/ProfileEditForm", () => ({ ProfileEditForm: () => null }));
jest.mock("@/features/profile/hooks/useEnsureOwnProfileLoaded", () => ({ useEnsureOwnProfileLoaded: () => {} }));
jest.mock("@/features/profile/stores/useProfileStore", () => ({
	useProfileStore: (selector: (state: { profile: unknown }) => unknown) =>
		selector({ profile: { id: "profile-1", username: "tester" } }),
}));

import { SelectedRestaurantDetails as ReviewRestaurantDetails } from "@/features/restaurant/components/SelectedRestaurantDetails";
import MyDishesScreen from "../app/[locale]/(tabs)/my-dishes/index";
import ProfileScreen from "../app/[locale]/(tabs)/profile/index";

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

// ⚠️ 描画したツリーは必ず unmount すること。放置するとテスト終了後に setState が走り、
// 環境の破棄と競って別のテストが謎の失敗をする
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
		const tree = await render(<ProfileScreen />);

		await press(tree, "profile-login-button");

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/auth/login",
			params: { locale: "ja-JP", next: "/ja-JP/profile" },
		});
	});

	// #1402 【設計】旧実装は `?tab=` で来ていればその «選択タブ» を next に載せていた
	// （履歴が無い着地でも選択タブを再現するため）。4 グリッドタブごと廃止されて
	// マイページは URL だけで完全に再現できる画面になったので、next は常にマイページ 1 本になる。
	// タブ指定つきの直リンクで来ても next を汚さないことを固定しておく
	it("マイページ: 旧仕様の ?tab= 付きで来ても next にタブは載らない", async () => {
		mockLocalParams = { tab: "liked" };

		const tree = await render(<ProfileScreen />);

		await press(tree, "profile-login-button");

		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/auth/login",
			params: { locale: "ja-JP", next: "/ja-JP/profile" },
		});
	});

	it("食べたい/食べたタブ: next はこのタブ自身（この画面は URL だけで再現できる）", async () => {
		const tree = await render(<MyDishesScreen />);

		await press(tree, "my-dishes-guest-login-button");

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/auth/login",
			params: { locale: "ja-JP", next: "/ja-JP/my-dishes" },
		});
	});

	/*
	#1629【オーナー確定】**店詳細からログイン導線は無くなった。**

	この画面にあった «写真・動画を投稿»（ゲストならログインへ送る）を外し、
	«Google マップで開く» に差し替えたため。投稿はすべて «食べたを記録» のフローを通り、
	そちらのログイン導線（`my-dishes-record-button`）が上のテストで守られている。

	ここで守るのは逆向きの性質になる: **ゲストでも、店詳細では何もログインを求められない。**
	店の場所を見るだけの操作でログインを要求するのは、この画面では過剰である。
	*/
	it("店詳細: ゲストでもログイン画面へ送らない（Google マップは誰でも開ける）", async () => {
		const tree = await render(<ReviewRestaurantDetails restaurantEntry={reviewRestaurantEntry} />);

		await press(tree, "restaurant-detail-google-maps-button");

		const pushedToLogin = mockPush.mock.calls.filter(
			([href]) => (href as { pathname?: string })?.pathname === "/[locale]/auth/login",
		);
		expect(pushedToLogin).toHaveLength(0);
	});

	// ログイン済みで押しても login へは飛ばさない（isGuestUser ゲートの内側にあること）
	it("ログイン済みならどの導線もログイン画面へは push しない", async () => {
		mockUser = MEMBER;

		const myDishesTree = await render(<MyDishesScreen />);
		await press(myDishesTree, "my-dishes-record-button");

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
		await press(tree, "restaurant-detail-google-maps-button");

		expect(mockPortal).not.toHaveBeenCalled();
	});

	it("食べたい/食べたタブは Portal を 1 つも描かない", async () => {
		const tree = await render(<MyDishesScreen />);
		await press(tree, "my-dishes-guest-login-button");

		expect(mockPortal).not.toHaveBeenCalled();
	});

	it("マイページは Portal を 1 つも描かない", async () => {
		const tree = await render(<ProfileScreen />);
		await press(tree, "profile-login-button");

		expect(mockPortal).not.toHaveBeenCalled();
	});
});
