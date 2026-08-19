// #1370 【設計】`next`（ログイン後の行き先）が OAuth の `redirectTo` に載ることを固定する。
//
// web の OAuth は全画面リダイレクトでページごと作り直されるため、「どこから来たか」を
// callback（app/[locale]/auth/callback.tsx）まで運ぶ手段は **URL に載せること以外に無い**。
// ここが落ちると `next` を渡した全員がマイページに着地し、元の画面へ戻れなくなる。
// 実際の OAuth を通さないと踏めない経路なので、redirectTo の «組み立て» だけをここで観測する。
//
// ⚠️ 検証（`resolveNextPath`）はここではなく呼び出し側と受け取り側で行う。この層は運ぶだけ。
//
// #1374 【バグ】運び方も観測対象である。以前は `?intent=…&next=${encodeURIComponent(next)}` まで
// 含めた 1 本の文字列を `makeRedirectUri({ path })` に渡していたが、`createURL` が path へ
// `encodeURI()` を掛けるため `%2F` が `%252F` になっていた。二重になるとデコード回数が経路で
// 食い違い、OS のディープリンクで callback へ着地する経路（アプリのコールドスタート）だけ
// `next` が捨てられる。そこで下の describe は «makeRedirectUri が実際に作る URL» まで見る。
import React from "react";
import { act } from "react";
import TestRenderer from "react-test-renderer";
import * as AuthSession from "expo-auth-session";
import { Platform } from "react-native";
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
// ⚠️ 既定の戻り値は使い捨ての文字列だが、#1374 の describe では
// «expo-linking の createURL と同じ規約» を実装した版に差し替える（下の buildLikeCreateURL）
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

	/** native では redirectTo は makeRedirectUri({ path, queryParams }) から組まれる（Platform.OS !== "web"） */
	const redirectPath = (): string => makeRedirectUri.mock.calls[0][0].path;
	/** #1374 クエリは «構造のまま» 渡す。文字列に組み立てない */
	const redirectQueryParams = (): Record<string, string> => makeRedirectUri.mock.calls[0][0].queryParams;

	it("signInWithOAuth: next を intent と同じクエリに載せる", async () => {
		await act(async () => {
			await authValue.signInWithOAuth("google", { next: "/ja-JP/(tabs)/review" });
		});

		expect(redirectPath()).toBe("ja-JP/auth/callback");
		expect(redirectQueryParams()).toEqual({ intent: "signin", next: "/ja-JP/(tabs)/review" });
	});

	it("linkIdentity: 既存の intent=link&provider に続けて next を載せる", async () => {
		await act(async () => {
			await authValue.linkIdentity("google", { next: "/ja-JP/(tabs)/review" });
		});

		expect(redirectPath()).toBe("ja-JP/auth/callback");
		expect(redirectQueryParams()).toEqual({ intent: "link", provider: "google", next: "/ja-JP/(tabs)/review" });
	});

	// next はあくまで optional。指定しない既存の呼び出しの URL を変えていないこと
	it("next を渡さなければ従来どおりのクエリのまま", async () => {
		await act(async () => {
			await authValue.signInWithOAuth("google");
		});

		expect(redirectPath()).toBe("ja-JP/auth/callback");
		expect(redirectQueryParams()).toEqual({ intent: "signin" });
	});

	// `?`/`&`/`#` を含むパスは «生のまま» 渡し、エンコードは createURL（URLSearchParams）に 1 回だけ任せる。
	// 自分でも掛けると #1374 の二重エンコードに戻る
	it("クエリ付きの行き先も生のまま渡す（エンコードは 1 箇所に任せる）", async () => {
		await act(async () => {
			await authValue.signInWithOAuth("google", { next: "/ja-JP/profile?tab=posts" });
		});

		expect(redirectQueryParams()).toEqual({ intent: "signin", next: "/ja-JP/profile?tab=posts" });
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

/*
#1374 【バグ】OAuth 復帰の 2 経路でデコード回数が食い違い、片方だけ `next` が落ちる。

- 経路A: WebBrowser.openAuthSessionAsync が成功 → Linking.parse（searchParams）→ さらに
  decodeURIComponent → 合計 2 回
- 経路B: OS のディープリンクで callback へ直接着地（ブラウザ中にアプリが落とされ、
  コールドスタートして Linking.getInitialURL() から拾う経路）→ expo-router の
  `new URL(...).searchParams` で 1 回だけ

redirectTo が二重エンコードされていると、A では «たまたま» 元に戻り、B では
`"%2Fja-JP%2F…"` のままになる。先頭が `/` でないので resolveNextPath が null を返し、
next が黙って捨てられてマイページへ倒れる（fail-closed なので穴ではないが、行き先は失われる）。

⚠️ ここが赤くなったら、また経路 B だけが壊れている。ユニットでしか踏めない。
*/
describe("#1374 redirectTo が二重エンコードされない", () => {
	let authValue: ReturnType<typeof useAuth>;

	const Probe = () => {
		authValue = useAuth();
		return null;
	};

	/**
	 * expo-linking の `createURL` と同じ規約で URL を組む。
	 *
	 * 本物（build/createURL.js:113-114）は
	 *   `encodeURI(scheme + "://" + path)` に、`URLSearchParams(queryParams)` の結果を **後から** 足す。
	 * つまり path だけが `encodeURI` を通り、クエリは 1 回だけエンコードされる。
	 */
	const buildLikeCreateURL = ({
		path,
		queryParams,
	}: {
		path: string;
		queryParams?: Record<string, string>;
	}): string => {
		const query = new URLSearchParams(queryParams ?? {}).toString();
		return `${encodeURI(`nanitabeyo:///${path}`)}${query ? `?${query}` : ""}`;
	};

	/** 経路B の読み取り。expo-router と同じく searchParams で «1 回だけ» デコードする */
	const readNextLikeRouteB = (url: string): string | null =>
		new URL(url.replace("nanitabeyo://", "https://deeplink")).searchParams.get("next");

	beforeEach(async () => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
		auth.setSession.mockResolvedValue({ data: { session: null }, error: null });
		auth.signInAnonymously.mockResolvedValue({
			data: { session: { access_token: "a", refresh_token: "r", user: { id: "anon-1" } } },
			error: null,
		});
		auth.onAuthStateChange.mockImplementation(() => ({ data: { subscription: { unsubscribe: jest.fn() } } }));
		auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: null });
		auth.linkIdentity.mockResolvedValue({ data: { url: null }, error: null });
		// 本物の createURL と同じ規約で組み立てる
		makeRedirectUri.mockImplementation(buildLikeCreateURL);
		await act(async () => {
			TestRenderer.create(
				<AuthProvider>
					<Probe />
				</AuthProvider>,
			);
		});
	});

	it.each([
		["/ja-JP/(tabs)/review", "スラッシュと括弧を含む通常の行き先"],
		["/ja-JP/profile?tab=posts", "クエリ付きの行き先"],
		["/ja-JP/review/restaurant/abc-123/review", "深い階層"],
	])("経路B（1 回デコード）でも next が元のパスに戻る: %s", async (next) => {
		await act(async () => {
			await authValue.signInWithOAuth("google", { next });
		});

		const redirectTo = makeRedirectUri.mock.results[0].value as string;

		// ⚠️ 二重エンコードされていると "%2Fja-JP%2F…" が返り、先頭が "/" にならない
		expect(readNextLikeRouteB(redirectTo)).toBe(next);
		expect(redirectTo).not.toContain("%25");
	});

	it("linkIdentity でも同じ", async () => {
		await act(async () => {
			await authValue.linkIdentity("google", { next: "/ja-JP/(tabs)/review" });
		});

		const redirectTo = makeRedirectUri.mock.results[0].value as string;

		expect(readNextLikeRouteB(redirectTo)).toBe("/ja-JP/(tabs)/review");
		expect(redirectTo).not.toContain("%25");
	});

	// 経路A（2 回デコード）を壊していないこと。ここが «たまたま動いていた» 側なので、
	// 直したことで逆に壊れていないかを対で見る
	it("経路A（Linking.parse 相当の 2 回デコード）でも壊れない", async () => {
		await act(async () => {
			await authValue.signInWithOAuth("google", { next: "/ja-JP/(tabs)/review" });
		});

		const redirectTo = makeRedirectUri.mock.results[0].value as string;
		const once = readNextLikeRouteB(redirectTo);

		// 経路A は decodeURIComponent をもう 1 回掛ける。エンコードが 1 回なら «もう変わらない»
		expect(decodeURIComponent(once as string)).toBe("/ja-JP/(tabs)/review");
	});
});

/*
#1374 web 側の redirectTo。

web は `makeRedirectUri` を通らず（`Platform.OS === "web"` の分岐）、`window.location.origin` に
自分でクエリを足す。つまり `createURL` の `encodeURI` を通らないので、**ここは自分で 1 回だけ**
エンコードする必要がある。native 側だけ直しても web を二重にしてしまえば、
今度は web の全画面リダイレクト復帰（#1370 の完了条件）が落ちる。

web の OAuth はページごと作り直されるため、`next` を運ぶ手段は URL 以外に無い。
*/
describe("#1374 web の redirectTo も 1 回だけエンコードする", () => {
	let authValue: ReturnType<typeof useAuth>;
	const ORIGINAL_OS = Platform.OS;

	const Probe = () => {
		authValue = useAuth();
		return null;
	};

	beforeEach(async () => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
		(globalThis as { window?: unknown }).window = { location: { origin: "https://app.nanitabeyo.net" } };

		auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
		auth.setSession.mockResolvedValue({ data: { session: null }, error: null });
		auth.signInAnonymously.mockResolvedValue({
			data: { session: { access_token: "a", refresh_token: "r", user: { id: "anon-1" } } },
			error: null,
		});
		auth.onAuthStateChange.mockImplementation(() => ({ data: { subscription: { unsubscribe: jest.fn() } } }));
		auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: null });
		await act(async () => {
			TestRenderer.create(
				<AuthProvider>
					<Probe />
				</AuthProvider>,
			);
		});
	});

	afterEach(() => {
		Object.defineProperty(Platform, "OS", { value: ORIGINAL_OS, configurable: true });
	});

	it("redirectTo は origin + callback パス + 1 回だけエンコードしたクエリ", async () => {
		await act(async () => {
			await authValue.signInWithOAuth("google", { next: "/ja-JP/(tabs)/review" });
		});

		const redirectTo = auth.signInWithOAuth.mock.calls[0][0].options.redirectTo as string;

		// ⚠️ 二重にすると "%25" が現れる
		expect(redirectTo).not.toContain("%25");
		expect(new URL(redirectTo).searchParams.get("next")).toBe("/ja-JP/(tabs)/review");
		expect(new URL(redirectTo).pathname).toBe("/ja-JP/auth/callback");
		// web では makeRedirectUri（native 用）を通らない
		expect(makeRedirectUri).not.toHaveBeenCalled();
	});
});
