/*
#1511 ACC-01 «アカウントを削除» の行が **マイページに存在すること** を固定する。

## なぜこのテストが要るのか（実際に消えた）

#1533 はこの導線を旧設定画面 `app/[locale]/(tabs)/profile/settings.tsx` へ足した。
その後 #1375 の最終同期（e4ee0369）が旧設定画面ごとファイルを削除したため、
**main では `settings-delete-account` が app-expo のどこにも存在しない**状態になった。

そのとき緑のままだったもの:
  - API（`DELETE /v1/users/me`）… 実装も spec もある
  - i18n（`Settings.deleteAccount*` 11 キー × 8 ロケール）… 全部ある
  - e2e-web / e2e-mobile の «匿名には出さない» テスト … **存在しないので当然通る**
  - 撮影シナリオ `account-delete-1511.mjs` … 走らせなければ落ちない

«出ること» を見ていたのは `tests/authenticated/` の 2 本だけで、あれは実アカウントが要る
tier なので既定のフィルタに乗らない。結果、**ボタンだけ無いのに全部緑**になった（#1375 と同じ形）。

このファイルは jest（= pr-check.yml で必ず走る）で «出ること» を見る。
実機を待たずに、押せる行がそこに在ることをここで落とす。

⚠️ 削除の «中身»（二段確認・API 呼び出し・冪等性）はここの担当ではない。
   あれは `api/src/v1/users/users.service.delete-me.spec.ts` と
   e2e-web / e2e-mobile の `tests/authenticated/account-delete` が持つ。
   ここが守るのは «ユーザーがその行に到達できること» の 1 点だけ。

`app/` 配下に置くと expo-router がルートとして拾うため、ここに置いている
（deviceSettingsRoute.test.tsx と同じ理由）。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockPush = jest.fn();
jest.mock("expo-router", () => {
	const stub = {
		push: (href: unknown) => mockPush(href),
		replace: jest.fn(),
		back: jest.fn(),
		canGoBack: () => true,
		canDismiss: () => false,
	};
	return {
		router: stub,
		useRouter: () => stub,
		useLocalSearchParams: () => ({}),
		useGlobalSearchParams: () => ({}),
	};
});

// ⚠️ ゲスト/ログイン済みを切り替えるので、AuthProvider のスタブは «可変» にする。
//    `is_anonymous` が `isGuestUser`（lib/authGuest.ts）の判定材料。
let mockUser: { id: string; is_anonymous: boolean } | null = { id: "user-1", is_anonymous: false };
const mockLogout = jest.fn();
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({ user: mockUser, isAuthResolved: true, logout: mockLogout }),
}));

jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }),
}));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: () => {} }));

// 二段確認の «2 枚とも OK» を返させて、削除 API が呼ばれるところまで見る
const mockConfirm = jest.fn();
jest.mock("@/contexts/DialogProvider", () => ({
	useDialog: () => ({ showDialog: jest.fn(), confirm: mockConfirm }),
}));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

jest.mock("react-native-safe-area-context", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
		useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 800 }),
		SafeAreaView: ({ children }: { children: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
	};
});

jest.mock("expo-image", () => ({ Image: "Image" }));
jest.mock("lottie-react-native", () => "LottieView");
jest.mock("expo-linear-gradient", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		LinearGradient: ({ children }: { children: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
	};
});
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

jest.mock("@/features/profile/components/ProfileHeader", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return { ProfileHeader: () => ReactActual.createElement(RNView, { testID: "profile-header" }) };
});
jest.mock("@/features/profile/hooks/useEnsureOwnProfileLoaded", () => ({
	useEnsureOwnProfileLoaded: () => ({ isProfileResolved: true, hasLoadFailed: false, retry: jest.fn() }),
}));
jest.mock("@/features/profile/stores/useProfileStore", () => ({
	useProfileStore: (selector: (state: { profile: unknown }) => unknown) =>
		selector({ profile: { id: "profile-1", username: "tester" } }),
}));

import ProfileScreen from "../app/[locale]/(tabs)/profile/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
const render = async (element: React.ReactElement) => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(element);
	});
	mountedTrees.push(tree);
	return tree;
};

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

/*
⚠️ `root.find(testID 一致)` で済ませないこと。同じ testID は composite（SettingsMenuItem）と
TouchableOpacity と host View の複数段に乗る。onPress を持つ段を選ぶ。
*/
const press = async (tree: TestRenderer.ReactTestRenderer, testID: string): Promise<void> => {
	const [target] = tree.root.findAll(
		(node) => node.props?.testID === testID && typeof node.props?.onPress === "function",
	);
	if (!target) throw new Error(`押せる要素が見つからない: ${testID}`);
	await act(async () => {
		await target.props.onPress();
	});
};

const exists = (tree: TestRenderer.ReactTestRenderer, testID: string): boolean =>
	tree.root.findAll((node) => node.props?.testID === testID).length > 0;

beforeEach(() => {
	mockPush.mockClear();
	mockConfirm.mockReset();
	mockCallBackend.mockReset();
	mockLogout.mockReset();
	mockUser = { id: "user-1", is_anonymous: false };
});

describe("#1511 マイページのアカウント削除導線", () => {
	// ここが赤くなったら «削除ボタンがアプリのどこにも無い» 状態に戻っている
	it("ログイン済みならアカウント削除の行がマイページに存在する", async () => {
		const tree = await render(<ProfileScreen />);

		expect(exists(tree, "settings-delete-account")).toBe(true);
	});

	it("匿名（ゲスト）にはアカウント削除の行を出さない", async () => {
		mockUser = { id: "guest-1", is_anonymous: true };

		const tree = await render(<ProfileScreen />);

		// ログアウト行も出ないことを併せて見る。ここを見ないと
		// «まだ auth が解決していないから出ていないだけ» と区別が付かない
		expect(exists(tree, "settings-delete-account")).toBe(false);
		expect(exists(tree, "settings-logout")).toBe(false);
	});

	it("二段の確認をどちらも通すと DELETE /v1/users/me を 1 度だけ呼ぶ", async () => {
		mockConfirm.mockResolvedValue(true);
		mockCallBackend.mockResolvedValue({});
		const tree = await render(<ProfileScreen />);

		await press(tree, "settings-delete-account");

		expect(mockConfirm).toHaveBeenCalledTimes(2);
		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(mockCallBackend).toHaveBeenCalledWith("/v1/users/me", {
			method: "DELETE",
			requestPayload: {},
		});
	});

	// 1 枚目で止めたら何も起きない。«説明を読んで止める» が効かないと取り返しがつかない
	it("1 枚目の確認をキャンセルすると 2 枚目も API 呼び出しも起きない", async () => {
		mockConfirm.mockResolvedValue(false);
		const tree = await render(<ProfileScreen />);

		await press(tree, "settings-delete-account");

		expect(mockConfirm).toHaveBeenCalledTimes(1);
		expect(mockCallBackend).not.toHaveBeenCalled();
	});

	// 2 枚目だけ拒否する。«取り消せないことへの同意» が最後の砦なので独立して見る
	it("2 枚目の確認をキャンセルすると API 呼び出しは起きない", async () => {
		mockConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
		const tree = await render(<ProfileScreen />);

		await press(tree, "settings-delete-account");

		expect(mockConfirm).toHaveBeenCalledTimes(2);
		expect(mockCallBackend).not.toHaveBeenCalled();
	});
});
