// #1557 【バグ】お知らせ一覧（app/[locale]/(tabs)/notifications/index.tsx）の匿名 actor 描画テスト。
//
// 背景（Issue #1557 / 親 #1375）:
// 匿名ユーザーには users 行が存在しないため（20260807T0000_create_share_links.sql）、
// 友達投票（匿名参加が仕様）の通知では API の actors が空配列になる。
// 旧実装は `item.actors?.[0].avatarUrls?.sm` と先頭要素を直参照しており、
// `Cannot read property 'avatarUrls' of undefined` で通知一覧どころか
// アプリ起動時の全画面エラーまで引き起こしていた（実機 run 32674246514）。
//
// ここで守る不変条件:
//   1. actors が空でも一覧の描画が throw しない
//   2. 表示名は ProfileHeader のゲスト表示と同じ文言（Profile.guestDisplayName）になる
//   3. アバターも ProfileHeader のゲスト表示と同じアプリアイコンになる
// モックの構成は __tests__/notificationsSafeArea.test.tsx と同じ方針で、
// 観測対象（通知行の描画）以外はすべてスタブ化する。
import React, { act } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";
import type { NotificationItem } from "@shared/api/v1/res";

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

// アバターに何が渡ったか（uri か、アプリアイコンの require 値か）を観測できるよう、
// props を素通しする host 要素に置き換える
jest.mock("expo-image", () => {
	const ReactModule = require("react");
	return {
		Image: (props: Record<string, unknown>) => ReactModule.createElement("MockExpoImage", props),
	};
});

// i18n はキーをそのまま返す。ゲスト表示名が「Profile.guestDisplayName のキーで引かれたこと」
// ＝ ProfileHeader と同じ文言ソースを使っていることを検証できる
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key, locale: "ja-JP" } }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("expo-router", () => ({
	useRouter: () => ({ push: jest.fn() }),
	useFocusEffect: () => {},
}));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: () => {} }));
jest.mock("@/lib/image", () => ({ getCacheKeyForImage: () => "cache-key" }));
jest.mock("@/lib/frontend-utils", () => ({ dateStringToTimestamp: () => "1分前" }));
jest.mock("@/stores/useDishMediaEntriesStore", () => ({ useDishMediaEntriesStore: { getState: () => ({}) } }));
jest.mock("@/features/notifications/hooks/useMarkNotificationsRead", () => ({
	useMarkNotificationsRead: () => ({ markAllAsRead: jest.fn() }),
}));
jest.mock("@/features/notifications/hooks/useNotificationUnreadCount", () => ({
	useNotificationUnreadCount: () => ({ unreadCount: 0, refresh: jest.fn() }),
}));
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({ user: { id: "host-user", is_anonymous: false } }),
}));

// jest.mock のファクトリからは `mock` 始まりの変数だけ参照できる（babel-plugin-jest-hoist の制約）
let mockNotificationItems: NotificationItem[] = [];
jest.mock("@/features/notifications/hooks/useNotifications", () => ({
	useNotifications: () => ({
		items: mockNotificationItems,
		isLoadingInitial: false,
		isLoadingMore: false,
		refresh: jest.fn(),
		loadMore: jest.fn(),
	}),
}));

import NotificationsScreen from "../app/[locale]/(tabs)/notifications/index";

/** 匿名参加者の投票が作る通知。actors はサーバ側で users 行が引けず空配列になる */
const buildVoteNotification = (actors: NotificationItem["actors"]): NotificationItem =>
	({
		notification: {
			id: "notification-1",
			action_type: "vote",
			target_table: "dish_category_group_vote_sessions",
			target_id: "session-1",
			created_at: "2026-08-23T23:50:00.000Z",
		},
		actors,
		dishCategoryGroupVoteSession: { id: "session-1", shareToken: "share-token-1" },
	}) as unknown as NotificationItem;

const render = () => {
	let renderer!: TestRenderer.ReactTestRenderer;
	act(() => {
		renderer = TestRenderer.create(<NotificationsScreen />);
	});
	return renderer;
};

const findImages = (root: ReactTestInstance): ReactTestInstance[] => root.findAllByType("MockExpoImage" as never);

const collectText = (root: ReactTestInstance): string =>
	root
		.findAll((node) => typeof node.type === "string" && String(node.type) === "Text")
		.flatMap((node) => (Array.isArray(node.props.children) ? node.props.children : [node.props.children]))
		.filter((child): child is string => typeof child === "string")
		.join("");

describe("#1557 匿名 actor の通知行", () => {
	afterEach(() => {
		mockNotificationItems = [];
	});

	it("actors が空でも描画が落ちず、ゲスト表示名とアプリアイコンで描かれる", () => {
		mockNotificationItems = [buildVoteNotification([])];

		// 旧実装（actors[0] の直参照）では TypeError で throw していた
		const renderer = render();

		// 表示名: ProfileHeader のゲスト表示と同じ i18n キーで引かれること
		expect(collectText(renderer.root)).toContain("Profile.guestDisplayName");

		// アバター: ProfileHeader のゲスト表示と同じアプリアイコン（uri ではなく require 値）
		const [avatar] = findImages(renderer.root);
		expect(avatar).toBeDefined();

		expect(avatar.props.source).toBe(require("@/assets/images/icon.webp"));
	});

	it("actors がある通知は従来どおり表示名と avatarUrls.sm で描かれる", () => {
		mockNotificationItems = [
			buildVoteNotification([
				{ id: "voter-1", display_name: "Voter User", avatarUrls: { sm: "https://example.com/avatar-sm.png" } },
			] as unknown as NotificationItem["actors"]),
		];

		const renderer = render();

		expect(collectText(renderer.root)).toContain("Voter User");
		expect(collectText(renderer.root)).not.toContain("Profile.guestDisplayName");

		const [avatar] = findImages(renderer.root);
		expect(avatar.props.source).toMatchObject({ uri: "https://example.com/avatar-sm.png" });
	});
});
