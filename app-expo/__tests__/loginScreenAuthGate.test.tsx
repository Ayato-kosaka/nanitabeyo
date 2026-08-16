// #1359 【設計】ログイン画面（app/[locale]/auth/login.tsx）の 2 つの不変条件を固定する。
//
// 1. auth が未確定（`isAuthResolved === false`）の間は **OAuth ボタンを描かない**。
//    モーダル時代はこれができず、「押しても何も起きない + Snackbar」と「昇格チェックボックスが
//    一瞬だけ出て消える」という 2 つの妥協が LoginForm 側に残っていた。画面になった今は待てる。
// 2. ログイン済み（`!isGuestUser(user)`）になったら `next` へ replace して離脱する。
//    #498（Android で OAuth 成功後もログイン UI が残る）に対する二重の防波堤で、
//    replace が二重に走らないことも併せて固定する。
//
// どちらも「実機でしか出ない経路の保険」なので、壊れても E2E では気付きにくい。
// ここが赤くなることが唯一の検知手段になる。
//
// `app/` 配下に置いたテストは expo-router がルートとして拾ってしまうため、ここに置いている
// （__tests__/localeLayoutFontGate.test.ts と同じ理由）。
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

let mockUser: { id: string; is_anonymous?: boolean } | null = null;
let mockIsAuthResolved = false;
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({ user: mockUser, isAuthResolved: mockIsAuthResolved }),
}));

let mockNext: string | undefined;
const mockReplace = jest.fn();
// ⚠️ `replace: mockReplace` と直接束縛しないこと。import 文は const 宣言より前へ巻き上げられるため、
// このファクトリが走る時点では mockReplace がまだ未初期化で `is not a function` になる。
// 呼び出し時に解決する形にして、宣言順に依存しないようにする
jest.mock("expo-router", () => ({
	router: {
		replace: (href: string) => mockReplace(href),
		back: () => {},
		canGoBack: () => false,
	},
	useLocalSearchParams: () => ({ next: mockNext }),
}));

jest.mock("react-native-safe-area-context", () => {
	const ReactActual = jest.requireActual("react");
	const { View } = jest.requireActual("react-native");
	return {
		useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
		SafeAreaView: ({ children }: { children: React.ReactNode }) => ReactActual.createElement(View, null, children),
	};
});

// Lottie / LinearGradient / アイコンは描画判定に関係しないので素の host 要素へ差し替える
jest.mock("lottie-react-native", () => "LottieView");
jest.mock("expo-linear-gradient", () => {
	const ReactActual = jest.requireActual("react");
	const { View } = jest.requireActual("react-native");
	return {
		LinearGradient: ({ children }: { children: React.ReactNode }) => ReactActual.createElement(View, null, children),
	};
});
jest.mock("lucide-react-native", () => ({ ChevronLeft: () => null }));

jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));

// LoginForm 自体の中身（OAuth ボタン・同意文言）はここでの関心ではない。
// 「描かれたか / 描かれていないか」だけを観測したいのでスタブに差し替える。
// ⚠️ ゲートを消すとこのスタブが描画されて下のテストが赤くなる、という向きで効かせている
const LOGIN_FORM_TEST_ID = "login-form-stub";
jest.mock("@/features/auth/components/LoginForm", () => {
	const { View } = jest.requireActual("react-native");
	const ReactActual = jest.requireActual("react");
	return { LoginForm: () => ReactActual.createElement(View, { testID: LOGIN_FORM_TEST_ID }) };
});

import LoginScreen from "../app/[locale]/auth/login";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const render = async () => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<LoginScreen />);
	});
	return tree;
};

/** 指定 testID の要素が描画されているか */
const has = (tree: TestRenderer.ReactTestRenderer, testID: string): boolean =>
	tree.root.findAll((node) => node.props?.testID === testID).length > 0;

beforeEach(() => {
	mockUser = null;
	mockIsAuthResolved = false;
	mockNext = undefined;
	mockReplace.mockClear();
});

describe("#1359 ログイン画面の auth ゲート", () => {
	it("auth 未確定の間は LoginForm（＝ OAuth ボタン）を描画しない", async () => {
		const tree = await render();

		expect(has(tree, LOGIN_FORM_TEST_ID)).toBe(false);
		// 戻る導線はゲートの外。待っている間も離脱できること
		expect(has(tree, "screen-header-back")).toBe(true);
	});

	it("auth が確定してゲストなら LoginForm を描画する", async () => {
		mockIsAuthResolved = true;
		mockUser = { id: "guest-1", is_anonymous: true };

		const tree = await render();

		expect(has(tree, LOGIN_FORM_TEST_ID)).toBe(true);
		expect(mockReplace).not.toHaveBeenCalled();
	});

	it("ログイン済みなら next へ replace して離脱する", async () => {
		mockIsAuthResolved = true;
		mockUser = { id: "user-1", is_anonymous: false };
		mockNext = "/ja-JP/review";

		await render();

		expect(mockReplace).toHaveBeenCalledTimes(1);
		expect(mockReplace).toHaveBeenCalledWith("/ja-JP/review");
	});

	it("next が外部 URL なら採用せずマイページへ倒す", async () => {
		mockIsAuthResolved = true;
		mockUser = { id: "user-1", is_anonymous: false };
		mockNext = "//evil.com";

		await render();

		expect(mockReplace).toHaveBeenCalledWith("/ja-JP/profile");
	});

	it("auth 未確定の間は user が null でも replace しない", async () => {
		mockIsAuthResolved = false;
		mockUser = null;
		mockNext = "/ja-JP/review";

		await render();

		expect(mockReplace).not.toHaveBeenCalled();
	});

	it("再レンダリングされても replace は 1 回だけ", async () => {
		mockIsAuthResolved = true;
		mockUser = { id: "user-1", is_anonymous: false };
		mockNext = "/ja-JP/review";

		const tree = await render();
		await act(async () => {
			// user オブジェクトの同一性が変わるだけの更新（AuthProvider が毎回作り直す形）
			mockUser = { id: "user-1", is_anonymous: false };
			tree.update(<LoginScreen />);
		});

		expect(mockReplace).toHaveBeenCalledTimes(1);
	});
});
