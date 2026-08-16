// #1370 【設計】auth コールバック（app/[locale]/auth/callback.tsx）のプロバイダ競合の扱いを固定する。
//
// 競合の告知は BlurModal のオーバーレイから DialogProvider の confirm() へ移した（設計 #1359 §6）。
// ここで固定するのは次の 3 点で、いずれも «実機の OAuth を通さないと踏めない» 経路にある。
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

// #1370 A 群の完了条件（callback から useBlurModal が消えていること）を «呼ばれたら分かる» 形で置く。
// 復活させると下の not.toHaveBeenCalled() が赤くなる
const mockUseBlurModal = jest.fn(() => {
	throw new Error("callback.tsx must not use useBlurModal (#1370)");
});
jest.mock("@/features/blurModal/hooks/useBlurModal", () => ({
	useBlurModal: () => mockUseBlurModal(),
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

beforeEach(() => {
	// 認証結果は router params 側に載っている形にする（`code` があるものが選ばれる）
	mockParams = { locale: "ja-JP", intent: "link", provider: "google", code: "dummy-code" };
	jest.spyOn(Linking, "getInitialURL").mockResolvedValue(null);
	mockConfirm.mockResolvedValue(false);
	mockSignInWithOAuth.mockResolvedValue({ outcome: "returned" });
});

describe("#1370 プロバイダ競合の告知（DialogProvider の confirm）", () => {
	it("useBlurModal を使わない", async () => {
		mockHandleOAuthResultUrl.mockRejectedValue(identityConflictError);

		await render();

		expect(mockUseBlurModal).not.toHaveBeenCalled();
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
});
