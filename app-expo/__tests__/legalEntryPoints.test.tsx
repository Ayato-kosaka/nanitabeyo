/*
#1368 【設計】法務ドキュメントの導線が «同じルートへ、正しい doc を付けて» push することと、
ルート側が不正な `doc` を既定の文書へ倒さないことを固定する。

## なぜ必要か（#1359 PR2 のレビューで学んだこと）
push の «引数» を見ているのは Playwright / Detox だけ、という状態は簡単に作れてしまう。
実際 #1359 では 4 箇所の `next` を全部書き換えても jest は 532 件すべて緑のままだった
（`__tests__/loginEntryPoints.test.tsx` 冒頭）。設定画面の 4 行はどれも同じ関数を通るので、
`doc` の取り違え（規約を押したらプライバシーポリシーが開く）は誰にも気付かれずに入りうる。

## portal 問題（#1364）をここでどう扱うか
`Portal.Host` は `<Stack>` を包んでいる（app/[locale]/_layout.tsx）ので、**BlurModal を開いたまま
ルートへ push すると遷移先は portal の下に潜って見えず触れない**。地図の店詳細（#1364）は
«閉じてから push» の «順序» を固定することでこれを防いだ。

一方 #1368 で移した 2 箇所は、押した時点で開いている BlurModal を 1 つも持たない
（LoginForm は /auth/login ルートの中身、settings はルートそのもの）。つまり守るべき不変条件は
「順序」ではなく **「この 2 画面は portal を一切持たない」** ことである。
そこで `useBlurModal` のスタブを «呼ばれたら記録する» 形にして、レンダー〜押下の間に
1 度も呼ばれないことを固定する。将来この UI を再びオーバーレイの中へ入れる変更が入れば、
`useBlurModal` の呼び出しが復活した時点でここが赤くなる。

## 方針
各導線の «押した先» だけを観測したいので、周辺（画像・下位コンポーネント・Markdown）は
すべてスタブへ差し替える。testID とボタンの結線そのものは E2E が見ている。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = true;
let mockLocalParams: Record<string, unknown> = {};

// ⚠️ スタブ本体をファクトリの «外» に置かないこと（loginEntryPoints.test.tsx と同じ注意）。
// import 文は const 宣言より前へ巻き上げられるため、ファクトリ実行時には外の変数がまだ undefined
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
		useLocalSearchParams: () => mockLocalParams,
		useGlobalSearchParams: () => ({}),
	};
});

jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({ user: { id: "guest-1", is_anonymous: true }, isAuthResolved: true }),
}));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }),
}));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: () => {} }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
jest.mock("@/contexts/DialogProvider", () => ({
	useDialog: () => ({ showDialog: jest.fn(), confirm: jest.fn() }),
}));

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
// Markdown の描画はこのテストの関心外（本文が差し替わっていないことは legalRoute.test.ts が見る）。
// jest.config.js の transformIgnorePatterns の許可リストにも入っていないため、素の host 要素へ潰す
jest.mock("react-native-markdown-display", () => "Markdown");

/**
 * useBlurModal のスタブ。
 *
 * ⚠️ 呼ばれたこと «自体» が検証対象。#1368 で移した 2 画面は portal を 1 つも持たない前提で
 * «閉じてから push» を省いているので、ここが呼ばれ始めたら前提が崩れている（冒頭のコメント参照）。
 */
const mockUseBlurModal = jest.fn();
jest.mock("@/features/blurModal/hooks/useBlurModal", () => ({
	useBlurModal: () => {
		mockUseBlurModal();
		return { BlurModal: () => null, open: jest.fn(), close: jest.fn(), visible: false };
	},
}));

import { LoginForm } from "@/features/auth/components/LoginForm";
import SettingsScreen from "../app/[locale]/(tabs)/profile/settings";
import LegalDocumentScreen from "../app/[locale]/legal/[doc]";
import { LEGAL_DOCUMENT_TYPES } from "@/lib/legalRoute";

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

/** 指定 testID の要素を押す */
const press = async (tree: TestRenderer.ReactTestRenderer, testID: string): Promise<void> => {
	const target = tree.root.find((node) => node.props?.testID === testID);
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
	mockUseBlurModal.mockClear();
	mockCanGoBack = true;
	mockLocalParams = {};
});

describe("#1368 設定画面のリーガル 4 行は /[locale]/legal/[doc] へ push する", () => {
	// 4 行はすべて同じハンドラを通るため、doc の取り違えは «行ごとに» 見ないと見つからない
	it.each([
		["settings-guidelines", "guidelines"],
		["settings-terms", "terms"],
		["settings-privacy", "privacy"],
		["settings-copyright", "copyright"],
	])("%s は doc=%s で push する", async (testID, doc) => {
		const tree = await render(<SettingsScreen />);

		await press(tree, testID);

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/legal/[doc]",
			params: { locale: "ja-JP", doc },
		});
	});

	// #1368 モーダルを «画面» へ移した本体。BlurModal の中身が残っていたら赤くする
	it("legal-document-modal を描かない", async () => {
		const tree = await render(<SettingsScreen />);

		expect(exists(tree, "legal-document-modal")).toBe(false);
	});
});

describe("#1368 ログインフォームの同意文言も同じルートへ push する", () => {
	it.each([
		["login-terms-link", "terms"],
		["login-privacy-link", "privacy"],
	])("%s は doc=%s で push する", async (testID, doc) => {
		const tree = await render(<LoginForm testID="login-screen" />);

		await press(tree, testID);

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/legal/[doc]",
			params: { locale: "ja-JP", doc },
		});
	});

	it("legal-document-modal を描かない", async () => {
		const tree = await render(<LoginForm testID="login-screen" />);

		expect(exists(tree, "legal-document-modal")).toBe(false);
	});
});

describe("#1368 リーガル導線を持つ 2 画面は portal を 1 つも持たない", () => {
	/*
	⚠️ これが赤くなったら «閉じてから push» が必要になったということ。
	BlurModal は react-native-paper の `<Portal>` に全画面レイヤを描き、`Portal.Host` は
	`<Stack>` を包んでいる（app/[locale]/_layout.tsx）ので、開いたまま push すると
	法務ページは portal の下に潜って見えず触れない（#1364 で実測）。Android の戻るキーも
	useBlurModal 側の BackHandler に食われる。
	対処は features/map/components/SelectedRestaurantDetails.tsx と同じく
	「close() を push より先に呼び、その順序をテストで固定する」こと。
	*/
	it("設定画面は useBlurModal を呼ばない", async () => {
		const tree = await render(<SettingsScreen />);
		await press(tree, "settings-terms");

		expect(mockUseBlurModal).not.toHaveBeenCalled();
	});

	it("ログインフォームは useBlurModal を呼ばない", async () => {
		const tree = await render(<LoginForm testID="login-screen" />);
		await press(tree, "login-privacy-link");

		expect(mockUseBlurModal).not.toHaveBeenCalled();
	});
});

describe("#1368 /[locale]/legal/[doc] の doc 検証", () => {
	it.each(LEGAL_DOCUMENT_TYPES)("公開中の文書 %s は本文を描く", async (doc) => {
		mockLocalParams = { doc };

		const tree = await render(<LegalDocumentScreen />);

		expect(exists(tree, "legal-screen-document")).toBe(true);
		expect(exists(tree, "legal-screen-not-found")).toBe(false);
	});

	// ⚠️ 「不正値は既定の文書へ倒す」に変えると `/legal/<任意の文字列>` が全部
	// 同じ文書の複製として 200 を返す（lib/legalRoute.ts のコメント）。ここで止める
	it.each([["tos"], [""], ["Terms"]])("公開していない doc=%p は not-found を描き、本文は描かない", async (doc) => {
		mockLocalParams = { doc };

		const tree = await render(<LegalDocumentScreen />);

		expect(exists(tree, "legal-screen-not-found")).toBe(true);
		expect(exists(tree, "legal-screen-document")).toBe(false);
	});

	// 不正値でも «戻れる» ことは分岐の外の不変条件。ここが壊れると Web は行き止まりになる
	it("不正値でも戻る導線は残る", async () => {
		mockLocalParams = { doc: "tos" };

		const tree = await render(<LegalDocumentScreen />);
		await press(tree, "screen-header-back");

		expect(mockBack).toHaveBeenCalledTimes(1);
	});

	// 履歴が無い着地（検索結果 / 共有リンク / ディープリンクのコールドロード）だけの経路
	it("履歴が無ければ設定画面へ replace する", async () => {
		mockCanGoBack = false;
		mockLocalParams = { doc: "terms" };

		const tree = await render(<LegalDocumentScreen />);
		await press(tree, "screen-header-back");

		expect(mockBack).not.toHaveBeenCalled();
		expect(mockReplace).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/profile/settings",
			params: { locale: "ja-JP" },
		});
	});
});
