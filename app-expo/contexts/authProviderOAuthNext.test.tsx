// #1370 【設計】`next`（ログイン後の行き先）が OAuth の `redirectTo` に載ることを固定する。
//
// web の OAuth は全画面リダイレクトでページごと作り直されるため、「どこから来たか」を
// callback（app/[locale]/auth/callback.tsx）まで運ぶ手段は **URL に載せること以外に無い**。
// ここが落ちると `next` を渡した全員がマイページに着地し、元の画面へ戻れなくなる。
// 実際の OAuth を通さないと踏めない経路なので、redirectTo の «組み立て» だけをここで観測する。
//
// ⚠️ 検証（`resolveNextPath`）はここではなく呼び出し側と受け取り側で行う。この層は運ぶだけ。
import React from "react";
import { act } from "react";
import TestRenderer from "react-test-renderer";
import * as AuthSession from "expo-auth-session";
import { supabase } from "@/lib/supabase";
import { AuthProvider, useAuth } from "./AuthProvider";

jest.mock("@/lib/supabase", () => ({
	supabase: {
		auth: {
			getSession: jest.fn(),
			setSession: jest.fn(),
			signInAnonymously: jest.fn(),
			onAuthStateChange: jest.fn(),
			refreshSession: jest.fn(),
			signInWithOAuth: jest.fn(),
			linkIdentity: jest.fn(),
		},
	},
	consumeAuthRetryAfterHeader: jest.fn(() => null),
}));
jest.mock("@/lib/e2e/injectTestSession", () => ({
	injectTestSession: jest.fn(async () => "skipped"),
	isTestSessionInjectionError: jest.fn(() => false),
}));
jest.mock("@/hooks/useLogger", () => {
	const logFrontendEvent = jest.fn();
	return { useLogger: () => ({ logFrontendEvent }) };
});
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP" }) }));
jest.mock("expo-router", () => {
	const replace = jest.fn();
	return { useRouter: () => ({ replace }) };
});
jest.mock("@/lib/logoutRedirect", () => ({ requestLogoutRedirect: jest.fn() }));
jest.mock("expo-linking", () => ({ parse: jest.fn() }));
jest.mock("expo-auth-session", () => ({ makeRedirectUri: jest.fn(() => "nanitabeyo://redirect") }));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("@/stores/useDishMediaEntriesStore", () => ({
	useDishMediaEntriesStore: { getState: () => ({ clearByKey: jest.fn() }) },
}));
jest.mock("@/stores/useTopicsStore", () => ({ useTopicsStore: { getState: () => ({ clearByKey: jest.fn() }) } }));
jest.mock("@/features/profile/stores/useProfileStore", () => ({
	useProfileStore: { getState: () => ({ resetProfile: jest.fn() }) },
}));
jest.mock("@/stores/useCdnCookieStore", () => ({
	useCdnCookieStore: { getState: () => ({ clearCookies: jest.fn() }) },
}));

const auth = supabase.auth as unknown as {
	getSession: jest.Mock;
	setSession: jest.Mock;
	signInAnonymously: jest.Mock;
	onAuthStateChange: jest.Mock;
	signInWithOAuth: jest.Mock;
	linkIdentity: jest.Mock;
};
const makeRedirectUri = AuthSession.makeRedirectUri as unknown as jest.Mock;

describe("#1370 OAuth の redirectTo が next を運ぶ", () => {
	let authValue: ReturnType<typeof useAuth>;

	const Probe = () => {
		authValue = useAuth();
		return null;
	};

	const mountProvider = async () => {
		await act(async () => {
			TestRenderer.create(
				<AuthProvider>
					<Probe />
				</AuthProvider>,
			);
		});
	};

	beforeEach(async () => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
		auth.setSession.mockResolvedValue({ data: { session: null }, error: null });
		// 起動時の匿名サインインは成功させる（失敗させると本題と関係ない初期化エラーのログで埋まる）
		auth.signInAnonymously.mockResolvedValue({
			data: { session: { access_token: "a", refresh_token: "r", user: { id: "anon-1" } } },
			error: null,
		});
		auth.onAuthStateChange.mockImplementation(() => ({ data: { subscription: { unsubscribe: jest.fn() } } }));
		// data.url を返さない = ブラウザを開かずに戻る。ここでの関心は redirectTo の «組み立て» だけ
		auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: null });
		auth.linkIdentity.mockResolvedValue({ data: { url: null }, error: null });
		makeRedirectUri.mockReturnValue("nanitabeyo://redirect");
		await mountProvider();
	});

	/** native では redirectTo は makeRedirectUri({ path }) から組まれる（Platform.OS !== "web"） */
	const redirectPath = (): string => makeRedirectUri.mock.calls[0][0].path;

	it("signInWithOAuth: next を intent と同じクエリに載せる", async () => {
		await act(async () => {
			await authValue.signInWithOAuth("google", { next: "/ja-JP/(tabs)/review" });
		});

		expect(redirectPath()).toBe("ja-JP/auth/callback?intent=signin&next=%2Fja-JP%2F(tabs)%2Freview");
	});

	it("linkIdentity: 既存の intent=link&provider に続けて next を載せる", async () => {
		await act(async () => {
			await authValue.linkIdentity("google", { next: "/ja-JP/(tabs)/review" });
		});

		expect(redirectPath()).toBe("ja-JP/auth/callback?intent=link&provider=google&next=%2Fja-JP%2F(tabs)%2Freview");
	});

	// next はあくまで optional。指定しない既存の呼び出しの URL を変えていないこと
	it("next を渡さなければ従来どおりのクエリのまま", async () => {
		await act(async () => {
			await authValue.signInWithOAuth("google");
		});

		expect(redirectPath()).toBe("ja-JP/auth/callback?intent=signin");
	});

	// `?`/`&`/`#` を含むパスがそのまま連結されると、callback 側で別のパラメータとして読まれる
	it("next はエンコードして載せる（クエリ付きの行き先が壊れない）", async () => {
		await act(async () => {
			await authValue.signInWithOAuth("google", { next: "/ja-JP/profile?tab=posts" });
		});

		expect(redirectPath()).toBe("ja-JP/auth/callback?intent=signin&next=%2Fja-JP%2Fprofile%3Ftab%3Dposts");
	});

	// Supabase 呼び出しの «意味» は変えない（#1370 のスコープ外）。redirectTo 以外の引数が動いていないこと
	it("Supabase へ渡す provider / queryParams は変えない", async () => {
		await act(async () => {
			await authValue.signInWithOAuth("google", { next: "/ja-JP/(tabs)/review" });
		});

		expect(auth.signInWithOAuth).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "google",
				options: expect.objectContaining({ queryParams: { prompt: "select_account" } }),
			}),
		);
	});
});
