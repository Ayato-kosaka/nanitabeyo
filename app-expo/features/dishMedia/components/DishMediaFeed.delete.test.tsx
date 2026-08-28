/*
#1629【35】オーナー実機報告:

> 投稿を削除するとローディングの無限ループになるバグ

## 何が起きていたか

`DishMediaFeed` は «開いた時点の並び» を自分の state へ固定する。固定したあとは
ストア側の `mediaIdsByKey` が縮んでもこの state は縮まないので、**削除した投稿のセルが
FlatList に残り続けた**。

残ったセルは `entriesByMediaId` から実体が消えているため
`useDishMediaBackgroundImageResources` の descriptor から外れる。descriptor から外れた id の
背景画像の状態は `idle` のまま**二度と動かない**。`DishMediaContent` は
`idle` / `loading` を «まだ読み込み中» と見なして `SkeletonShimmer`（無限にループする
シマー）を出し続けるので、利用者からは «削除したらローディングが終わらない» に見える。

## ここで固定すること

1. 削除した id が並びから消える（セルごと無くなる）
2. **描かれているどのセルも `idle` で固まっていない**（＝スケルトンが残らない）

2 が本体である。1 だけを見ていると、«セルは残すが背景だけ差し替える» のような
別の直し方に置き換わったときに、この症状が戻っても気づけない。
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
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ selectionChanged: jest.fn(), lightImpact: jest.fn() }) }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

/**
 * 背景画像 hook の代役。**本物と同じ判断をする**:
 * ストアに実体がある id は `ready`、無い id は `idle`（＝スケルトンが出続ける状態）。
 * 本物は `Image.loadAsync` を叩くのでここでは使えないが、«実体が消えた id は idle のまま»
 * という肝心の性質はそのまま写している。
 */
jest.mock("@/features/dishMedia/hooks/useDishMediaBackgroundImageResources", () => {
	const { useDishMediaEntriesStore } = require("@/stores/useDishMediaEntriesStore");
	return {
		useDishMediaBackgroundImageResources: () => ({
			imageStates: {},
			resetImageStates: jest.fn(),
			getBackgroundImageState: (id: string) =>
				useDishMediaEntriesStore.getState().entriesByMediaId[id]
					? { status: "ready", image: {} }
					: { status: "idle" },
		}),
	};
});

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

const ENTRIES_KEY = "test-feed";
const KEPT = "dm-kept";
const DELETED = "dm-deleted";

const entry = (id: string): NormalizedDishMediaEntry =>
	({
		dish_media: { id, isMine: true, media_type: "image" },
		restaurant: { id: `restaurant-${id}`, name: "テスト店" },
		dish: { id: `dish-${id}` },
		dishReviewIds: [],
	}) as unknown as NormalizedDishMediaEntry;

let renderer: TestRenderer.ReactTestRenderer | undefined;

/** onLayout を発火させないと `pageLength > 0` にならず FlatList が描かれない */
function layout(target: TestRenderer.ReactTestRenderer) {
	act(() => {
		target.root.findByProps({ testID: "dish-media-feed-root" }).props.onLayout({
			nativeEvent: { layout: { width: 390, height: 800 } },
		});
	});
}

/**
 * **いま**描かれているセルの一覧（id → 背景画像の状態）。
 * 途中の描画を数えないよう、記録した履歴ではなく現在のツリーから読む。
 */
function currentCells(target: TestRenderer.ReactTestRenderer) {
	const byId = new Map<string, string>();
	for (const node of target.root.findAll(
		(instance) => typeof instance.props?.id === "string" && instance.props?.backgroundImageState !== undefined,
		{ deep: true },
	)) {
		byId.set(node.props.id as string, (node.props.backgroundImageState as { status: string }).status);
	}
	return byId;
}

describe("#1629【35】投稿を削除するとローディングが終わらない", () => {
	beforeEach(() => {
		useDishMediaEntriesStore.setState({
			entriesByMediaId: { [KEPT]: entry(KEPT), [DELETED]: entry(DELETED) },
			mediaIdsByKey: { [ENTRIES_KEY]: [DELETED, KEPT] },
			reviewsByReviewId: {},
			reviewIdsByKey: {},
			deletedIds: {},
		});
	});

	afterEach(() => {
		act(() => renderer?.unmount());
		renderer = undefined;
	});

	it("削除した投稿のセルが並びから消え、スケルトンで固まったセルが残らない", () => {
		act(() => {
			renderer = TestRenderer.create(<DishMediaFeed entriesKey={ENTRIES_KEY} idType="dish_media" />);
		});
		layout(renderer!);

		// 前提: 2 件とも描かれていて、どちらも読み込み待ちではない
		expect([...currentCells(renderer!).keys()].sort()).toEqual([DELETED, KEPT].sort());

		act(() => {
			useDishMediaEntriesStore.getState().removeDishMediaEntry(DELETED);
		});

		const cells = currentCells(renderer!);
		// 1. 削除した投稿のセルはもう描かれない
		expect(cells.has(DELETED)).toBe(false);
		expect(cells.has(KEPT)).toBe(true);
		// 2. 描かれているセルに «idle のまま固まったもの»（= スケルトンが回り続けるセル）が無い
		expect([...cells.values()].filter((status) => status === "idle")).toEqual([]);
	});

	it("画面用途キーが捨てられただけ（clearByKey）では並びを縮めない", () => {
		act(() => {
			renderer = TestRenderer.create(<DishMediaFeed entriesKey={ENTRIES_KEY} idType="dish_media" />);
		});
		layout(renderer!);

		// `clearByKey` は画面を離れるときの掃除であって «削除» ではない。
		// ここで並びを縮めると、関係のない場面でフィードが空になる
		act(() => {
			useDishMediaEntriesStore.getState().clearByKey(ENTRIES_KEY);
		});

		expect([...currentCells(renderer!).keys()].sort()).toEqual([DELETED, KEPT].sort());
	});
});
