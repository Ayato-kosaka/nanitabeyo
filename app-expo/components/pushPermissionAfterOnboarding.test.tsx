/*
#1736 【バグ】オンボーディングの通知許可画面で «許可しない» と答えた直後、
PushTokenRegistration が要求をやり直して **説明の無い OS ダイアログをもう一度**出していた。

このコンポーネントの effect は「オンボーディングを抜けた瞬間」に張り直される
（`isOnboardingPath(pathname)` が依存にある）。Android 13+ の POST_NOTIFICATIONS は
`canAskAgain` が残っていれば再表示されるため、断った 1 秒後に同じダイアログが出る。

ここで固定するのは «この起動でオンボーディングが尋ねて断られていたら、要求しない» こと。
まだ尋ねていない人（既存ユーザー・オンボーディングを通らない言語 #642）の
唯一の要求機会は奪わない、も併せて固定する。
*/
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import * as Notifications from "expo-notifications";

import {
	__resetOnboardingPermissionOutcomesForTest,
	rememberOnboardingPermissionOutcome,
} from "@/features/onboarding/permissionOutcomes";

jest.mock("expo-notifications", () => ({
	getPermissionsAsync: jest.fn(),
	requestPermissionsAsync: jest.fn(),
	getExpoPushTokenAsync: jest.fn(),
	setNotificationChannelAsync: jest.fn(),
	AndroidImportance: { MAX: 5 },
}));
jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
// パスはオンボーディングの «外»（= 抜けた直後に effect が張り直された状態）
jest.mock("expo-router", () => ({ usePathname: () => "/ja-JP" }));
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ user: { id: "user-1", is_anonymous: false } }) }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { locale: "ja-JP", t: (key: string) => key } }));
jest.mock("@/constants/Env", () => ({
	Env: { NODE_ENV: "development", EAS_PROJECT_ID: "test", APP_VERSION: "1.0.0" },
}));
// 既読（= オンボーディングを完了して抜けてきた）
jest.mock("@/features/onboarding/onboardingSeenStore", () => ({ loadOnboardingSeen: () => Promise.resolve(true) }));

import { PushTokenRegistration } from "./PushTokenRegistration";

const mockedNotifications = Notifications as jest.Mocked<typeof Notifications>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const render = async () => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<PushTokenRegistration />);
	});
	return tree;
};

describe("オンボーディング直後の通知許可の再要求", () => {
	beforeEach(() => {
		__resetOnboardingPermissionOutcomesForTest();
		mockedNotifications.getPermissionsAsync.mockResolvedValue({ status: "denied" } as any);
		mockedNotifications.requestPermissionsAsync.mockResolvedValue({ status: "denied" } as any);
	});

	it("オンボーディングで断られていたら、OS へ要求し直さない", async () => {
		rememberOnboardingPermissionOutcome("notifications", "denied");

		const tree = await render();

		expect(mockedNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
		tree.unmount();
	});

	it("オンボーディングが尋ねていなければ、これまでどおり要求する", async () => {
		const tree = await render();

		expect(mockedNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
		tree.unmount();
	});
});
