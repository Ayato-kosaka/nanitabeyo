// #1596 アカウント削除UIのテスト
//
// 1. 2段階の確認を両方通さないと DELETE v1/users/me が飛ばないこと
// 2. 連打しても API が 1 回しか呼ばれないこと
// 3. 失敗時にログアウトしないこと
// 4. #1511 ログイン済みなら行が «存在する» こと / 匿名には «出さない» こと（#1583 で追加）
//
// 4 を足した理由:
// この画面の削除行は一度 main から **丸ごと消えていた**。#1533 が旧設定画面 profile/settings.tsx
// へ置き、#1375 の最終同期（e4ee0369）がその画面ごとファイルを消したためで、API も i18n 11 キー
// × 8 ロケールも E2E も揃っているのに押すボタンだけが無い状態だった。
//
// 1〜3 は findByProps で行を掴むので «消えたら赤くなる» のは同じだが、落ちたときに
// 「導線が無い」のか「導線の挙動が壊れた」のかが読み取れない。4 はその 1 点だけを名指しで見る。
//
// 匿名側を見るのは #1511 の仕様（ゲストには users 行が無く API も AuthUserGuard で 403）。
// ログアウト行の不在と対で見ているのは、«まだ auth が解決していないから出ていないだけ» と
// 区別を付けるため。

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

jest.mock("@expo/vector-icons", () => ({
	FontAwesome: function MockFontAwesome() {
		return null;
	},
}));

jest.mock("expo-linear-gradient", () => ({
	LinearGradient: function MockLinearGradient({ children }: { children: React.ReactNode }) {
		return children;
	},
}));

jest.mock("react-native-safe-area-context", () => ({
	SafeAreaView: function MockSafeAreaView({ children }: { children: React.ReactNode }) {
		return children;
	},
}));

jest.mock("expo-router", () => ({
	useRouter: () => ({ push: jest.fn() }),
}));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }),
}));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: jest.fn() }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

const mockConfirm = jest.fn();
jest.mock("@/contexts/DialogProvider", () => ({
	useDialog: () => ({ showDialog: jest.fn(), confirm: mockConfirm }),
}));

const mockShowSnackbar = jest.fn();
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));

const mockLogout = jest.fn();
// ⚠️ ゲスト / ログイン済みを切り替えるため «可変» にしてある。`is_anonymous` が
//    isGuestUser（lib/authGuest.ts）の判定材料。
let mockUser: { id: string; is_anonymous: boolean } | null = { id: "user-1", is_anonymous: false };
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({
		logout: mockLogout,
		user: mockUser,
		isAuthResolved: true,
	}),
}));

jest.mock("@/contexts/ThemeProvider", () => ({
	useAppTheme: () => ({
		colors: {
			backgroundGradient: ["#fff", "#fff"],
			destructive: "#ff0000",
			text: "#000",
			textSecondary: "#666",
			border: "#ccc",
			surface: "#fff",
			primary: "#007aff",
		},
	}),
	useThemedStyles: (factory: (c: unknown) => unknown) =>
		factory({
			backgroundGradient: ["#fff", "#fff"],
			destructive: "#ff0000",
			text: "#000",
			textSecondary: "#666",
			border: "#ccc",
			surface: "#fff",
			primary: "#007aff",
		}),
	THEME_PREFERENCES: ["system", "light", "dark"],
}));

jest.mock("@/features/profile/hooks/useEnsureOwnProfileLoaded", () => ({
	useEnsureOwnProfileLoaded: jest.fn(),
}));

jest.mock("@/features/profile/stores/useProfileStore", () => ({
	useProfileStore: () => ({
		displayName: "Test User",
		profileImageUri: null,
	}),
}));

jest.mock("@/components/Card", () => ({
	Card: function MockCard({ children }: { children: React.ReactNode }) {
		return children;
	},
}));

jest.mock("@/components/LoadingIndicator", () => ({
	LoadingIndicator: function MockLoadingIndicator() {
		return null;
	},
}));

jest.mock("@/components/VersionInfo", () => ({
	VersionInfo: function MockVersionInfo() {
		return null;
	},
}));

jest.mock("@/features/profile/components/ProfileHeader", () => ({
	ProfileHeader: function MockProfileHeader() {
		return null;
	},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import ProfileScreen from "../app/[locale]/(tabs)/profile/index";

describe("deleteAccountUI", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockUser = { id: "user-1", is_anonymous: false };
	});

	/** 指定 testID の要素が描かれているか（存在しなくても throw しない） */
	const exists = (tree: TestRenderer.ReactTestRenderer, testID: string): boolean =>
		tree.root.findAll((node) => node.props?.testID === testID).length > 0;

	// ここが赤くなったら «削除ボタンがアプリのどこにも無い» 状態に戻っている
	it("#1511 ログイン済みならアカウント削除の行がマイページに存在する", async () => {
		let renderer: TestRenderer.ReactTestRenderer | undefined;
		await act(async () => {
			renderer = TestRenderer.create(<ProfileScreen />);
		});

		expect(exists(renderer!, "settings-delete-account")).toBe(true);
	});

	it("#1511 匿名（ゲスト）にはアカウント削除の行を出さない", async () => {
		mockUser = { id: "guest-1", is_anonymous: true };

		let renderer: TestRenderer.ReactTestRenderer | undefined;
		await act(async () => {
			renderer = TestRenderer.create(<ProfileScreen />);
		});

		expect(exists(renderer!, "settings-delete-account")).toBe(false);
		expect(exists(renderer!, "settings-logout")).toBe(false);
	});

	it("2段階の確認を両方通さないと DELETE v1/users/me が飛ばない (step1でキャンセル)", async () => {
		mockConfirm.mockResolvedValueOnce(false);

		let renderer: TestRenderer.ReactTestRenderer | undefined;
		await act(async () => {
			renderer = TestRenderer.create(<ProfileScreen />);
		});

		const deleteButton = renderer!.root.findByProps({ testID: "settings-delete-account" });
		await act(async () => {
			await deleteButton.props.onPress();
		});

		expect(mockConfirm).toHaveBeenCalledTimes(1);
		expect(mockCallBackend).not.toHaveBeenCalled();
		expect(mockLogout).not.toHaveBeenCalled();
	});

	it("2段階の確認を両方通さないと DELETE v1/users/me が飛ばない (step2でキャンセル)", async () => {
		mockConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

		let renderer: TestRenderer.ReactTestRenderer | undefined;
		await act(async () => {
			renderer = TestRenderer.create(<ProfileScreen />);
		});

		const deleteButton = renderer!.root.findByProps({ testID: "settings-delete-account" });
		await act(async () => {
			await deleteButton.props.onPress();
		});

		expect(mockConfirm).toHaveBeenCalledTimes(2);
		expect(mockCallBackend).not.toHaveBeenCalled();
		expect(mockLogout).not.toHaveBeenCalled();
	});

	it("2段階の確認を両方通すと DELETE v1/users/me が飛ぶ", async () => {
		mockConfirm.mockResolvedValue(true);
		mockCallBackend.mockResolvedValue({});

		let renderer: TestRenderer.ReactTestRenderer | undefined;
		await act(async () => {
			renderer = TestRenderer.create(<ProfileScreen />);
		});

		const deleteButton = renderer!.root.findByProps({ testID: "settings-delete-account" });
		await act(async () => {
			await deleteButton.props.onPress();
		});

		expect(mockConfirm).toHaveBeenCalledTimes(2);
		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(mockCallBackend).toHaveBeenCalledWith("v1/users/me", {
			method: "DELETE",
			requestPayload: {},
		});
		expect(mockLogout).toHaveBeenCalledWith({ scope: "local" });
	});

	it("連打しても API が 1 回しか呼ばれない", async () => {
		mockConfirm.mockResolvedValue(true);
		let resolveBackend: () => void;
		mockCallBackend.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveBackend = resolve;
				}),
		);

		let renderer: TestRenderer.ReactTestRenderer | undefined;
		await act(async () => {
			renderer = TestRenderer.create(<ProfileScreen />);
		});

		const deleteButton = renderer!.root.findByProps({ testID: "settings-delete-account" });

		await act(async () => {
			deleteButton.props.onPress();
		});

		await act(async () => {
			deleteButton.props.onPress();
		});

		await act(async () => {
			deleteButton.props.onPress();
		});

		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		await act(async () => {
			resolveBackend!();
		});
	});

	it("失敗時にログアウトしない", async () => {
		mockConfirm.mockResolvedValue(true);
		mockCallBackend.mockRejectedValue(new Error("Network error"));

		let renderer: TestRenderer.ReactTestRenderer | undefined;
		await act(async () => {
			renderer = TestRenderer.create(<ProfileScreen />);
		});

		const deleteButton = renderer!.root.findByProps({ testID: "settings-delete-account" });
		await act(async () => {
			await deleteButton.props.onPress();
		});

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(mockLogout).not.toHaveBeenCalled();
		expect(mockShowSnackbar).toHaveBeenCalledWith("Settings.deleteAccountError");
	});
});
