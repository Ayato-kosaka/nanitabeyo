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
そこで react-native-paper の `<Portal>` のスタブを «描かれたら記録する» 形にして、
レンダー〜押下の間に 1 度も描かれないことを固定する。#1350 P6 で `features/blurModal` は
撤去済みなので、観測点は «消えたモジュール名» ではなくオーバーレイの **機構そのもの** に置いてある。
将来この UI を再びオーバーレイの中へ入れる変更が入れば、その時点でここが赤くなる。
ただし赤くなるのは «開いた» オーバーレイだけで、`{visible && <Portal>…}` のように
閉じたまま置かれたものは描かれず捕まらない（#1389 のレビューで実測）。
そこは `scripts/assert-legacy-blur-modal-boundary.mjs` が Portal の import を静的に見て塞いでいる。

## #1386 で足したもの
1. **レビュー投稿フォームの 2 リンク**（#1368 から引き渡された最後の 1 件）は
   `__tests__/reviewFormRoutes.test.tsx` が持つ（あちらはフォームの他の導線と一緒に見る）。
2. **「ルートに載る形」の固定**（PR #1372 のレビュー指摘 4）。
   `[doc].tsx` は以前 `layout="screen"` を渡していたが、**それを落としても全緑のまま**だった。
   #1386 で prop 自体を畳んで «唯一の実装» にしたので、ここでは
   「本文が自分で高さを敷かない」「見出しを二重に描かない」を実物の `LegalDocument` で見る。
   ⚠️ そのため下の describe だけは Markdown 以外をスタブしない（スタブすると何も検証できない）。

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
 * `<Portal>` のスタブ。
 *
 * ⚠️ 描かれたこと «自体» が検証対象。#1350 P6 で `features/blurModal` を撤去したので、
 * この検査は «消えたモジュール名» ではなく BlurModal が使っていた **機構そのもの**
 * （react-native-paper の `<Portal>`）を見る。
 *
 * ⚠️ ここが守るのは «**開いた** オーバーレイを持たないこと» だけである（#1389 のレビューで実測）。
 * `{visible && <Portal>…}` のように閉じたまま置かれた Portal は描かれないので記録されない。
 * «そもそも Portal を import しないこと» は静的検査
 * （`scripts/assert-legacy-blur-modal-boundary.mjs` の許可リスト）が受け持つ。2 つで 1 組。
 */
const mockPortal = jest.fn();
jest.mock("react-native-paper", () => ({
	// Portal 以外は本物のまま通す。テーマ（constants/PaperTheme.ts の MD3DarkTheme）など、
	// この画面が «今は» 使っていないだけの export を undefined にすると、将来 useThemeColor を
	// 1 つ足しただけで «Portal と無関係な» TypeError で落ちるため
	...jest.requireActual("react-native-paper"),
	// children を返すのは #1358 の先例（DishCategoryGroupVoteResultScreen.test.tsx）に揃えたもの。
	// null を返すと、将来 Portal の中身へアサーションを置いたときに «赤くならずに要素が消える» 側へ倒れる
	Portal: ({ children }: { children?: unknown }) => {
		mockPortal();
		return children ?? null;
	},
}));

// #1402 独立した設定画面は無くなり、リーガル 4 行はマイページ本体（profile/index.tsx）の縦リストにある。
// 押した先を見たいだけなので、上部のプロフィール要約とその依存はスタブへ潰す
jest.mock("@/features/profile/components/ProfileHeader", () => ({ ProfileHeader: () => null }));
jest.mock("@/features/profile/hooks/useEnsureOwnProfileLoaded", () => ({ useEnsureOwnProfileLoaded: () => {} }));
jest.mock("@/features/profile/stores/useProfileStore", () => ({
	useProfileStore: (selector: (state: { profile: unknown }) => unknown) =>
		selector({ profile: { id: "profile-1", username: "tester" } }),
}));

import { LoginForm } from "@/features/auth/components/LoginForm";
import ProfileScreen from "../app/[locale]/(tabs)/profile/index";
// #1583 リーガル 4 行は «なに食べよについて» ページへ移った
import AboutScreen from "../app/[locale]/(tabs)/profile/about";
import LegalDocumentScreen from "../app/[locale]/legal/[doc]";
import { LEGAL_DOCUMENT_TYPES } from "@/lib/legalRoute";
import { getLegalDocumentTitle } from "@/features/settings/components/LegalDocument";

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
	mockPortal.mockClear();
	mockCanGoBack = true;
	mockLocalParams = {};
});

describe("#1368 リーガル 4 行は /[locale]/legal/[doc] へ push する（#1402 で設定画面へ、#1583 で «なに食べよについて» へ移動）", () => {
	// 4 行はすべて同じハンドラを通るため、doc の取り違えは «行ごとに» 見ないと見つからない
	it.each([
		["settings-guidelines", "guidelines"],
		["settings-terms", "terms"],
		["settings-privacy", "privacy"],
		["settings-copyright", "copyright"],
	])("%s は doc=%s で push する", async (testID, doc) => {
		const tree = await render(<AboutScreen />);

		await press(tree, testID);

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/legal/[doc]",
			params: { locale: "ja-JP", doc },
		});
	});

	// #1368 モーダルを «画面» へ移した本体。BlurModal の中身が残っていたら赤くする
	it("legal-document-modal を描かない", async () => {
		const tree = await render(<AboutScreen />);

		expect(exists(tree, "legal-document-modal")).toBe(false);
	});
	/*
	#1583 マイページ本体からは 4 行とも消えていること。
	«移した» のではなく «about にも足した» になっていると、同じ導線が 2 箇所に増える。
	*/
	it.each(["settings-guidelines", "settings-terms", "settings-privacy", "settings-copyright"])(
		"マイページ本体には %s が残っていない",
		async (testID) => {
			const tree = await render(<ProfileScreen />);

			expect(exists(tree, testID)).toBe(false);
		},
	);
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
	オーバーレイ側の BackHandler に食われる。
	対処は「close() を push より先に呼び、その順序をテストで固定する」こと（#1386 以前の
	地図の店詳細がその形だった）。ただし今は push 元がどれもルートの中身なので、
	そもそも portal を持ち込まないほうが正しい。
	*/
	// #1583 リーガル導線が «なに食べよについて» へ移ったので、見る画面もそちらへ移した
	it("«なに食べよについて» は Portal を 1 つも描かない", async () => {
		const tree = await render(<AboutScreen />);
		await press(tree, "settings-terms");

		expect(mockPortal).not.toHaveBeenCalled();
	});

	it("ログインフォームは Portal を 1 つも描かない", async () => {
		const tree = await render(<LoginForm testID="login-screen" />);
		await press(tree, "login-privacy-link");

		expect(mockPortal).not.toHaveBeenCalled();
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
		await press(tree, "legal-screen-back");

		expect(mockBack).toHaveBeenCalledTimes(1);
	});

	// 履歴が無い着地（検索結果 / 共有リンク / ディープリンクのコールドロード）だけの経路
	it("履歴が無ければマイページへ replace する（#1402 で設定画面が無くなった）", async () => {
		mockCanGoBack = false;
		mockLocalParams = { doc: "terms" };

		const tree = await render(<LegalDocumentScreen />);
		await press(tree, "legal-screen-back");

		expect(mockBack).not.toHaveBeenCalled();
		expect(mockReplace).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/profile",
			params: { locale: "ja-JP" },
		});
	});
});

describe("#1386 法務ドキュメントは «ルートに載る形» で描かれる", () => {
	/*
	⚠️ ここが赤くなったら、本文が «モーダル用の描き方»（画面高を自分で敷く / 見出しを自分で描く）へ
	戻っている。ルートは上に ScreenHeader を敷くので、画面高をそのまま敷くと
	ヘッダーの分だけ下へはみ出し、本文の末尾がスクロールしても永久に見えなくなる。
	PR #1372 のレビュー指摘 4（`layout="screen"` を守るテストが 0 件）への回答がこの describe。
	*/
	it("本文コンテナは高さを親に委ねる（自分で height を敷かない）", async () => {
		mockLocalParams = { doc: "terms" };

		const tree = await render(<LegalDocumentScreen />);

		// LegalDocument の最外 View。flatten して height 指定が «無い» ことを見る
		const body = tree.root.find((node) => node.props?.testID === "legal-document-body");
		const styles = ([] as unknown[]).concat(body.props.style).filter(Boolean) as Record<string, unknown>[];
		expect(styles.some((style) => style.flex === 1)).toBe(true);
		expect(styles.some((style) => style.height !== undefined)).toBe(false);
	});

	it("タイトルは ScreenHeader だけが描く（本文側は見出しを持たない）", async () => {
		mockLocalParams = { doc: "terms" };

		const tree = await render(<LegalDocumentScreen />);

		// i18n はスタブしていないので実文言。同じ文字列を描くノードがヘッダーの 1 つだけであること。
		// 合成コンポーネント（react-native の Text）と host 要素の両方が一致するため host だけを数える
		const title = getLegalDocumentTitle("terms");
		const titleNodes = tree.root.findAll((node) => typeof node.type === "string" && node.props?.children === title);
		expect(titleNodes).toHaveLength(1);
		expect(titleNodes[0].props.testID).toBe("legal-screen-title");
	});
});
