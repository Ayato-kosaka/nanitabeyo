/*
#1513 通知の対象（dish_media / dish_reviews）が削除済みだったときの挙動を固定する。

固定したいのは 3 点：
1. 通知の行は消さない。「〇〇さんがいいねしました」は起きた事実であり、あとから
   写真を消したことで通知ごと消えると、利用者からは通知の取りこぼしと区別が付かない
2. サムネイルの位置に墓標「削除されました」を出す（別の絵へ差し替えない）
3. **押せない**。`handleNotificationPress` の遷移先（全画面フィード）には実体が無く、
   押せると中身の無いフィードが開く

3 は見た目に出ないので TouchableOpacity の `disabled` と router.push の呼ばれなさで見る。
*/
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
jest.mock("react-native-safe-area-context", () => {
	const ReactModule = require("react");
	const { View } = require("react-native");
	return {
		__esModule: true,
		SafeAreaView: ({ children, ...props }: { children?: React.ReactNode }) =>
			ReactModule.createElement(View, props, children),
		useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }),
	};
});
jest.mock("expo-image", () => {
	const ReactModule = require("react");
	const { View } = require("react-native");
	return {
		Image: ({ source }: { source?: { uri?: string } }) =>
			ReactModule.createElement(View, { testID: "notification-image", source }),
	};
});
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key, locale: "ja-JP" } }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
	useRouter: () => ({ push: mockPush }),
	// フォーカス時の副作用（既読化 API 等）はこのテストの関心外なので発火させない
	useFocusEffect: () => {},
}));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: () => {} }));
jest.mock("@/lib/image", () => ({ getCacheKeyForImage: () => "cache-key" }));
jest.mock("@/lib/frontend-utils", () => ({ dateStringToTimestamp: () => "1分前" }));
jest.mock("@/stores/useDishMediaEntriesStore", () => ({
	useDishMediaEntriesStore: {
		getState: () => ({ upsertDishMediaEntries: jest.fn(), updateMediaIdsByKey: jest.fn() }),
	},
}));

// jest.mock のファクトリからは `mock` 始まりの変数だけ参照できる（babel-plugin-jest-hoist の制約）
const mockItems: unknown[] = [];
jest.mock("@/features/notifications/hooks/useNotifications", () => ({
	useNotifications: () => ({
		items: mockItems,
		isLoadingInitial: false,
		isLoadingMore: false,
		refresh: jest.fn(),
		loadMore: jest.fn(),
	}),
}));
jest.mock("@/features/notifications/hooks/useMarkNotificationsRead", () => ({
	useMarkNotificationsRead: () => ({ markAllAsRead: jest.fn() }),
}));
jest.mock("@/features/notifications/hooks/useNotificationUnreadCount", () => ({
	useNotificationUnreadCount: () => ({ unreadCount: 0, refresh: jest.fn() }),
}));
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ user: { id: "user-1", is_anonymous: false } }) }));

import React, { act } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";
import NotificationsScreen from "../app/[locale]/(tabs)/notifications/index";
import { DELETED_MEDIA_TOMBSTONE_TEST_ID } from "@/components/DeletedMediaTombstone";

const makeNotification = (id: string, deletedAt: string | null | undefined) => ({
	notification: {
		id,
		target_table: "dish_media",
		target_id: "media-1",
		action_type: "like",
		created_at: "2026-08-20T00:00:00.000Z",
	},
	actors: [{ display_name: "テス太", avatarUrls: { sm: "https://example.com/avatar.png" } }],
	dishMediaEntries: {
		dish_media: {
			id: "media-1",
			thumbnailImageUrl: deletedAt ? null : "https://example.com/thumb.jpg",
			...(deletedAt === undefined ? {} : { deleted_at: deletedAt }),
		},
	},
});

const render = () => {
	let renderer!: TestRenderer.ReactTestRenderer;
	act(() => {
		renderer = TestRenderer.create(<NotificationsScreen />);
	});
	return renderer;
};

/** `disabled` を実際に持っている段（＝ TouchableOpacity 本体）だけを取り出す */
const findRows = (root: ReactTestInstance): ReactTestInstance[] =>
	root.findAllByProps({ testID: "notification-item-like" }).filter((n) => n.props.disabled !== undefined);

afterEach(() => {
	mockItems.length = 0;
	mockPush.mockClear();
});

describe("#1513 通知一覧の墓標", () => {
	it("対象が削除済みなら、行を残したままサムネイル位置に墓標を出す", () => {
		mockItems.push(makeNotification("notif-1", "2026-08-21T00:00:00.000Z"));
		const renderer = render();

		// 行は残る（TouchableOpacity は合成要素とホストの 2 段に出るので数は見ない）
		expect(findRows(renderer.root).length).toBeGreaterThan(0);
		// 墓標が出る
		expect(
			renderer.root.findAllByProps({ testID: "notification-deleted-notif-1" }).length,
		).toBeGreaterThan(0);
		// 「跡地に別の絵」が入っていないこと：サムネイルの画像が出ていない
		const thumbUris = renderer.root
			.findAllByProps({ testID: "notification-image" })
			.map((n) => n.props.source?.uri);
		expect(thumbUris).not.toContain("https://example.com/thumb.jpg");
	});

	it("削除済みの行は押せず、フィードへ遷移しない", () => {
		mockItems.push(makeNotification("notif-1", "2026-08-21T00:00:00.000Z"));
		const renderer = render();

		const row = findRows(renderer.root)[0];
		expect(row.props.disabled).toBe(true);
		act(() => {
			row.props.onPress?.();
		});
		expect(mockPush).not.toHaveBeenCalled();
	});

	it("生きている投稿の通知は墓標を出さず、押すとフィードへ遷移する", () => {
		mockItems.push(makeNotification("notif-1", null));
		const renderer = render();

		expect(renderer.root.findAllByProps({ testID: DELETED_MEDIA_TOMBSTONE_TEST_ID })).toHaveLength(0);
		const row = findRows(renderer.root)[0];
		expect(row.props.disabled).toBe(false);
		act(() => {
			row.props.onPress?.();
		});
		expect(mockPush).toHaveBeenCalledTimes(1);
	});

	it("deleted_at を持たない入力（undefined）は削除済みとして扱わない", () => {
		// この列を返さない経路（古いキャッシュ・別エンドポイント）で **生きている通知まで
		// 墓標になり、押せなくなる** のを防ぐ。`!== null` で書くとここが落ちる
		mockItems.push(makeNotification("notif-1", undefined));
		const renderer = render();

		expect(renderer.root.findAllByProps({ testID: DELETED_MEDIA_TOMBSTONE_TEST_ID })).toHaveLength(0);
		expect(findRows(renderer.root)[0].props.disabled).toBe(false);
	});
});
