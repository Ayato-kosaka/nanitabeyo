// #1130 【設計】お知らせ一覧（app/[locale]/(tabs)/notifications/index.tsx）の SafeArea 不変条件テスト。
//
// 背景（Issue #1130）:
// この画面は `react-native` の `SafeAreaView` を使っていた。これは **iOS 専用**の実装で、
// Android では inset を一切足さない素の View と同じ振る舞いになる（RN 公式ドキュメント記載の制約）。
// そのため Android だけヘッダーがステータスバーへ食い込んでいた。
// 見本として指定されたブロック済み料理一覧（profile/blocked-topics.tsx）や、
// 同じくタブ直下の検索・プロフィール画面は `react-native-safe-area-context` を使っており、
// こちらは Android でも inset を適用する。
//
// 「実機で見た目を確認した」ではなく、
//   1. 描画結果に react-native-safe-area-context の SafeAreaView が居て `edges={["top"]}` が渡ること
//   2. ソース上で `react-native` からは SafeAreaView を import し直さないこと（＝バグの再発）
// の 2 点を赤で守る。
import * as fs from "fs";
import * as path from "path";
import React, { act } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";

// ---- 観測対象（SafeArea の扱い）以外はすべてスタブ化する ----
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

// SafeAreaView に何が渡ったかをテストから観測できるよう、host View へそのまま素通しする
jest.mock("react-native-safe-area-context", () => {
	const ReactModule = require("react");
	const { View } = require("react-native");
	return {
		__esModule: true,
		SafeAreaView: ({ children, ...props }: { children?: React.ReactNode }) =>
			ReactModule.createElement(View, { testID: "mock-safe-area-view", ...props }, children),
		useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }),
	};
});

jest.mock("expo-image", () => ({
	Image: function MockExpoImage() {
		return null;
	},
}));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key, locale: "ja-JP" } }));
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("expo-router", () => ({
	useRouter: () => ({ push: jest.fn() }),
	// フォーカス時の副作用（既読化 API 等）はこのテストの関心外なので発火させない
	useFocusEffect: () => {},
}));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/lib/image", () => ({ getCacheKeyForImage: () => "cache-key" }));
jest.mock("@/lib/frontend-utils", () => ({ dateStringToTimestamp: () => "1分前" }));
jest.mock("@/stores/useDishMediaEntriesStore", () => ({ useDishMediaEntriesStore: { getState: () => ({}) } }));
jest.mock("@/features/notifications/hooks/useNotifications", () => ({
	useNotifications: () => ({
		items: [],
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

// jest.mock のファクトリからは `mock` 始まりの変数だけ参照できる（babel-plugin-jest-hoist の制約）
const mockLoggedInUser: { id: string; is_anonymous: boolean } = { id: "user-1", is_anonymous: false };
let mockCurrentUser: typeof mockLoggedInUser | null = mockLoggedInUser;
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ user: mockCurrentUser }) }));

import NotificationsScreen from "../app/[locale]/(tabs)/notifications/index";

/** 描画結果から SafeAreaView（モック）に対応する host 要素だけを取り出す */
const findSafeAreaViews = (root: ReactTestInstance): ReactTestInstance[] =>
	root.findAll((node) => typeof node.type === "string" && node.props?.testID === "mock-safe-area-view");

const render = () => {
	let renderer!: TestRenderer.ReactTestRenderer;
	act(() => {
		renderer = TestRenderer.create(<NotificationsScreen />);
	});
	return renderer;
};

describe("#1130 お知らせ一覧の SafeArea", () => {
	afterEach(() => {
		mockCurrentUser = mockLoggedInUser;
	});

	it("ログイン済みの一覧は SafeAreaView(react-native-safe-area-context) を edges={['top']} で使う", () => {
		const renderer = render();
		const safeAreaViews = findSafeAreaViews(renderer.root);

		expect(safeAreaViews).toHaveLength(1);
		expect(safeAreaViews[0].props.edges).toEqual(["top"]);
	});

	it("ゲスト向けの空画面も同じ edges 指定になっている", () => {
		mockCurrentUser = null;
		const renderer = render();
		const safeAreaViews = findSafeAreaViews(renderer.root);

		expect(safeAreaViews).toHaveLength(1);
		expect(safeAreaViews[0].props.edges).toEqual(["top"]);
	});

	it("react-native の SafeAreaView（iOS 専用 = Android で無効）を import していない", () => {
		const screenSource = fs.readFileSync(
			path.join(__dirname, "..", "app", "[locale]", "(tabs)", "notifications", "index.tsx"),
			"utf8",
		);

		// `import { ... SafeAreaView ... } from "react-native";` に当たったら失敗させる
		const reactNativeImport = screenSource.match(/import\s*\{([^}]*)\}\s*from\s*"react-native"/);
		expect(reactNativeImport).not.toBeNull();
		expect(reactNativeImport?.[1]).not.toContain("SafeAreaView");
		expect(screenSource).toContain('import { SafeAreaView } from "react-native-safe-area-context"');
	});

	it("見本のブロック済み料理一覧と同じ SafeArea の出所を使っている", () => {
		const blockedTopicsSource = fs.readFileSync(
			path.join(__dirname, "..", "app", "[locale]", "(tabs)", "profile", "blocked-topics.tsx"),
			"utf8",
		);

		// 見本側が react-native-safe-area-context をやめたらこのテストの前提が崩れるので、そこも固定する
		expect(blockedTopicsSource).toContain('import { SafeAreaView } from "react-native-safe-area-context"');
	});
});
