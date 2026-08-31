// #1370 【設計】auth コールバック（app/[locale]/auth/callback.tsx）の 2 つの不変条件を固定する。
// いずれも «実機の OAuth を通さないと踏めない» 経路にあり、E2E でも気付けない。
//
// ## 1. プロバイダ競合の告知（設計 #1359 §6）
// BlurModal のオーバーレイから DialogProvider の confirm() へ移した。固定するのは次の 3 点。
//
// 1. 告知は **選ぶまで閉じない**（`dismissable: false` / `backHandlerEnabled: false`）。
//    旧実装は useBlurModal をオプション無しで使っており `backHandlerEnabled` の既定が true だった。
//    そのため Android の戻るキーで告知だけが消え、「処理中…」のスピナーだけが残る。
//    この画面は hasHandledRef で処理を一度きりにしているため、そこから先へ進めなくなる。
// 2. 遷移は confirm() が **決着してから**。DialogProvider はナビゲータの外側にあるので、
//    先に遷移するとダイアログだけが次の画面に残る。
// 3. 遷移に渡す href の «形»。lib/logoutRedirect.ts:1-7 に「Android では認証イベント直後の
//    router.replace に query 付き文字列や object href を渡すとフリーズした」実測が残っているため、
//    形が黙って変わったことを検知できるようにしておく。
//
// ## 2. `next`（ログイン後の行き先）の扱い（設計 #1359 §3 / §4-3）
// `next` は OAuth の redirectTo に載って URL を一往復して戻ってくる = 外から書き換えられる値なので、
// **必ず lib/authNext.ts の resolveNextPath を通してから** router へ渡す（open redirect 対策）。
// 競合から「切り替える」を選んだ 2 周目にも next を載せる。載せないと、昇格を諦めたユーザーだけが
// マイページに着地して元の画面へ戻れない。
//
// `app/` 配下に置いたテストは expo-router がルートとして拾ってしまうため、ここに置いている
// （__tests__/loginScreenAuthGate.test.tsx と同じ理由）。
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { Linking } from "react-native";

import i18n from "@/lib/i18n";

// ⚠️ mock 変数は「呼び出し時に解決する」形で参照すること。import 文は const/let 宣言より前へ
// 巻き上げられるため、ファクトリ内で直接束縛すると未初期化のまま参照して落ちる
let mockParams: Record<string, string> = { locale: "ja-JP" };
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
	useRouter: () => ({ replace: (href: unknown) => mockReplace(href) }),
	useLocalSearchParams: () => mockParams,
}));

const mockHandleOAuthResultUrl = jest.fn();
const mockSignInWithOAuth = jest.fn();
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({
		handleOAuthResultUrl: (url: string) => mockHandleOAuthResultUrl(url),
		signInWithOAuth: (provider: string, options?: unknown) => mockSignInWithOAuth(provider, options),
	}),
}));

const mockConfirm = jest.fn();
jest.mock("@/contexts/DialogProvider", () => ({
	useDialog: () => ({ confirm: (options: unknown) => mockConfirm(options) }),
}));

const mockCreateUserProfile = jest.fn();
jest.mock("@/features/profile/hooks/useProfile", () => ({
	useProfile: () => ({ createUserProfile: (args: unknown) => mockCreateUserProfile(args) }),
}));

const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({
	useLogger: () => ({ logFrontendEvent: (event: unknown) => mockLogFrontendEvent(event) }),
}));

// #1370 A 群の完了条件（callback がオーバーレイを持たないこと）を «描かれたら分かる» 形で置く。
// #1350 P6 で features/blurModal を撤去したので、観測点は消えたモジュール名ではなく
// BlurModal が使っていた機構そのもの（react-native-paper の `<Portal>`）にしてある。
//
// ⚠️ 見ているのは «描かれたか» なので、`{visible && <Portal>}` のように閉じたままの Portal は
// 捕まらない（#1389 のレビューで実測）。そこは
// scripts/assert-legacy-blur-modal-boundary.mjs の import 検査が受け持つ。2 つで 1 組
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

jest.mock("lottie-react-native", () => "LottieView");

import AuthCallbackScreen from "../app/[locale]/auth/callback";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 確定タイミングをテスト側で握るための confirm()。resolve するまで «決着していない» 状態になる */
const deferConfirm = () => {
	let resolveConfirm!: (value: boolean) => void;
	const promise = new Promise<boolean>((resolve) => {
		resolveConfirm = resolve;
	});
	mockConfirm.mockReturnValue(promise);
	return async (value: boolean) => {
		await act(async () => {
			resolveConfirm(value);
		});
	};
};

const render = async () => {
	await act(async () => {
		TestRenderer.create(<AuthCallbackScreen />);
	});
};

/** linkIdentity 由来の競合エラー（AuthProvider が投げてくる形） */
const identityConflictError = {
	error_code: "identity_already_exists",
	intent: "link",
	provider: "google",
};

const loggedEventNames = (): string[] =>
	mockLogFrontendEvent.mock.calls.map(([event]) => (event as { event_name: string }).event_name);

type LoggedEvent = { event_name: string; error_level: string; payload?: Record<string, unknown> };

const findLoggedEvent = (eventName: string): LoggedEvent | undefined =>
	mockLogFrontendEvent.mock.calls
		.map(([event]) => event as LoggedEvent)
		.find((event) => event.event_name === eventName);

beforeEach(() => {
	// 認証結果は router params 側に載っている形にする（`code` があるものが選ばれる）
	mockParams = { locale: "ja-JP", intent: "link", provider: "google", code: "dummy-code" };
	jest.spyOn(Linking, "getInitialURL").mockResolvedValue(null);
	mockConfirm.mockResolvedValue(false);
	mockSignInWithOAuth.mockResolvedValue({ outcome: "returned" });
});

describe("#1370 プロバイダ競合の告知（DialogProvider の confirm）", () => {
	it("Portal を 1 つも描かない", async () => {
		mockHandleOAuthResultUrl.mockRejectedValue(identityConflictError);

		await render();

		expect(mockPortal).not.toHaveBeenCalled();
	});

	// #1370 【バグ】Android の戻るキーで告知だけが消え、スピナーが残る状態を作らせない
	it("選ぶまで閉じない設定で告知する（戻るキー・背景タップで閉じない）", async () => {
		mockHandleOAuthResultUrl.mockRejectedValue(identityConflictError);

		await render();

		expect(mockConfirm).toHaveBeenCalledTimes(1);
		expect(mockConfirm).toHaveBeenCalledWith(
			expect.objectContaining({
				message: i18n.t("auth.conflict_dialog_message"),
				confirmLabel: i18n.t("auth.conflict_dialog_switch"),
				cancelLabel: i18n.t("auth.conflict_dialog_cancel"),
				dismissable: false,
				backHandlerEnabled: false,
			}),
		);
	});

	// DialogProvider はナビゲータの外側にあるため、決着前に遷移するとダイアログだけが次の画面に残る
	it("決着するまでは遷移も再サインインもしない", async () => {
		mockHandleOAuthResultUrl.mockRejectedValue(identityConflictError);
		const settle = await deferConfirm();

		await render();

		expect(mockConfirm).toHaveBeenCalledTimes(1);
		expect(mockReplace).not.toHaveBeenCalled();
		expect(mockSignInWithOAuth).not.toHaveBeenCalled();

		await settle(true);

		expect(mockSignInWithOAuth.mock.calls[0]?.[0]).toBe("google");
	});

	it("「切り替える」なら signInWithOAuth を呼び直し、遷移は 2 周目の callback へ委ねる", async () => {
		mockHandleOAuthResultUrl.mockRejectedValue(identityConflictError);
		mockConfirm.mockResolvedValue(true);

		await render();

		expect(mockSignInWithOAuth).toHaveBeenCalledTimes(1);
		expect(loggedEventNames()).toContain("oauth_conflict_switch_existing");
		// #1062 【設計】結末は記録するだけで遷移しない。ここで戻すと 2 周目の callback 遷移と競合する
		expect(mockReplace).not.toHaveBeenCalled();
	});

	it("「キャンセル」ならマイページへ replace する", async () => {
		mockHandleOAuthResultUrl.mockRejectedValue(identityConflictError);
		mockConfirm.mockResolvedValue(false);

		await render();

		expect(mockSignInWithOAuth).not.toHaveBeenCalled();
		expect(loggedEventNames()).toContain("oauth_conflict_cancel");
		expect(mockReplace).toHaveBeenCalledWith({ pathname: "/[locale]/profile", params: { locale: "ja-JP" } });
	});

	// 競合«以外»のエラーは従来どおり即マイページへ。告知は出さない
	it("競合以外のエラーでは告知を出さずにマイページへ replace する", async () => {
		mockHandleOAuthResultUrl.mockRejectedValue(new Error("boom"));

		await render();

		expect(mockConfirm).not.toHaveBeenCalled();
		expect(mockReplace).toHaveBeenCalledWith({ pathname: "/[locale]/profile", params: { locale: "ja-JP" } });
		expect(loggedEventNames()).toContain("oauth_callback_error");
	});

	// #1433 ユーザーが同意画面で止めたときのレベル。
	// 本番（2026-08-18T11:19:49Z / 1 ユーザー）では、直前に oauth_signin_browser_dismissed が
	// log レベルで出ているのに、同じ 1 回の操作がここで error としても積まれていた。
	it("access_denied（ユーザーが自分で止めた）は warn で記録する", async () => {
		mockParams = {
			locale: "ja-JP",
			intent: "link",
			provider: "google",
			error: "access_denied",
			error_description: "The user denied the request",
		};
		// 本番と同じく message が空の Error が飛んでくる形にする
		mockHandleOAuthResultUrl.mockRejectedValue(new Error());

		await render();

		const logged = findLoggedEvent("oauth_callback_error");
		expect(logged).toBeDefined();
		expect(logged?.error_level).toBe("warn");
		expect(logged?.payload).toMatchObject({ url_shape: expect.objectContaining({ error: "access_denied" }) });
	});

	// ⚠️ 判定を «error があること» まで広げないための番人。
	// server_error / temporarily_unavailable はプロバイダ側の障害なので error のまま残す
	it("access_denied 以外のプロバイダエラーは error のまま記録する", async () => {
		mockParams = {
			locale: "ja-JP",
			intent: "link",
			provider: "google",
			error: "server_error",
		};
		mockHandleOAuthResultUrl.mockRejectedValue(new Error());

		await render();

		expect(findLoggedEvent("oauth_callback_error")?.error_level).toBe("error");
	});
});

/** 認証に成功したときの handleOAuthResultUrl の返り値 */
const authenticatedResult = {
	status: "authenticated",
	via: "code",
	user: { id: "user-1", is_anonymous: false, user_metadata: {}, identities: [] },
};

/** next を採用しなかったときの行き先。#1370 以前からの形（object href）を維持していること */
const PROFILE_HREF = { pathname: "/[locale]/profile", params: { locale: "ja-JP" } };

describe("#1370 next（ログイン後の行き先）", () => {
	// ⚠️ href の «形» もここで固定している。lib/logoutRedirect.ts:1-7 の実測（Android では認証直後の
	// replace に query 付き文字列や object href を渡すとフリーズした）があるため、
	// 文字列 / object のどちらを渡しているかが黙って変わると Android 実機の確認結果が無効になる
	it("採用できる next には «文字列» の href で replace する", async () => {
		mockParams = { ...mockParams, next: "/ja-JP/(tabs)/review" };
		mockHandleOAuthResultUrl.mockResolvedValue(authenticatedResult);

		await render();

		expect(mockReplace).toHaveBeenCalledWith("/ja-JP/(tabs)/review");
	});

	it("next が無ければ従来どおり object href でマイページへ", async () => {
		mockHandleOAuthResultUrl.mockResolvedValue(authenticatedResult);

		await render();

		expect(mockReplace).toHaveBeenCalledWith(PROFILE_HREF);
	});

	// 🔒 next は URL を一往復して戻ってくる = 外から書き換えられる。resolveNextPath を素通りさせると
	// web では open redirect、native ではディープリンク経由で任意の行き先へ飛ばせる
	it.each([
		["プロトコル相対 URL", "//evil.com"],
		["スキーム付き URL", "https://evil.com/steal"],
		["バックスラッシュ", "/\\evil.com"],
		["相対パス", "evil"],
	])("外部を指す next（%s）は採用せずマイページへ倒す", async (_label, next) => {
		mockParams = { ...mockParams, next };
		mockHandleOAuthResultUrl.mockResolvedValue(authenticatedResult);

		await render();

		expect(mockReplace).toHaveBeenCalledWith(PROFILE_HREF);
	});

	// resolveNextPath を通していれば、別ロケールで組まれた next は現在の locale へ寄る
	// （通していない実装では "/en-US/review" がそのまま出るので、この 1 件で «通っているか» が分かる）
	it("別ロケールの next は現在の locale へ寄せる", async () => {
		mockParams = { ...mockParams, next: "/en-US/(tabs)/review" };
		mockHandleOAuthResultUrl.mockResolvedValue(authenticatedResult);

		await render();

		expect(mockReplace).toHaveBeenCalledWith("/ja-JP/(tabs)/review");
	});

	// 認証に失敗した経路（oauth_callback_no_result）でも、元居た画面へ戻せる方が親切。
	// 「行き先を知っているのはこの画面だけ」なので、成功時と同じ行き先判定を通す
	it("認証結果が取れなかった場合も next へ戻す", async () => {
		mockParams = { locale: "ja-JP", intent: "signin", next: "/ja-JP/(tabs)/review" };

		await render();

		expect(loggedEventNames()).toContain("oauth_callback_no_result");
		expect(mockReplace).toHaveBeenCalledWith("/ja-JP/(tabs)/review");
	});

	// 設計 #1359 §4-3: ここは callback へもう一度戻ってくる経路。next を落とすと
	// «昇格を諦めて既存アカウントへ切り替えた人だけ» が元の画面へ戻れなくなる
	it("競合から「切り替える」を選んだ 2 周目にも next を載せる", async () => {
		mockParams = { ...mockParams, next: "/ja-JP/(tabs)/review" };
		mockHandleOAuthResultUrl.mockRejectedValue(identityConflictError);
		mockConfirm.mockResolvedValue(true);

		await render();

		expect(mockSignInWithOAuth).toHaveBeenCalledWith("google", { next: "/ja-JP/(tabs)/review" });
	});

	it("競合の 2 周目でも、採用できない next は載せない", async () => {
		mockParams = { ...mockParams, next: "//evil.com" };
		mockHandleOAuthResultUrl.mockRejectedValue(identityConflictError);
		mockConfirm.mockResolvedValue(true);

		await render();

		expect(mockSignInWithOAuth).toHaveBeenCalledWith("google", { next: undefined });
	});

	it("競合を「キャンセル」したときも next へ戻す", async () => {
		mockParams = { ...mockParams, next: "/ja-JP/(tabs)/review" };
		mockHandleOAuthResultUrl.mockRejectedValue(identityConflictError);
		mockConfirm.mockResolvedValue(false);

		await render();

		expect(mockReplace).toHaveBeenCalledWith("/ja-JP/(tabs)/review");
	});
});
