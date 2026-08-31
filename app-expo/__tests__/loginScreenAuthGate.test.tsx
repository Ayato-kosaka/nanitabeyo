// #1359 【設計】ログイン画面（app/[locale]/auth/login.tsx）の 3 つの不変条件を固定する。
//
// 1. auth が未確定（`isAuthResolved === false`）の間は **OAuth ボタンを描かない**。
//    モーダル時代はこれができず、「押しても何も起きない + Snackbar」と「昇格チェックボックスが
//    一瞬だけ出て消える」という 2 つの妥協が LoginForm 側に残っていた。画面になった今は待てる。
// 2. ログイン済み（`!isGuestUser(user)`）になったら `next` へ replace して離脱する。
//    #498（Android で OAuth 成功後もログイン UI が残る）に対する二重の防波堤で、
//    replace が二重に走らないことも併せて固定する。
// 3. 戻る導線は `resolvePostLoginTarget` の判定に従って `router.back()` / `router.replace()` を
//    呼び分ける（設計 §2）。判定そのものは lib/authNext.test.ts、«画面がその判定を使っているか»
//    はここが唯一の検知手段になる。
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
let mockCanGoBack = false;
// #1736 いま表示されているルート。自動離脱は «ログイン画面に居るとき» だけ動く
let mockPathname = "/ja-JP/auth/login";
const mockReplace = jest.fn();
const mockBack = jest.fn();
// ⚠️ `replace: mockReplace` と直接束縛しないこと。import 文は const 宣言より前へ巻き上げられるため、
// このファクトリが走る時点では mockReplace がまだ未初期化で `is not a function` になる。
// 呼び出し時に解決する形にして、宣言順に依存しないようにする
jest.mock("expo-router", () => ({
	router: {
		replace: (href: string) => mockReplace(href),
		back: () => mockBack(),
		canGoBack: () => mockCanGoBack,
	},
	useLocalSearchParams: () => ({ next: mockNext }),
	usePathname: () => mockPathname,
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
// #1370 受け取った props も観測する。`next` は OAuth の redirectTo へそのまま載る値なので、
// 「検証済みのものだけが渡っているか」を LoginForm の中身と切り離して見たい
let loginFormProps: { next?: string } | null = null;
jest.mock("@/features/auth/components/LoginForm", () => {
	const { View } = jest.requireActual("react-native");
	const ReactActual = jest.requireActual("react");
	return {
		LoginForm: (props: { next?: string }) => {
			loginFormProps = props;
			return ReactActual.createElement(View, { testID: LOGIN_FORM_TEST_ID });
		},
	};
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

/** ヘッダーの戻るボタンを押す（#1404 で ScreenHeader は `${testID}-back` を付ける） */
const pressBack = async (tree: TestRenderer.ReactTestRenderer): Promise<void> => {
	const backButton = tree.root.find((node) => node.props?.testID === "login-screen-back");
	await act(async () => {
		backButton.props.onPress();
	});
};

beforeEach(() => {
	mockUser = null;
	mockIsAuthResolved = false;
	mockNext = undefined;
	mockCanGoBack = false;
	mockPathname = "/ja-JP/auth/login";
	mockReplace.mockClear();
	mockBack.mockClear();
	loginFormProps = null;
});

describe("#1359 ログイン画面の auth ゲート", () => {
	it("auth 未確定の間は LoginForm（＝ OAuth ボタン）を描画しない", async () => {
		const tree = await render();

		expect(has(tree, LOGIN_FORM_TEST_ID)).toBe(false);
		// 戻る導線はゲートの外。待っている間も離脱できること
		expect(has(tree, "login-screen-back")).toBe(true);
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

	// ⚠️ 上のケースは `isGuestUser(null) === true` でも通ってしまうため、`isAuthResolved` の寄与を
	// 固定できていない（レビュー実測: `!isAuthResolved ||` を落としても緑のままだった）。
	// 「user は非匿名だが auth はまだ未確定」という、isAuthResolved でしか止められない組み合わせを置く。
	// これは lib/authGuest.ts が null をどう扱うかに依存しない保険であることの証明でもある
	it("user が非匿名でも auth 未確定の間は replace しない", async () => {
		mockIsAuthResolved = false;
		mockUser = { id: "user-1", is_anonymous: false };
		mockNext = "/ja-JP/review";

		await render();

		expect(mockReplace).not.toHaveBeenCalled();
	});

	// #1359 【設計】自ルートを指す next は lib/authNext.ts で弾く（自動離脱が同一ルートへ replace すると、
	// 再マウントされない場合に hasLeftRef が残って「ログイン済みなのにログイン画面に留まる」）
	it("next がログイン画面自身なら採用せずマイページへ倒す", async () => {
		mockIsAuthResolved = true;
		mockUser = { id: "user-1", is_anonymous: false };
		mockNext = "/ja-JP/auth/login";

		await render();

		expect(mockReplace).toHaveBeenCalledWith("/ja-JP/profile");
	});

	// #1736 【バグ】ログイン成功後、権限フローの画面が 2 枚生えて OS の許可ダイアログが 2 回出た。
	//
	// ネイティブの OAuth は「ログイン画面 → auth/callback → next」と replace で進むが、
	// replace された画面は遷移アニメーションの間マウントされたままなので、その隙間に
	// セッション確立が届くと、この保険が callback と **二重に** next へ replace してしまう。
	// dev の実測でも、ログイン経由のセッションだけ
	// `onboarding_location_permission_settled` が 2 回記録されていた
	// （path_name が `/ja-JP/auth/callback` の `login_screen_already_authenticated` が直前にある）。
	it("callback へ移ったあとは replace しない（権限フローの二重表示の防止）", async () => {
		mockIsAuthResolved = true;
		mockUser = { id: "user-1", is_anonymous: false };
		mockNext = "/ja-JP/onboarding/location";
		mockPathname = "/ja-JP/auth/callback";

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

// #1359 【設計】戻る導線（設計 §2）を画面側で固定する。
// lib/authNext.test.ts は `resolvePostLoginTarget` の «判定» を固定しているが、
// 画面がその判定を «使っているか» は誰も見ていなかった（レビュー実測: login.tsx の
// `const target = resolvePostLoginTarget(...)` を `{ type: "back" }` へ置換しても 532 件すべて緑）。
// canGoBack の両側を通して、判定結果が router の呼び分けに繋がっていることをここで閉じる。
describe("#1359 ログイン画面の戻る導線", () => {
	it("履歴があれば back。next が指定されていても back が勝つ", async () => {
		mockIsAuthResolved = true;
		mockUser = { id: "guest-1", is_anonymous: true };
		mockCanGoBack = true;
		mockNext = "/ja-JP/review";

		const tree = await render();
		await pressBack(tree);

		expect(mockBack).toHaveBeenCalledTimes(1);
		expect(mockReplace).not.toHaveBeenCalled();
	});

	it("履歴が無ければ next へ replace する", async () => {
		mockIsAuthResolved = true;
		mockUser = { id: "guest-1", is_anonymous: true };
		mockCanGoBack = false;
		mockNext = "/ja-JP/review";

		const tree = await render();
		await pressBack(tree);

		expect(mockReplace).toHaveBeenCalledWith("/ja-JP/review");
		expect(mockBack).not.toHaveBeenCalled();
	});

	it("履歴が無く next も無ければマイページへ倒す", async () => {
		mockIsAuthResolved = true;
		mockUser = { id: "guest-1", is_anonymous: true };
		mockCanGoBack = false;
		mockNext = undefined;

		const tree = await render();
		await pressBack(tree);

		expect(mockReplace).toHaveBeenCalledWith("/ja-JP/profile");
		expect(mockBack).not.toHaveBeenCalled();
	});

	// auth 未確定（スピナー表示中）でも戻れること。ヘッダーはゲートの «外» に置いてある
	it("auth 未確定の間も戻る導線は機能する", async () => {
		mockIsAuthResolved = false;
		mockCanGoBack = true;

		const tree = await render();
		await pressBack(tree);

		expect(mockBack).toHaveBeenCalledTimes(1);
	});
});

// #1370 【設計】OAuth の redirectTo に載せる `next` は LoginForm 経由で AuthProvider へ渡る。
// web の OAuth は全画面リダイレクトでページごと作り直されるため、URL に載せる以外に
// 「どこから来たか」を callback まで運ぶ手段が無い。載せる値は **検証済みのものだけ**にする
// （生の値を渡すと、検証されない行き先が URL を一往復して戻ってくる経路ができる）。
describe("#1370 LoginForm へ渡す next", () => {
	it("採用できる next は現在の locale に寄せた形で渡す", async () => {
		mockIsAuthResolved = true;
		mockUser = { id: "guest-1", is_anonymous: true };
		mockNext = "/en-US/review";

		await render();

		expect(loginFormProps?.next).toBe("/ja-JP/review");
	});

	it("外部を指す next は渡さない", async () => {
		mockIsAuthResolved = true;
		mockUser = { id: "guest-1", is_anonymous: true };
		mockNext = "https://evil.com/steal";

		await render();

		expect(loginFormProps?.next).toBeUndefined();
	});
});
