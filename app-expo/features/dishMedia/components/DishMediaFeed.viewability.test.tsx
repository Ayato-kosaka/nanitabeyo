/*
#1641 オーナー実機報告（2026-08-30）:

> フィードを上下すると、TikTok / YouTube が起動しないときがある。
> 逆に先読みで、下のフィードの音が聞こえてしまったりする。

## 何が起きていたか

`pagingEnabled` + `decelerationRate="fast"` で勢いよく送ると、**通り過ぎるだけのセルも
一瞬 90% 可視になり** viewability が鳴る。そのたびに `currentIndex` が動くので、

1. 着地していないセルの `ExternalEmbedPlayer` が `isActive` でマウントし、WebView が
   読み込みを始めて **鳴り出す**（＝「下のフィードの音」）
2. 1 回のフリックで WebView が何枚も生まれては捨てられ、着地したセルの読み込みが
   そのぶん遅れる・競合する（＝「起動しないときがある」）

## ここで固定すること

`minimumViewTime` があること。**«その位置に留まったか» を待つ RN 公式の口**であり、
これが無い限り «通過しただけのセルが鳴る» は必ず戻る。閾値（90%）だけを見ていると、
片方を直したつもりでもう片方が残る。
*/
import { act } from "react";
import TestRenderer from "react-test-renderer";

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

jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ selectionChanged: jest.fn(), lightImpact: jest.fn() }),
}));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

jest.mock("@/features/dishMedia/hooks/useDishMediaBackgroundImageResources", () => ({
	useDishMediaBackgroundImageResources: () => ({
		imageStates: {},
		resetImageStates: jest.fn(),
		getBackgroundImageState: () => ({ status: "ready", image: {} }),
	}),
}));

/** DishMediaContent は動画プレイヤー等を抱えるので、props だけを持つ薄い代役に置く */
jest.mock("./DishMediaContent", () => ({
	__esModule: true,
	default: function MockDishMediaContent() {
		return null;
	},
}));

import DishMediaFeed from "./DishMediaFeed";
import { useDishMediaEntriesStore, type NormalizedDishMediaEntry } from "@/stores/useDishMediaEntriesStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRIES_KEY = "viewability-feed";
const IDS = ["dm-1", "dm-2", "dm-3"];

const entry = (id: string): NormalizedDishMediaEntry =>
	({
		dish_media: { id, isMine: true, media_type: "image" },
		restaurant: { id: `restaurant-${id}`, name: "テスト店" },
		dish: { id: `dish-${id}` },
		dishReviewIds: [],
	}) as unknown as NormalizedDishMediaEntry;

describe("#1641 フィードの可視判定", () => {
	let renderer: TestRenderer.ReactTestRenderer | undefined;

	beforeEach(() => {
		useDishMediaEntriesStore.setState({
			entriesByMediaId: Object.fromEntries(IDS.map((id) => [id, entry(id)])),
			mediaIdsByKey: { [ENTRIES_KEY]: IDS },
			reviewsByReviewId: {},
			reviewIdsByKey: {},
			deletedIds: {},
		});
	});

	afterEach(() => {
		act(() => renderer?.unmount());
		renderer = undefined;
	});

	it("通り過ぎただけのセルを «表示中» にしない（minimumViewTime がある）", () => {
		act(() => {
			renderer = TestRenderer.create(<DishMediaFeed entriesKey={ENTRIES_KEY} idType="dish_media" />);
		});
		const target = renderer!;
		// onLayout を発火させないと pageLength > 0 にならず FlatList が描かれない
		act(() => {
			target.root.findByProps({ testID: "dish-media-feed-root" }).props.onLayout({
				nativeEvent: { layout: { width: 390, height: 800 } },
			});
		});

		const list = target.root.findByProps({ pagingEnabled: true });
		const config = list.props.viewabilityConfig as { itemVisiblePercentThreshold?: number; minimumViewTime?: number };

		// ここが落ちたら «通過しただけのセルが鳴る» が戻っている
		expect(config.minimumViewTime).toBeGreaterThan(0);
		// 大きすぎると «送ったのに始まらない» に変わる（再生開始の体感に直に効く）
		expect(config.minimumViewTime).toBeLessThanOrEqual(500);
		// 閾値そのものは据え置き（片方だけ直して満足しないため一緒に見る）
		expect(config.itemVisiblePercentThreshold).toBe(90);
	});
});
