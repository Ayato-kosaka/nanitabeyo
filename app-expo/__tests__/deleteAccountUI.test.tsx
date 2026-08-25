// #1596 アカウント削除UIのテスト
//
// 1. 2段階の確認を両方通さないと DELETE v1/users/me が飛ばないこと
// 2. 連打しても API が 1 回しか呼ばれないこと
// 3. 失敗時にログアウトしないこと

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
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({
		logout: mockLogout,
		user: { id: "user-1", is_anonymous: false },
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
