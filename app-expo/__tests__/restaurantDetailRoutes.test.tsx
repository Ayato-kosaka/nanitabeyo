/*
#1388 【設計】店詳細ルートが «どこへ» push するかを固定する。

## なぜ必要か
#1386 で地図側とレビュー側の 2 実装を 1 つへ統合したとき、行き先が 3 本になった
（レビュー投稿 / 入札 / フィード）。ところが #1388 のレビューで、
**bid と feed の `pathname` を入れ替えても 648 件すべて緑のまま**であることが実測された。
「入札するを押すとフィードが開き、料理を押すと入札画面が開く」状態を誰も見ていない。

**グリッド押下 → フィード**は web / mobile とも直リンク着地でしか触っておらず、
`initialIndex` を渡す経路は完全に無防備だった。ここは #1386 で唯一 «意味が変わった» 導線
（旧レビュー側はグリッド押下で `review-from-media` へ直行していた）なので、
変わった先をユニットで固定する。

#1411 で入札の導線は削除した（下の «入札の導線を描かない» を参照）ので、
残る行き先はレビュー投稿とフィードの 2 本である。

ログイン導線（ゲストの `next`）は `__tests__/loginEntryPoints.test.tsx` が持っているので、
このファイルは非ゲストに絞る。

## 方針
`router.push` の引数だけを観測する。周辺（タブの中身・画像・API）はすべてスタブへ落とし、
`RestaurantReviewsTab` だけは «押せる何か» として `onItemPress` を testID 付きで露出する。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import type { RestaurantEntry } from "@/stores/useRestaurantStore";

const mockPush = jest.fn();

// ⚠️ スタブ本体をファクトリの «外» に置かないこと（loginEntryPoints.test.tsx と同じ注意）
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
		useLocalSearchParams: () => ({ restaurantId: "restaurant-42" }),
		useGlobalSearchParams: () => ({}),
	};
});

jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({ user: { id: "user-1", is_anonymous: false }, isAuthResolved: true }),
}));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
// ⚠️ スタブが «毎レンダー新しい関数» を返さないようにすること。
// 店詳細ルートの取得 effect は [restaurantId, callBackend, showSnackbar, logFrontendEvent] を
// 依存に持つので、ここで jest.fn() を呼び直すと effect → setState → effect の無限ループになる
// （実装は正しい。SnackbarProvider は useMemo、useLogger / useAPICall は useCallback で安定している）。
// 実際この形で書いてテストがタイムアウトした
jest.mock("@/hooks/useHaptics", () => {
	const lightImpact = jest.fn();
	const mediumImpact = jest.fn();
	return { useHaptics: () => ({ lightImpact, mediumImpact }) };
});
jest.mock("@/hooks/useLogger", () => {
	const logFrontendEvent = jest.fn();
	return { useLogger: () => ({ logFrontendEvent }) };
});
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: () => {} }));
jest.mock("@/contexts/SnackbarProvider", () => {
	const showSnackbar = jest.fn();
	return { useSnackbar: () => ({ showSnackbar }) };
});

jest.mock("react-native-safe-area-context", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
		useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 800 }),
		SafeAreaView: ({ children }: { children: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
	};
});

jest.mock("expo-image", () => ({ Image: "Image" }));
jest.mock("expo-linear-gradient", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		LinearGradient: ({ children }: { children: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
	};
});
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

// collapsible tabs は「ヘッダーと中身を描く器」としてだけ必要
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

// レビュータブは API を叩くだけなので中身は要らない。ただし «グリッドを押す» 経路を観測したいので
// onItemPress だけを押せる形で露出する（index と dishMediaId をそのまま流す）
jest.mock("@/features/map/components/tabs/RestaurantReviewsTab", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		RestaurantReviewsTab: ({ onItemPress }: { onItemPress: (index: number, dishMediaId: string) => void }) =>
			ReactActual.createElement(RNView, {
				testID: "reviews-tab-item",
				onPress: () => onItemPress(3, "dish-media-7"),
			}),
	};
});

// ルート本体の検証で使う。API の応答をテストごとに差し替える
const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
// #1629 «Google マップで開く» が外部へ出る処理を持つ。押下先だけ見たいので口を塞ぐ
jest.mock("@/lib/googlePlaces", () => ({
	getGoogleMapsLink: jest.fn(async () => ({ mapUrl: "https://maps.google.com/?q=test", canOpen: true })),
}));
jest.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: jest.fn(async () => {}) }));

import RestaurantDetailScreen from "../app/[locale]/restaurant/[restaurantId]";
import { useRestaurantStore } from "@/stores/useRestaurantStore";
import { SelectedRestaurantDetails } from "@/features/restaurant/components/SelectedRestaurantDetails";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RESTAURANT_ID = "restaurant-42";
// 描画に必要な最小限だけ埋める。型は «押した先» の検証に関係しないのでキャストで通す
const restaurantEntry = {
	restaurant: { id: RESTAURANT_ID, name: "テスト食堂", imageUrls: undefined, google_place_id: "place-1" },
	meta: { averageRating: 4.2, reviewCount: 12, totalCents: 0, maxEndDate: null },
} as unknown as RestaurantEntry;

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
	mockCallBackend.mockReset();
	// ⚠️ 必ず clear() を使うこと。ルートは取得成功時にストアへ upsert するので、
	// 消し忘れると次のテストがキャッシュ経由で «成功分岐» に入り、loading / error を
	// 一度も踏まないまま緑になる（実際この形で書いて、ミューテーションが素通りした）
	useRestaurantStore.getState().clear();
});

describe("#1388 店詳細ルートの push 先", () => {
	/*
	#1411 【バグ】入札の導線は公開アプリに出してはいけない。

	#1386 の統合で map 側から持ち込んだが、map タブは `href: null` で到達不能だったため
	入札は事実上出ていなかった。統合先のレビュー側は到達可能なので «復活» させてしまっていた。
	決済は未実装（bid.tsx の送信は 2 秒待つダミー）。

	⚠️ ここが赤くなったら入札ボタンが復活している。リリースブランチには出せない。
	*/
	it("入札の導線を描かない（決済が未実装のため出してはいけない）", async () => {
		const tree = await render(<SelectedRestaurantDetails restaurantEntry={restaurantEntry} />);

		expect(tree.root.findAll((node) => node.props?.testID === "restaurant-detail-place-bid-button")).toHaveLength(0);
	});

	/*
	#1629【オーナー確定】**グリッド押下は «その投稿を見る»（feed）へ入る。**

	#1418 はここを `review-from-media`（= レビューを書く画面）への直行にしていた。
	当時この画面は «レビュー投稿導線» だったので筋が通っていたが、いまは «店舗詳細» で、
	投稿一覧を押した人が求めているのは «その投稿を見ること» である
	（オーナー実機報告「お店の詳細押すとレビューするフローになる」）。

	#1418 が心配していた «ゲストが文字だけのレビューへ到達できない» は、
	フィードの中の «この料理にレビューを書く» が `!isGuestUser(user)` で出し分けている件で、
	これはゲストのログイン導線（#1359）の問題である。この画面の押下先で解くものではない。

	⚠️ 開始位置は index で渡すこと。渡さないと、どれを押しても 1 件目が開く。
	*/
	it("投稿グリッドの押下は feed ルートへ、押した位置つきで push する", async () => {
		const tree = await render(<SelectedRestaurantDetails restaurantEntry={restaurantEntry} />);

		await press(tree, "reviews-tab-item");

		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/restaurant/[restaurantId]/feed",
			// スタブは 3 番目を押したことにしている。ここが "0" に化けたら index を渡し忘れている
			params: { locale: "ja-JP", restaurantId: RESTAURANT_ID, initialIndex: "3" },
		});
	});

	/*
	#1629【オーナー確定】**「写真・動画を投稿」はこの画面から外した。**

	投稿は «食べたを記録» のフロー（my-dishes → 記録 → お店を選ぶ）に 1 本化されている。
	店舗詳細にも同じことを始めるボタンがあったため、画面に出ているものが
	«店の情報 0 件 / レビューを書く導線 2 件» になっていた。

	⚠️ ここが赤くなったら投稿ボタンが復活している。
	*/
	it("「写真・動画を投稿」を描かない（投稿は記録フローへ 1 本化した）", async () => {
		const tree = await render(<SelectedRestaurantDetails restaurantEntry={restaurantEntry} />);

		expect(tree.root.findAll((node) => node.props?.testID === "restaurant-detail-post-photo-button")).toHaveLength(0);
	});

	/*
	#1629【オーナー確定】代わりに «Google マップで開く» を戻した。
	#1411 が入札の撤去と一緒に消したが、これは店の情報（場所・営業時間・電話）へ辿り着く
	導線であって入札とは無関係である。
	*/
	it("「Google マップで開く」を描く", async () => {
		const tree = await render(<SelectedRestaurantDetails restaurantEntry={restaurantEntry} />);

		expect(
			tree.root.findAll((node) => node.props?.testID === "restaurant-detail-google-maps-button"),
		).not.toHaveLength(0);
	});
});

/*
#1388 レビュー必須 1。

ヘッダーは «データの分岐の外» に 1 つだけ置く。分岐ごとに書くと、戻る導線と観測点が
取得結果に依存してしまう。実際 #1388 では loading / error 分岐にだけ testID が無く、
e2e-mobile の「存在しない id で直リンクして器を見る」戦略（Detox に API モックが無いので
そうするしかない。e2e-mobile/screens/RestaurantDetailScreen.ts 参照）が成立していなかった。

⚠️ ここが赤くなったら、404 やロード中に «戻れない / どの画面か分からない» 状態が復活している。
*/
describe("#1388 店詳細ルートのヘッダーは取得結果に依存しない", () => {
	/**
	 * `${testID}-title` と戻るボタンが «どの分岐でも» ちょうど 1 つ描かれていること。
	 *
	 * `deep: false` は「一致したノードの中はもう探さない」の意。react-test-renderer は
	 * 合成コンポーネントと host の両方を辿るので、これを付けないと同じ 1 個の Text が 2 件に見える
	 */
	const expectHeader = (tree: TestRenderer.ReactTestRenderer) => {
		expect(
			tree.root.findAll((node) => node.props?.testID === "restaurant-detail-screen-title", { deep: false }),
		).toHaveLength(1);
		expect(
			tree.root.findAll((node) => node.props?.testID === "restaurant-detail-screen-back", { deep: false }),
		).toHaveLength(1);
	};

	it("取得に成功したとき", async () => {
		mockCallBackend.mockResolvedValue({ restaurant: restaurantEntry.restaurant, meta: restaurantEntry.meta });

		expectHeader(await render(<RestaurantDetailScreen />));
	});

	// 存在しない id での直リンク着地。e2e-mobile が実際に踏む経路
	it("取得に失敗したとき（404 直リンク）", async () => {
		mockCallBackend.mockRejectedValue(new Error("not found"));

		expectHeader(await render(<RestaurantDetailScreen />));
	});

	it("取得中のとき", async () => {
		// 解決しない Promise を返してローディング分岐に留める
		mockCallBackend.mockReturnValue(new Promise(() => {}));

		expectHeader(await render(<RestaurantDetailScreen />));
	});
});
