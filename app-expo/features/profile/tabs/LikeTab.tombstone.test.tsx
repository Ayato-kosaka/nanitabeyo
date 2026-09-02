/*
#1513 いいね一覧に削除済みの投稿が混ざったときの挙動を固定する。

固定したいのは 3 点：
1. 行を消さない（いいねした事実は残っているので、一覧から消すと取りこぼしと区別が付かない）
2. 写真の代わりに墓標「削除されました」を出す（別の絵へ差し替えない）
3. **押せない**。遷移先の全画面フィードには実体が無く、押せると中身の無いフィードが開く

3 は見た目に出ないので、`ImageCard` の Pressable の `disabled` を直接読んで確かめる。
*/
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: jest.fn() }) }));
jest.mock("@/hooks/useContentWidth", () => ({ useContentWidth: () => 390 }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));

jest.mock("expo-image", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		Image: ({ source }: { source?: { uri?: string } }) =>
			ReactActual.createElement(RNView, { testID: "like-tab-image", source }),
	};
});
jest.mock("expo-linear-gradient", () => {
	const { View: RNView } = jest.requireActual("react-native");
	return { LinearGradient: RNView };
});

// GridList は data を renderItem へ流すだけの薄いフェイクへ。見たいのは 1 タイルの中身だけ
jest.mock("@/components/collapsible-tabs/GridList", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		GridList: ({
			data,
			renderItem,
		}: {
			data: { id: string }[];
			renderItem: (info: { item: unknown; index: number }) => unknown;
		}) =>
			ReactActual.createElement(
				RNView,
				{ testID: "like-tab-grid" },
				data.map((item: { id: string }, index: number) =>
					ReactActual.createElement(RNView, { key: item.id }, renderItem({ item, index })),
				),
			),
	};
});

type Entry = {
	dish_media: { id: string; thumbnailImageUrl: string | null; deleted_at: string | null };
	dish: { name: string; averageRating: number; reviewCount: number };
};

const entries: Record<string, Entry> = {};
jest.mock("@/stores/useDishMediaEntriesStore", () => ({
	useDishMediaEntriesStore: Object.assign(
		(selector: (s: unknown) => unknown) =>
			selector({
				fetchInitialByKey: jest.fn(),
				fetchMoreByKey: jest.fn(),
			}),
		{ getState: () => ({}) },
	),
	// 初回取得は検証対象外なので hasFetchedInitial: true で走らせない
	selectIdsByKey: () => () => ({
		ids: Object.keys(entries),
		isLoading: false,
		isLoadingMore: false,
		error: null,
		hasFetchedInitial: true,
	}),
	selectEntryByMediaId: (id: string) => () => entries[id],
}));

import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { LikeTab } from "./LikeTab";
import { DELETED_MEDIA_TOMBSTONE_TEST_ID } from "@/components/DeletedMediaTombstone";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const makeEntry = (id: string, deletedAt: string | null): Entry => ({
	dish_media: { id, thumbnailImageUrl: deletedAt ? null : `https://example.com/${id}.jpg`, deleted_at: deletedAt },
	dish: { name: "ラーメン", averageRating: 4.2, reviewCount: 7 },
});

const mounted: TestRenderer.ReactTestRenderer[] = [];
const render = async () => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<LikeTab />);
	});
	mounted.push(tree);
	return tree;
};

afterEach(() => {
	for (const tree of mounted.splice(0)) act(() => tree.unmount());
	for (const key of Object.keys(entries)) delete entries[key];
	mockPush.mockClear();
});

describe("#1513 いいね一覧の墓標", () => {
	it("削除済みの投稿は行を残したまま墓標を出し、写真を出さない", async () => {
		entries["media-deleted"] = makeEntry("media-deleted", "2026-08-20T00:00:00.000Z");
		const tree = await render();

		expect(tree.root.findAllByProps({ testID: DELETED_MEDIA_TOMBSTONE_TEST_ID }).length).toBeGreaterThan(0);
		// 行そのものは残る（タイルの Pressable がある）
		expect(tree.root.findAllByProps({ testID: "profile-liked-deleted-media-deleted" }).length).toBeGreaterThan(0);
		// 「跡地に別の絵」が入っていないこと：URL 付きの画像が 1 枚も無い
		const images = tree.root.findAllByProps({ testID: "like-tab-image" });
		expect(images.every((n) => !n.props.source?.uri)).toBe(true);
	});

	it("削除済みのタイルは押せない（Pressable が disabled）", async () => {
		entries["media-deleted"] = makeEntry("media-deleted", "2026-08-20T00:00:00.000Z");
		const tree = await render();

		// jest の react-native プリセットでは Pressable が型で引けないので、
		// ImageCard が付けている accessibilityRole="button" で掴む。
		// 同じ props が合成要素とホスト View の 2 段に出るため、`disabled` を実際に
		// 持っている段（＝ Pressable 本体）だけを見る
		const pressables = tree.root
			.findAllByProps({ accessibilityRole: "button" })
			.filter((p) => p.props.disabled !== undefined);
		expect(pressables.length).toBeGreaterThan(0);
		expect(pressables.every((p) => p.props.disabled === true)).toBe(true);

		await act(async () => {
			pressables[0].props.onPress?.();
		});
		expect(mockPush).not.toHaveBeenCalled();
	});

	it("生きている投稿には墓標を出さず、押すとフィードへ遷移する", async () => {
		entries["media-alive"] = makeEntry("media-alive", null);
		const tree = await render();

		expect(tree.root.findAllByProps({ testID: DELETED_MEDIA_TOMBSTONE_TEST_ID })).toHaveLength(0);
		const pressable = tree.root
			.findAllByProps({ accessibilityRole: "button" })
			.filter((p) => p.props.disabled !== undefined)[0];
		expect(pressable.props.disabled).toBe(false);

		await act(async () => {
			pressable.props.onPress?.();
		});
		expect(mockPush).toHaveBeenCalledTimes(1);
	});

	it("deleted_at を持たない入力（undefined）は削除済みとして扱わない", async () => {
		// API のレスポンスにこの列が無い経路（古いキャッシュ・別エンドポイント）で
		// **生きている投稿まで墓標になる** のを防ぐ。`!== null` で書くとここが落ちる
		entries["media-legacy"] = {
			dish_media: { id: "media-legacy", thumbnailImageUrl: "https://example.com/legacy.jpg" },
			dish: { name: "ラーメン", averageRating: 4.2, reviewCount: 7 },
		} as unknown as Entry;
		const tree = await render();

		expect(tree.root.findAllByProps({ testID: DELETED_MEDIA_TOMBSTONE_TEST_ID })).toHaveLength(0);
	});
});
