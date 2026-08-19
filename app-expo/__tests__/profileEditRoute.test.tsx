/*
#1369 【設計】プロフィール編集の «ルート化» で新しく生まれた 2 つの結び目を固定する。

1. マイページの「プロフィールを編集」が `/[locale]/(tabs)/profile/edit` へ push すること。
   モーダル時代はここが `open()` で、押した先は型でも E2E でも表現されていなかった。
   ルートになると行き先は文字列になり、**間違えても型検査を通る**（typed routes は
   pathname の綴りは見るが、locale や «どのルートを選んだか» までは意味を見ない）。
2. 編集画面が「保存できたとき」と「戻るを押したとき」の両方で、履歴の有無に応じて
   `router.back()` / `router.replace()` を呼び分けること。
   `?next=` を持たないこの画面には lib/authNext.ts の判定を持ち込まないと決めた（設計は
   edit.tsx のコメント）ので、その分岐を守るのはここだけになる。

`app/` 配下に置いたテストは expo-router がルートとして拾ってしまうため、ここに置いている
（__tests__/loginScreenAuthGate.test.tsx と同じ理由）。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = false;
// ⚠️ スタブ本体をファクトリの «外» に置かないこと。import 文はこのファイルの const 宣言より前へ
// 巻き上げられるため、ファクトリが走る時点では外の変数がまだ undefined になる。
// 中身の参照は «呼び出し時» に解決されるので問題ない（loginEntryPoints.test.tsx と同じ注意）
jest.mock("expo-router", () => {
	const stub = {
		push: (href: unknown) => mockPush(href),
		replace: (href: unknown) => mockReplace(href),
		back: () => mockBack(),
		canGoBack: () => mockCanGoBack,
	};
	return {
		router: stub,
		useRouter: () => stub,
		useLocalSearchParams: () => ({}),
		useGlobalSearchParams: () => ({}),
	};
});

jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({ user: { id: "user-1", is_anonymous: false }, isAuthResolved: true }),
}));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }),
}));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
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

// collapsible tabs は「ヘッダーを描く器」としてだけ必要。renderHeader を同期的に呼ぶ形へ潰す
jest.mock("@/components/collapsible-tabs", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		Tabs: {
			Container: ({ renderHeader, children }: { renderHeader?: () => React.ReactNode; children?: React.ReactNode }) =>
				ReactActual.createElement(RNView, null, renderHeader?.(), children),
			Tab: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
			FlatList: () => null,
			ScrollView: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(RNView, null, children),
		},
	};
});

// 編集ボタンは ProfileHeader が描く。見たいのは「ProfileTabsLayout が onEditProfile に何をさせたか」
// なので、ヘッダーはそのハンドラだけを露出する器へ潰す
// （testID とボタンの結線は e2e が見ている）
jest.mock("@/features/profile/components/ProfileHeader", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		ProfileHeader: ({ onEditProfile }: { onEditProfile?: () => void }) =>
			ReactActual.createElement(RNView, { testID: "profile-edit-button", onPress: onEditProfile }),
	};
});
jest.mock("@/features/profile/components/ProfileTabsBar", () => ({ ProfileTabsBar: () => null }));
jest.mock("@/features/profile/tabs/ReviewTab", () => ({ ReviewTab: () => null }));
jest.mock("@/features/profile/tabs/LikeTab", () => ({ LikeTab: () => null }));
jest.mock("@/features/profile/tabs/SavedPostsTab", () => ({ SavedPostsTab: () => null }));
jest.mock("@/features/profile/tabs/SavedTopicsTab", () => ({ SavedTopicsTab: () => null }));
jest.mock("@/features/profile/hooks/useEnsureOwnProfileLoaded", () => ({
	useEnsureOwnProfileLoaded: () => ({ isProfileResolved: true }),
}));
// プロフィールの «有無» で編集画面の描画が変わる（下の「未ロードの間は…」のテスト）ので差し替え可能にする
let mockProfile: unknown = { id: "profile-1", username: "tester" };
jest.mock("@/features/profile/stores/useProfileStore", () => ({
	useProfileStore: (selector: (state: { profile: unknown }) => unknown) => selector({ profile: mockProfile }),
}));

// フォームの中身（バリデーション・アップロード・API）は ProfileEditForm の関心。
// ここで見たいのは「保存できたとき画面がどう離脱するか」だけなので、
// onSaved を押せる形にした器へ差し替える
jest.mock("@/features/profile/components/ProfileEditForm", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		ProfileEditForm: ({ onSaved }: { onSaved: () => void }) =>
			ReactActual.createElement(RNView, { testID: "profile-edit-form-saved", onPress: onSaved }),
	};
});

import { ProfileTabsLayout } from "@/features/profile/containers/ProfileTabsLayout";
import ProfileEditScreen from "../app/[locale]/(tabs)/profile/edit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ⚠️ 描画したツリーは必ず unmount すること。ProfileTabsLayout は ?tab= 指定があると
// jumpToTab のリトライ（setInterval / #1272）を回し、その cleanup は unmount でしか走らない
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

/** 指定 testID の要素を押す */
const press = async (tree: TestRenderer.ReactTestRenderer, testID: string): Promise<void> => {
	const target = tree.root.find((node) => node.props?.testID === testID);
	await act(async () => {
		await target.props.onPress();
	});
};

beforeEach(() => {
	mockProfile = { id: "profile-1", username: "tester" };
	mockPush.mockClear();
	mockReplace.mockClear();
	mockBack.mockClear();
	mockCanGoBack = false;
});

describe("#1369 マイページから編集画面への導線", () => {
	it("「プロフィールを編集」は編集ルートへ locale 付きで push する", async () => {
		const tree = await render(<ProfileTabsLayout />);

		await press(tree, "profile-edit-button");

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/profile/edit",
			params: { locale: "ja-JP" },
		});
	});
});

describe("#1369 プロフィール編集画面の離脱", () => {
	it("戻るを押すと、履歴があれば back で戻る", async () => {
		mockCanGoBack = true;
		const tree = await render(<ProfileEditScreen />);

		await press(tree, "screen-header-back");

		expect(mockBack).toHaveBeenCalledTimes(1);
		expect(mockReplace).not.toHaveBeenCalled();
	});

	it("戻るを押したとき履歴が無ければマイページへ replace する", async () => {
		mockCanGoBack = false;
		const tree = await render(<ProfileEditScreen />);

		await press(tree, "screen-header-back");

		// URL 直リンク・web のリロードで着地した場合。back すると «アプリの外» へ出てしまう
		expect(mockBack).not.toHaveBeenCalled();
		expect(mockReplace).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/profile",
			params: { locale: "ja-JP" },
		});
	});

	it("保存が成功したら、戻ると同じ判定で離脱する", async () => {
		mockCanGoBack = true;
		const tree = await render(<ProfileEditScreen />);

		await press(tree, "profile-edit-form-saved");

		// モーダル時代の `close()` に相当する。保存したのに画面が残る（#498 型）を作らない
		expect(mockBack).toHaveBeenCalledTimes(1);
	});

	it("プロフィールが未ロードの間はフォームを描かない（戻る導線は残す）", async () => {
		// ProfileEditForm は初期値を mount 時に 1 回だけ読む。空のまま mount すると
		// 後から profile が届いても表示名・自己紹介が空欄のままになる
		mockProfile = null;
		const tree = await render(<ProfileEditScreen />);

		expect(tree.root.findAll((node) => node.props?.testID === "profile-edit-form-saved")).toHaveLength(0);
		// 待っている間も離脱できること（ゲートの外にヘッダーがある）
		expect(tree.root.findAll((node) => node.props?.testID === "screen-header-back").length).toBeGreaterThan(0);
	});

	it("保存が成功したとき履歴が無ければマイページへ replace する", async () => {
		mockCanGoBack = false;
		const tree = await render(<ProfileEditScreen />);

		await press(tree, "profile-edit-form-saved");

		expect(mockReplace).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/profile",
			params: { locale: "ja-JP" },
		});
	});
});
