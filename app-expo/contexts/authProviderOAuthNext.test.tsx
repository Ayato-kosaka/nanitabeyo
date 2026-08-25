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
import * as WebBrowser from "expo-web-browser";
import { readOAuthResultQuery } from "@/lib/oauthResultUrl";
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
			exchangeCodeForSession: jest.fn(),
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
const mockRouterReplace = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockRouterReplace }) }));
jest.mock("@/lib/logoutRedirect", () => ({ requestLogoutRedirect: jest.fn() }));
// #1374 ロケールの復元にだけ使う（クエリは readOAuthResultQuery が読む）。
// 本物と同じく «ホスト部» を返し、queryParams は 2 回デコードする形にしておく
jest.mock("expo-linking", () => ({
	parse: jest.fn((url: string) => {
		const parsed = new URL(url);
		const queryParams: Record<string, string> = {};
		try {
			parsed.searchParams.forEach((value, key) => {
				queryParams[key] = decodeURIComponent(value);
			});
		} catch {
			// 本物（createURL.js:137-139）と同じく URIError を握り潰す
		}
		return { hostname: parsed.hostname, queryParams };
	}),
}));
// ⚠️ 既定の戻り値は使い捨ての文字列だが、#1374 の describe では
// «expo-linking の createURL と同じ規約» を実装した版に差し替える（下の buildLikeCreateURL）
jest.mock("expo-auth-session", () => ({ makeRedirectUri: jest.fn(() => "nanitabeyo://redirect") }));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("@/stores/useDishMediaEntriesStore", () => ({
	useDishMediaEntriesStore: { getState: () => ({ clearByKey: jest.fn() }) },
}));
jest.mock("@/stores/useDishCategoriesStore", () => ({ useDishCategoriesStore: { getState: () => ({ clearByKey: jest.fn() }) } }));
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
	exchangeCodeForSession: jest.Mock;
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
	 * 本物（build/createURL.js:111-114、独自スキーム・非 Expo-hosted の場合）はこうである。
	 *   hostUri = ensureLeadingSlash("", true)                    // → "/"
	 *   encodeURI(`${scheme}:/${hostUri}${path}`)                 // → "nanitabeyo://ja-JP/auth/callback"
	 *   + `?${new URLSearchParams(queryParams)}`                  // ← encodeURI の «後» に足す
	 *
	 * つまり **スラッシュは 2 本**で、`path` の先頭セグメント（ロケール）がホストになる。
	 * `openOAuthBrowserSession` が `Linking.parse(url).hostname` からロケールを復元するのは
	 * この形が前提なので、ここも本物と同じ形にしておく（PR #1393 のレビュー 4）。
	 */
	const buildLikeCreateURL = ({
		path,
		queryParams,
	}: {
		path: string;
		queryParams?: Record<string, string>;
	}): string => {
		const query = new URLSearchParams(queryParams ?? {}).toString();
		return `${encodeURI(`nanitabeyo://${path}`)}${query ? `?${query}` : ""}`;
	};

	/** 経路A の読み取り。`Linking.parse` と同じく searchParams のうえに decodeURIComponent を重ねる */
	const readNextLikeRouteALegacy = (url: string): string | undefined => {
		const queryParams: Record<string, string> = {};
		try {
			new URL(url).searchParams.forEach((value, key) => {
				queryParams[key] = decodeURIComponent(value);
			});
		} catch {
			// Linking.parse は URIError を握り潰す（createURL.js:137-139）。ここも同じにする
		}
		return queryParams.next;
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

	// レビュー 4: 従来この形をテストが一切カバーしていなかった。
	// `openOAuthBrowserSession` はここからロケールを復元する
	it("ロケールはホスト部に載る（Linking.parse の hostname から復元できる）", async () => {
		await act(async () => {
			await authValue.signInWithOAuth("google", { next: "/ja-JP/(tabs)/review" });
		});

		const redirectTo = makeRedirectUri.mock.results[0].value as string;

		// 独自スキームは «special scheme» ではないので、ホスト部の大文字小文字は保たれる
		expect(new URL(redirectTo).hostname).toBe("ja-JP");
		expect(new URL(redirectTo).pathname).toBe("/auth/callback");
	});

	it("linkIdentity でも同じ", async () => {
		await act(async () => {
			await authValue.linkIdentity("google", { next: "/ja-JP/(tabs)/review" });
		});

		const redirectTo = makeRedirectUri.mock.results[0].value as string;

		expect(readNextLikeRouteB(redirectTo)).toBe("/ja-JP/(tabs)/review");
		expect(redirectTo).not.toContain("%25");
	});

	/*
	経路A も «1 回デコード» で読むようになったことの確認（PR #1393 のレビュー 2）。

	以前の経路A は `Linking.parse`（searchParams + decodeURIComponent = 2 回）だった。
	redirectTo が二重エンコードだったので «たまたま» 釣り合っていたが、エンコードを 1 回へ
	直した時点でこちらが過剰になる。`readOAuthResultQuery` で読む側も 1 回へ揃えた。

	⚠️ 下の 3 ケース目が本命。裸の `%` は 2 回デコードで URIError を起こし、
	`Linking.parse` の catch がそれを飲むため **code まで消えてログイン自体が失敗する**。
	*/
	it.each([
		["/ja-JP/(tabs)/review", "%XX を含まない通常の行き先"],
		["/ja-JP/search?q=%E3%83%A9%E3%83%BC%E3%83%A1%E3%83%B3", "値に %XX を含む行き先"],
		["/ja-JP/x?q=50%", "裸の % を含む行き先"],
	])("経路A（1 回デコード）でも next が元のパスに戻る: %s", async (next) => {
		await act(async () => {
			await authValue.signInWithOAuth("google", { next });
		});

		const redirectTo = makeRedirectUri.mock.results[0].value as string;

		expect(readOAuthResultQuery(redirectTo)?.next).toBe(next);
	});

	// 旧い読み方（2 回デコード）だと «直っていない» ことを対で残す。
	// これが緑になったら、揃えた意味が無くなっている
	it("旧い 2 回デコードのままなら経路A は壊れる（対照）", async () => {
		await act(async () => {
			await authValue.signInWithOAuth("google", { next: "/ja-JP/x?q=50%" });
		});

		const redirectTo = makeRedirectUri.mock.results[0].value as string;

		expect(readNextLikeRouteALegacy(redirectTo)).toBeUndefined();
	});

	// レビュー 2 の最重要点: 裸の % が入っても code は生き残る
	it("next に裸の % が入っても code は落ちない", async () => {
		await act(async () => {
			await authValue.signInWithOAuth("google", { next: "/ja-JP/x?q=50%" });
		});

		const redirectTo = makeRedirectUri.mock.results[0].value as string;
		// Supabase が付ける code を模して足す
		const withCode = `${redirectTo}&code=AUTHCODE`;

		expect(readOAuthResultQuery(withCode)?.code).toBe("AUTHCODE");
		expect(readNextLikeRouteALegacy(withCode)).toBeUndefined();
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

/*
#1374 経路A の «実際の入口» を通す（PR #1393 のレビュー 2 / N1 の取りこぼし）。

`readOAuthResultQuery` 単体と «組み立てた URL» のテストだけでは、
`openOAuthBrowserSession` が `Linking.parse(...).queryParams`（2 回デコード）へ戻されても
気付けなかった。ここはブラウザからの戻り URL を実際に流し、
**callback へ渡る params** を観測する。

⚠️ これが赤くなったら、経路A が 2 回デコードへ逆戻りしている。裸の `%` を含む `next` で
`code` が消え、ログインそのものが失敗する。
*/
describe("#1374 ブラウザ復帰（経路A）が callback へ渡す params", () => {
	let authValue: ReturnType<typeof useAuth>;

	const Probe = () => {
		authValue = useAuth();
		return null;
	};

	beforeEach(async () => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
		auth.setSession.mockResolvedValue({ data: { session: null }, error: null });
		auth.signInAnonymously.mockResolvedValue({
			data: { session: { access_token: "a", refresh_token: "r", user: { id: "anon-1" } } },
			error: null,
		});
		auth.onAuthStateChange.mockImplementation(() => ({ data: { subscription: { unsubscribe: jest.fn() } } }));
		// ブラウザを開く経路へ入るため data.url を返す
		auth.signInWithOAuth.mockResolvedValue({ data: { url: "https://provider.example/auth" }, error: null });
		makeRedirectUri.mockReturnValue("nanitabeyo://ja-JP/auth/callback");
		await act(async () => {
			TestRenderer.create(
				<AuthProvider>
					<Probe />
				</AuthProvider>,
			);
		});
	});

	/** ブラウザが返してくる URL（Supabase が code を付けた形） */
	const returnUrlWith = (next: string): string =>
		`nanitabeyo://ja-JP/auth/callback?intent=signin&next=${encodeURIComponent(next)}&code=AUTHCODE`;

	it("裸の % を含む next でも code が callback へ届く", async () => {
		(WebBrowser.openAuthSessionAsync as unknown as jest.Mock).mockResolvedValue({
			type: "success",
			url: returnUrlWith("/ja-JP/x?q=50%"),
		});

		await act(async () => {
			await authValue.signInWithOAuth("google", { next: "/ja-JP/x?q=50%" });
		});

		const href = mockRouterReplace.mock.calls.at(-1)?.[0];
		expect(href.params.code).toBe("AUTHCODE");
		expect(href.params.next).toBe("/ja-JP/x?q=50%");
		// ロケールはホスト部から復元する（Linking.parse の担当。ここは変えていない）
		expect(href.params.locale).toBe("ja-JP");
	});

	it("値に %XX を含む next が化けない", async () => {
		const next = "/ja-JP/search?q=%E3%83%A9%E3%83%BC%E3%83%A1%E3%83%B3";
		(WebBrowser.openAuthSessionAsync as unknown as jest.Mock).mockResolvedValue({
			type: "success",
			url: returnUrlWith(next),
		});

		await act(async () => {
			await authValue.signInWithOAuth("google", { next });
		});

		expect(mockRouterReplace.mock.calls.at(-1)?.[0].params.next).toBe(next);
	});
});

/*
#1374 `handleOAuthResultUrl` 側も «デコード 1 回» で読む（PR #1393 の再レビュー N1）。

openOAuthBrowserSession だけ直しても、callback 画面が実際に認証を成立させるのはこちらである。
Linking.parse（2 回デコード）のままだと、next に裸の `%` が入った瞬間に URIError が
forEach を止め、**code が queryParams に入らない**。エラーにもならず no_result になるので、
ユーザーには «ログインが黙って失敗した» としか見えない。
*/
describe("#1374 handleOAuthResultUrl のクエリ読み取り", () => {
	let authValue: ReturnType<typeof useAuth>;
	const Probe = () => {
		authValue = useAuth();
		return null;
	};

	beforeEach(async () => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
		auth.setSession.mockResolvedValue({ data: { session: null }, error: null });
		auth.signInAnonymously.mockResolvedValue({
			data: { session: { access_token: "a", refresh_token: "r", user: { id: "anon-1" } } },
			error: null,
		});
		auth.onAuthStateChange.mockImplementation(() => ({ data: { subscription: { unsubscribe: jest.fn() } } }));
		auth.exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
		await act(async () => {
			TestRenderer.create(
				<AuthProvider>
					<Probe />
				</AuthProvider>,
			);
		});
	});

	// ⚠️ 本命。2 回デコードへ戻すと code が消えて no_result になる
	it("next に裸の % が入っていても code を取り出して認証を成立させる", async () => {
		const url =
			"nanitabeyo://ja-JP/auth/callback?intent=signin&next=%2Fja-JP%2Fx%3Fq%3D50%25&code=AUTHCODE";

		let result!: Awaited<ReturnType<typeof authValue.handleOAuthResultUrl>>;
		await act(async () => {
			result = await authValue.handleOAuthResultUrl(url);
		});

		expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("AUTHCODE");
		expect(result.status).toBe("authenticated");
	});

	// error 系のクエリが従来どおり読めること（読み取りを差し替えたので対で見る）
	it("error クエリは従来どおり例外として投げる", async () => {
		const url = "nanitabeyo://ja-JP/auth/callback?intent=signin&error=access_denied&error_code=403";

		await expect(
			act(async () => {
				await authValue.handleOAuthResultUrl(url);
			}),
		).rejects.toThrow();
	});
});
