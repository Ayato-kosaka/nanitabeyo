/*
#1629【40】オーナー実機報告（2026-08-28 / OTA `553f8763`）:

> 削除したら**次の投稿**が無限ローディングになった。これって自分でテスト出来ないの？

## 【35】で直し切れなかった理由

【35】は «削除したセルが並びに残り、`idle` のままシマーが回る» を直した
（`deletedIds` の墓標で並びから落とす）。しかしその回帰テスト
（`DishMediaFeed.delete.test.tsx`）は **背景画像の hook を «ストアに実体があれば ready»
というモックへ差し替えている**。本物の hook が削除のときに何をするかは 1 行も通っていない。

本物は `sessionKey`（当時は `entriesKey::idType::ids.join(",")`）が変わると
`resetImageStates()` で **読み終わった画像を 1 枚残らず捨てて取り直す**。
1 件消えるだけで並びの文字列が変わるので、削除のたびに全セルが
`ready` → `idle` → `loading` へ落ちる。**消えたセルの隣＝次の投稿が
スケルトンへ戻る**のはこれである（実機では取り直しが戻ってこない）。

## ここで固定すること

1. 削除しても、**残っているセルの背景画像は捨てられない**（`ready` のまま。
   `Image.loadAsync` も追加で呼ばれない）
2. 末尾の投稿を削除したあとも、**表示中のセルが «再生対象» から外れない**
   （`currentIndex` が並びの外を指したままにならない）

⚠️ このテストは背景画像の hook を **本物のまま**動かす。差し替えるのは
   `expo-image` の `Image.loadAsync` だけ。ここをモックへ戻すと、また
   «テストは緑・実機は無限ローディング» に戻る。
*/
import { act } from "react";
import TestRenderer from "react-test-renderer";
import { FlatList } from "react-native";

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

/** 本物の hook が叩く唯一のネイティブ境界。ここだけを差し替える */
const mockLoadAsync = jest.fn(async (source: { uri: string }) => ({ uri: source.uri, release: jest.fn() }));
jest.mock("expo-image", () => ({
	__esModule: true,
	Image: { loadAsync: (...args: unknown[]) => (mockLoadAsync as unknown as (...a: unknown[]) => unknown)(...args) },
}));

/** DishMediaContent は動画プレイヤー等を抱えるので、受け取った props を記録するだけの代役に置く */
const received: { id: string; status: string; isActive: boolean }[] = [];
jest.mock("./DishMediaContent", () => ({
	__esModule: true,
	default: function MockDishMediaContent(props: {
		id: string;
		isActive: boolean;
		backgroundImageState: { status: string };
	}) {
		received.push({ id: props.id, status: props.backgroundImageState.status, isActive: props.isActive });
		return null;
	},
}));

import DishMediaFeed from "./DishMediaFeed";
import { useDishMediaEntriesStore, type NormalizedDishMediaEntry } from "@/stores/useDishMediaEntriesStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRIES_KEY = "test-feed";
const IDS = ["dm-0", "dm-1", "dm-2"];

const entry = (id: string): NormalizedDishMediaEntry =>
	({
		dish_media: { id, isMine: true, media_type: "image", mediaUrl: `https://example.test/${id}.jpg` },
		restaurant: { id: `restaurant-${id}`, name: "テスト店" },
		dish: { id: `dish-${id}` },
		dishReviewIds: [],
	}) as unknown as NormalizedDishMediaEntry;

let renderer: TestRenderer.ReactTestRenderer | undefined;

/** `Image.loadAsync` の解決を全部流し切る */
const flush = async () => {
	await act(async () => {
		for (let i = 0; i < 8; i += 1) await Promise.resolve();
	});
};

/** onLayout を発火させないと `pageLength > 0` にならず FlatList が描かれない */
function layout(target: TestRenderer.ReactTestRenderer) {
	act(() => {
		target.root.findByProps({ testID: "dish-media-feed-root" }).props.onLayout({
			nativeEvent: { layout: { width: 390, height: 800 } },
		});
	});
}

/** FlatList の viewability を鳴らして «いま見ている位置» を動かす */
function scrollTo(target: TestRenderer.ReactTestRenderer, index: number) {
	const list = target.root.findAllByType(FlatList)[0];
	act(() => {
		list.props.onViewableItemsChanged({
			viewableItems: [{ isViewable: true, index, item: null, key: String(index) }],
		});
	});
}

/** いま描かれているセル（id → 背景画像の状態） */
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

async function open(ids: string[]) {
	useDishMediaEntriesStore.setState({
		entriesByMediaId: Object.fromEntries(ids.map((id) => [id, entry(id)])),
		mediaIdsByKey: { [ENTRIES_KEY]: [...ids] },
		reviewsByReviewId: {},
		reviewIdsByKey: {},
		deletedIds: {},
	});
	await act(async () => {
		renderer = TestRenderer.create(<DishMediaFeed entriesKey={ENTRIES_KEY} idType="dish_media" />);
	});
	layout(renderer!);
	await flush();
	return renderer!;
}

beforeEach(() => {
	received.length = 0;
	mockLoadAsync.mockClear();
});

afterEach(() => {
	act(() => renderer?.unmount());
	renderer = undefined;
});

describe("#1629【40】削除した «次の投稿» がローディングのまま残らない", () => {
	it("削除しても、残っているセルの背景画像は捨てられない（隣がスケルトンへ戻らない）", async () => {
		const target = await open(IDS);

		// 前提: 3 件とも読み終わっている
		expect([...currentCells(target).values()]).toEqual(["ready", "ready", "ready"]);
		const loadsBeforeDelete = mockLoadAsync.mock.calls.length;

		received.length = 0;
		await act(async () => {
			useDishMediaEntriesStore.getState().removeDishMediaEntry("dm-0");
		});
		await flush();

		// 1. 削除したセルは消え、残りは «読み終わった絵» を持ったまま
		const cells = currentCells(target);
		expect(cells.has("dm-0")).toBe(false);
		expect([...cells.entries()]).toEqual([
			["dm-1", "ready"],
			["dm-2", "ready"],
		]);

		// 2. 本命。**削除から後、残ったセルが一度でも «読み込み中» に落ちていないこと。**
		//    最後だけ見ても駄目（取り直しが速ければ緑になってしまう）。全描画を見る
		const fellBack = received.filter((r) => r.id !== "dm-0" && (r.status === "idle" || r.status === "loading"));
		expect(fellBack).toEqual([]);

		// 3. 取り直し（= release してから読み直し）そのものが走っていない
		expect(mockLoadAsync.mock.calls.length).toBe(loadsBeforeDelete);
	});

	it("末尾の投稿を削除しても、表示中のセルが «再生対象» から外れない", async () => {
		const target = await open(IDS);
		scrollTo(target, 2); // 末尾まで送ってから、その投稿を消す
		await flush();

		await act(async () => {
			useDishMediaEntriesStore.getState().removeDishMediaEntry("dm-2");
		});
		await flush();

		const active = target.root
			.findAll((i) => typeof i.props?.id === "string" && i.props?.isActive === true, { deep: true })
			.map((node) => node.props.id as string);
		// `currentIndex` が並びの外（2）を指したままだと、どのセルも isActive にならず
		// 動画が 1 本も再生されない。並びの末尾（dm-1）へ丸められていること
		expect(active).toEqual(["dm-1"]);
	});
});
