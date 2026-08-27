/*
#1504 【設計】ハプティクスのトグルを «マイページ直置き» から «端末設定ページ» へ移した
（オーナー指示）。その移動で新しく生まれた結び目を固定する。

1. マイページの «端末設定» 行が `/[locale]/(tabs)/profile/device-settings` へ push すること。
   行き先は文字列でしかなく、綴りを間違えても型検査は通る（typed routes は locale や
   «どのルートを選んだか» までは意味を見ない。profileEditRoute.test.tsx と同じ理由）。
2. マイページ本体にトグルが «戻っていない» こと。
   ここが赤くなったら、押すと画面が開く行と押すと値が変わる行がまた混ざっている。
3. 端末設定ページのトグルが hapticsSettingsStore へ書き、履歴の有無に応じて離脱すること。

⚠️ 「オフのとき expo-haptics を呼ばない」ことはこのファイルの担当ではない
   （hooks/useHaptics.test.tsx が持つ）。ここが見るのは «UI と store の結線» だけ。

`app/` 配下に置いたテストは expo-router がルートとして拾ってしまうため、ここに置いている
（profileEditRoute.test.tsx と同じ理由）。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = true;
// ⚠️ スタブ本体をファクトリの «外» に置かないこと（profileEditRoute.test.tsx と同じ巻き上げの注意）
jest.mock("expo-router", () => {
	const stub = {
		push: (href: unknown) => mockPush(href),
		replace: (href: unknown) => mockReplace(href),
		back: () => mockBack(),
		canGoBack: () => mockCanGoBack,
		canDismiss: () => false,
	};
	return {
		router: stub,
		useRouter: () => stub,
		useLocalSearchParams: () => ({}),
		useGlobalSearchParams: () => ({}),
	};
});

jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({ user: { id: "user-1", is_anonymous: false }, isAuthResolved: true, logout: jest.fn() }),
}));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
const mockLightImpact = jest.fn();
jest.mock("@/hooks/useHaptics", () => {
	const mediumImpact = jest.fn();
	return { useHaptics: () => ({ lightImpact: mockLightImpact, mediumImpact }) };
});
const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: () => {} }));
jest.mock("@/contexts/DialogProvider", () => ({
	useDialog: () => ({ showDialog: jest.fn(), confirm: jest.fn().mockResolvedValue(false) }),
}));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
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

// 描画判定に関係しない外部依存を素の host 要素へ落とす
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

// AsyncStorage への書き込みそのものは hooks/useHaptics.test.tsx が見ている。
// ここで見たいのは «トグルを押したら store の書き手が呼ばれるか» なので、store は器へ潰す
const mockSetHapticsEnabled = jest.fn();
let mockHapticsEnabled = true;
jest.mock("@/features/settings/hapticsSettingsStore", () => ({
	setHapticsEnabled: (next: boolean) => mockSetHapticsEnabled(next),
}));
jest.mock("@/features/settings/hooks/useHapticsEnabled", () => ({
	useHapticsEnabled: () => mockHapticsEnabled,
}));

import ProfileScreen from "../app/[locale]/(tabs)/profile/index";
import DeviceSettingsScreen from "../app/[locale]/(tabs)/profile/device-settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ⚠️ 描画したツリーは必ず unmount すること（テスト終了後の setState と環境破棄の競合を避ける）
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
指定 testID の «押せる» 要素を押す。

⚠️ `root.find(testID 一致)` で済ませないこと。同じ testID は composite（ProfileMenuItem /
SettingsToggleItem）と TouchableOpacity と host View の 6 段に乗る。
`SettingsToggleItem` の composite が持つのは `onValueChange` であって `onPress` ではないため、
先頭を掴むと «onPress is not a function» で落ちる。onPress を持つ最初の段（TouchableOpacity）を選ぶ。
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

/** 指定 testID の要素が描かれているか */
const exists = (tree: TestRenderer.ReactTestRenderer, testID: string): boolean =>
	tree.root.findAll((node) => node.props?.testID === testID).length > 0;

beforeEach(() => {
	mockPush.mockClear();
	mockReplace.mockClear();
	mockBack.mockClear();
	mockLightImpact.mockClear();
	mockSetHapticsEnabled.mockClear();
	mockCanGoBack = true;
	mockHapticsEnabled = true;
});

describe("#1504 マイページから端末設定への導線", () => {
	it("「端末設定」行は device-settings ルートへ locale 付きで push する", async () => {
		const tree = await render(<ProfileScreen />);

		await press(tree, "settings-device-settings");

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/profile/device-settings",
			params: { locale: "ja-JP" },
		});
	});

	/*
	オーナー指示の «規約ボックスの上» を «行の並び» として固定する。

	testID だけを見ていると「描かれてはいるが規約の下にいる」を見逃す。
	描画順そのものを比べれば、カードをまたいで下へ移動しても赤くなる。

	#1583 規約 4 行そのものは «なに食べよについて»（about.tsx）へ移ったので、
	比較対象をその入口の行（settings-about）へ付け替えた。守りたい性質
	«端末設定は規約の箱より上» は変わっていない。
	*/
	it("「端末設定」行は «なに食べよについて»（規約の置き場）より前に描かれる", async () => {
		const tree = await render(<ProfileScreen />);

		const order = tree.root
			.findAll((node) => typeof node.props?.testID === "string" && node.props.testID.startsWith("settings-"))
			.map((node) => node.props.testID as string);

		expect(order.indexOf("settings-device-settings")).toBeGreaterThanOrEqual(0);
		expect(order.indexOf("settings-about")).toBeGreaterThanOrEqual(0);
		expect(order.indexOf("settings-device-settings")).toBeLessThan(order.indexOf("settings-about"));
	});

	// ⚠️ ここが赤くなったら、トグルがマイページ本体へ戻っている（#1504 のオーナー指示の差し戻し）
	it("マイページ本体はハプティクスのトグルを描かない", async () => {
		const tree = await render(<ProfileScreen />);

		expect(exists(tree, "settings-haptics-toggle")).toBe(false);
	});
});

describe("#1504 端末設定ページ", () => {
	it("ハプティクスのトグルを描く", async () => {
		const tree = await render(<DeviceSettingsScreen />);

		expect(exists(tree, "settings-haptics-toggle")).toBe(true);
	});

	/*
	#1583 表示テーマ（SET-05）の置き場所。#1504 の設計コメントが
	«今後 SET-05(ダークモード) もこのカードに並ぶ» として最初から用意していた場所である。
	オーナー承認済み（2026-08-25「表示テーマは 端末設定に移して大丈夫ですよ」）。
	*/
	it("#1583 表示テーマの 3 択を描く", async () => {
		const tree = await render(<DeviceSettingsScreen />);

		expect(exists(tree, "settings-theme-selector")).toBe(true);
		for (const option of ["system", "light", "dark"]) {
			expect(exists(tree, `settings-theme-${option}`)).toBe(true);
		}
	});

	// ⚠️ ここが赤くなったら、テーマがマイページ本体へ戻っている（#1583 の差し戻し）
	it("#1583 マイページ本体は表示テーマを描かない", async () => {
		const tree = await render(<ProfileScreen />);

		expect(exists(tree, "settings-theme-selector")).toBe(false);
	});

	it("トグルを押すと store へ反転した値を書く", async () => {
		const tree = await render(<DeviceSettingsScreen />);

		await press(tree, "settings-haptics-toggle");

		expect(mockSetHapticsEnabled).toHaveBeenCalledTimes(1);
		expect(mockSetHapticsEnabled).toHaveBeenCalledWith(false);
	});

	/*
	オフへ切り替えたのに振動が鳴ると «切ったつもりが切れていない» ように見える。
	確認の触覚はオンにしたときだけ返す（device-settings.tsx の設計コメント）。
	*/
	it("オフへ切り替えたときは確認の触覚を鳴らさない", async () => {
		const tree = await render(<DeviceSettingsScreen />);

		await press(tree, "settings-haptics-toggle");

		expect(mockLightImpact).not.toHaveBeenCalled();
	});

	it("オンへ戻したときは確認の触覚を鳴らす", async () => {
		mockHapticsEnabled = false;
		const tree = await render(<DeviceSettingsScreen />);

		await press(tree, "settings-haptics-toggle");

		expect(mockSetHapticsEnabled).toHaveBeenCalledWith(true);
		expect(mockLightImpact).toHaveBeenCalledTimes(1);
	});

	it("戻るを押すと、履歴があれば back で戻る", async () => {
		mockCanGoBack = true;
		const tree = await render(<DeviceSettingsScreen />);

		await press(tree, "device-settings-screen-back");

		expect(mockBack).toHaveBeenCalledTimes(1);
		expect(mockReplace).not.toHaveBeenCalled();
	});

	// URL 直リンク・web のリロードで着地した場合。back すると «アプリの外» へ出てしまう
	it("戻るを押したとき履歴が無ければマイページへ replace する", async () => {
		mockCanGoBack = false;
		const tree = await render(<DeviceSettingsScreen />);

		await press(tree, "device-settings-screen-back");

		expect(mockBack).not.toHaveBeenCalled();
		expect(mockReplace).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/profile",
			params: { locale: "ja-JP" },
		});
	});
});
