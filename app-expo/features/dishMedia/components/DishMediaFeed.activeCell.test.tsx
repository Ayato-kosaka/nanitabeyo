/*
#1641 オーナー実機報告（2026-08-31、スクリーンショット 2 枚）:

> ポンデポチャ押したらインスタの音聞こえる
> インスタおしたらYouTubeの音聞こえる
> YouTubeから入って上にスクロールしたらYouTubeの音が聞こえる

## 何が起きていたか

グリッド（食べたい/食べた）から開くフィードは **外側の縦ページャ 1 ページ = グリッドの 1 セル**で、
各ページの `DishMediaFeed` は **ids が必ず 1 件**。つまりページの中では常に
`index(0) === currentIndex(0)` になり、**マウントした瞬間に前面扱いで鳴り出す**。

そこへ #1629【18】の先読み（`shouldPrefetch={index === activeScopeIndex + 1}`）が
隣のページの取得を開けるので、**隣のページも描かれ、そのまま鳴っていた**。
だから «押したカードの次» の音が鳴る。必ず «次» で «前» でないのは、
先読みが `activeScopeIndex + 1` の側にしか掛からないからである。

## ここで固定すること

1. **`isScreenActive` が false のページは、どのセルも前面にしない**
   （＝ 描いてよいが鳴らしてはいけない）
2. **並びが届いたら `currentIndex` は `initialIndex` に合う**
   （`useState` の初期化子では `ids` が空なので必ず 0 になる。
    `initialIndex > 0` の画面で 0 番目が鳴っていた）

⚠️ この 2 つは «音がどのセルから出るか» を決める唯一の分岐である。
   ここが緑でないまま実機へ出すと、また «別のセルの音が鳴る» が戻る。
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

/*
DishMediaContent は動画プレイヤーと WebView を抱えるので代役に置く。
ただし **`isActive` は記録する**。ここが今回の検証対象そのものだから。
*/
const activeCalls: { id: string; isActive: boolean }[] = [];
jest.mock("./DishMediaContent", () => ({
	__esModule: true,
	default: function MockDishMediaContent(props: { id: string; isActive: boolean }) {
		activeCalls.push({ id: props.id, isActive: props.isActive });
		return null;
	},
}));

import DishMediaFeed from "./DishMediaFeed";
import { useDishMediaEntriesStore, type NormalizedDishMediaEntry } from "@/stores/useDishMediaEntriesStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRIES_KEY = "active-cell-feed";

const entry = (id: string): NormalizedDishMediaEntry =>
	({
		dish_media: { id, isMine: true, media_type: "image" },
		restaurant: { id: `restaurant-${id}`, name: "テスト店" },
		dish: { id: `dish-${id}` },
		dishReviewIds: [],
	}) as unknown as NormalizedDishMediaEntry;

const seed = (ids: string[]) => {
	useDishMediaEntriesStore.setState({
		entriesByMediaId: Object.fromEntries(ids.map((id) => [id, entry(id)])),
		mediaIdsByKey: { [ENTRIES_KEY]: ids },
		reviewsByReviewId: {},
		reviewIdsByKey: {},
		deletedIds: {},
	});
};

/** onLayout を発火させないと pageLength > 0 にならず FlatList が描かれない */
const layout = (target: TestRenderer.ReactTestRenderer) => {
	act(() => {
		target.root.findByProps({ testID: "dish-media-feed-root" }).props.onLayout({
			nativeEvent: { layout: { width: 390, height: 800 } },
		});
	});
};

/** 最後に各セルへ渡った isActive（同じセルが何度も描かれるので最新だけ見る） */
const latestActiveIds = () => {
	const latest = new Map<string, boolean>();
	for (const call of activeCalls) latest.set(call.id, call.isActive);
	return [...latest.entries()].filter(([, isActive]) => isActive).map(([id]) => id);
};

describe("#1641 どのセルを «前面» と見なすか", () => {
	let renderer: TestRenderer.ReactTestRenderer | undefined;

	beforeEach(() => {
		activeCalls.length = 0;
	});

	afterEach(() => {
		act(() => renderer?.unmount());
		renderer = undefined;
	});

	/*
	⚠️ ここが落ちたら «押したカードの次の音が鳴る» が戻っている。
	   先読みで開いた隣のページは、自分の中では 0 番目なので «前面» に見えてしまう。
	*/
	it("前面でないページ（isScreenActive=false）は、どのセルも前面にしない", () => {
		seed(["dm-only"]);
		act(() => {
			renderer = TestRenderer.create(
				<DishMediaFeed entriesKey={ENTRIES_KEY} idType="dish_media" horizontal isScreenActive={false} />,
			);
		});
		layout(renderer!);

		expect(latestActiveIds()).toEqual([]);
	});

	it("前面のページ（既定）は、その 1 件を前面にする", () => {
		seed(["dm-only"]);
		act(() => {
			renderer = TestRenderer.create(<DishMediaFeed entriesKey={ENTRIES_KEY} idType="dish_media" horizontal />);
		});
		layout(renderer!);

		expect(latestActiveIds()).toEqual(["dm-only"]);
	});

	/*
	⚠️ ここが落ちたら «initialIndex を渡しても 0 番目が鳴る» が戻っている。
	   ids は useState([]) なので、初期化子の時点では必ず空。
	   そこで clampIndex(initialIndex, 0) を取ると 0 になってしまう。
	*/
	it("並びが届いたら currentIndex は initialIndex に合う（0 番目を鳴らさない）", () => {
		seed(["dm-1", "dm-2", "dm-3"]);
		act(() => {
			renderer = TestRenderer.create(
				<DishMediaFeed entriesKey={ENTRIES_KEY} idType="dish_media" initialIndex={2} />,
			);
		});
		layout(renderer!);

		expect(latestActiveIds()).toEqual(["dm-3"]);
	});
});
