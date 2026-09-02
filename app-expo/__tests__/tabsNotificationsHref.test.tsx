import React, { act } from "react";
import TestRenderer from "react-test-renderer";

/**
 * #1092 PR4b の振る舞いテスト: **通知タブがログイン済みユーザーから消えない**。
 *
 * タブの表示判定は `user?.is_anonymous !== false ? null : undefined` だった。
 * `@supabase/auth-js` の型では `User["is_anonymous"]` は **optional** なので、
 * この式は「値が欠けている」を「匿名（ゲスト）」に倒す。ゲートを外して
 * 認証未確定の状態から画面が動き出すようになった今、`user` は居るのに `is_anonymous` が
 * 付いていないセッションで **ログイン済みなのに通知タブが出ない** が実際に起こりうる。
 *
 * ここでは 4 状態すべてを固定する。`!== false` に戻すと undefined のケースが赤くなる。
 *
 * `app/` 配下に置いたテストは expo-router がルートとして拾ってしまうため、ここに置いている。
 */

let mockUser: { is_anonymous?: boolean } | null = null;
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({ user: mockUser }),
}));

jest.mock("@/lib/i18n", () => ({
	__esModule: true,
	default: { t: (key: string) => key },
}));

jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// アイコンは表示判定に関係しないので、素の host 要素へ差し替える（ESM の変換を避ける狙いもある）
jest.mock("lucide-react-native", () => {
	const icon = () => require("react").createElement("Icon");
	return { MapPinned: icon, Bell: icon, User: icon, Search: icon, Pencil: icon };
});

// `Tabs.Screen` に渡された options をそのまま観測できるようにする
jest.mock("expo-router", () => {
	const react = require("react");
	const Tabs = ({ children }: { children: React.ReactNode }) => react.createElement("Tabs", null, children);
	Tabs.Screen = ({ name, options }: { name: string; options?: Record<string, unknown> }) =>
		react.createElement("TabsScreen", { name, options: options ?? {} });
	return { Tabs };
});

import TabLayout from "@/app/[locale]/(tabs)/_layout";

/**
 * 通知タブの `href` を取り出す。
 * expo-router では `href: null` が「タブバーに出さない」、`undefined` が「既定どおり出す」。
 */
const getNotificationsHref = (user: { is_anonymous?: boolean } | null) => {
	mockUser = user;
	let renderer: TestRenderer.ReactTestRenderer;
	act(() => {
		renderer = TestRenderer.create(React.createElement(TabLayout));
	});
	const screen = renderer!.root
		.findAll((node) => String(node.type) === "TabsScreen")
		.find((node) => node.props.name === "notifications");
	if (!screen) throw new Error("notifications タブが見つからない（テストの前提が壊れている）");
	return screen.props.options.href;
};

describe("#1092 通知タブの表示判定", () => {
	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		mockUser = null;
	});

	it("is_anonymous === undefined のログイン済みユーザーには通知タブを出す", () => {
		// 型上ありうる欠落。ここを「ゲスト」に倒すと、ログイン済みの人から通知機能が丸ごと消える
		expect(getNotificationsHref({})).toBeUndefined();
	});

	it("is_anonymous === false（ログイン済み）には通知タブを出す", () => {
		expect(getNotificationsHref({ is_anonymous: false })).toBeUndefined();
	});

	it("is_anonymous === true（ゲスト）には通知タブを出さない", () => {
		expect(getNotificationsHref({ is_anonymous: true })).toBeNull();
	});

	it("user === null（認証未確定）では通知タブを出さない", () => {
		// 「出てから消える」とタブ本数が 5→4 に変わりタブバー全体が再レイアウトするため、
		// 未確定はゲスト側へ倒す（出ない→出る の方が害が小さい）
		expect(getNotificationsHref(null)).toBeNull();
	});
});
