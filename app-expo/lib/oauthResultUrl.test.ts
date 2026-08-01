import { carriesOAuthResult, describeOAuthUrl, pickOAuthResultUrl, type OAuthUrlCandidate } from "./oauthResultUrl";

/** Android の development build を QR / `a` キーで起動したときに getInitialURL() が返す URL（#1062 の元凶） */
const DEV_LAUNCHER_URL = "nanitabeyo://expo-development-client/?url=https%3A%2F%2Fabc.exp.direct";
const PKCE_URL = "nanitabeyo://ja-JP/auth/callback?intent=signin&code=abc123";
const IMPLICIT_URL = "nanitabeyo://ja-JP/auth/callback#access_token=tok123&refresh_token=ref456&expires_at=1";
const ERROR_URL = "nanitabeyo://ja-JP/auth/callback?intent=link&error=server_error&error_code=identity_already_exists";
const WEB_PKCE_URL = "https://app.nanitabeyo.net/ja-JP/auth/callback?intent=signin&code=abc123";

describe("carriesOAuthResult", () => {
	it("PKCE の code を持つ URL を認証結果とみなす", () => {
		expect(carriesOAuthResult(PKCE_URL)).toBe(true);
		expect(carriesOAuthResult(WEB_PKCE_URL)).toBe(true);
	});

	it("インプリシットの #access_token を持つ URL を認証結果とみなす", () => {
		expect(carriesOAuthResult(IMPLICIT_URL)).toBe(true);
	});

	it("エラー応答を認証結果とみなす（握り潰さず callback 側で扱わせるため）", () => {
		expect(carriesOAuthResult(ERROR_URL)).toBe(true);
		expect(carriesOAuthResult("nanitabeyo://ja-JP/auth/callback?error_code=bad")).toBe(true);
	});

	it("dev launcher の起動 URL を認証結果とみなさない（#1062 の中核）", () => {
		expect(carriesOAuthResult(DEV_LAUNCHER_URL)).toBe(false);
	});

	it("認証結果を持たない URL / null / 空文字を false にする", () => {
		expect(carriesOAuthResult("nanitabeyo://ja-JP/auth/callback?intent=signin")).toBe(false);
		expect(carriesOAuthResult("nanitabeyo://ja-JP/profile")).toBe(false);
		expect(carriesOAuthResult(null)).toBe(false);
		expect(carriesOAuthResult(undefined)).toBe(false);
		expect(carriesOAuthResult("")).toBe(false);
	});

	// ?? チェーンで書くと get("code") が "" を返した時点で短絡し、後続を見ずに false になる
	it("空値の ?code= があっても、後続の #access_token / error を見落とさない", () => {
		expect(carriesOAuthResult("nanitabeyo://ja-JP/auth/callback?code=#access_token=tok")).toBe(true);
		expect(carriesOAuthResult("nanitabeyo://ja-JP/auth/callback?code=&error=server_error")).toBe(true);
	});
});

describe("pickOAuthResultUrl", () => {
	// 修正前は initial_url が無条件に優先され、ここで code を取り落としていた
	it("Android dev client(QR起動): initial_url が dev launcher URL でも router_params の code を選ぶ", () => {
		const candidates: OAuthUrlCandidate[] = [
			{ source: "router_params", url: PKCE_URL },
			{ source: "initial_url", url: DEV_LAUNCHER_URL },
		];
		expect(pickOAuthResultUrl(candidates)).toEqual({ source: "router_params", url: PKCE_URL });
	});

	it("アイコン起動 / production: initial_url が null でも router_params から選べる", () => {
		const candidates: OAuthUrlCandidate[] = [
			{ source: "router_params", url: PKCE_URL },
			{ source: "initial_url", url: null },
		];
		expect(pickOAuthResultUrl(candidates)?.source).toBe("router_params");
	});

	it("コールドスタート: router_params が空でも initial_url の code を拾う", () => {
		const candidates: OAuthUrlCandidate[] = [
			{ source: "router_params", url: null },
			{ source: "initial_url", url: PKCE_URL },
		];
		expect(pickOAuthResultUrl(candidates)?.source).toBe("initial_url");
	});

	it("Web インプリシット: fragment は router params に載らないため initial_url が選ばれる", () => {
		const candidates: OAuthUrlCandidate[] = [
			{ source: "router_params", url: "nanitabeyo://oauth-result?intent=signin" },
			{ source: "initial_url", url: IMPLICIT_URL },
		];
		expect(pickOAuthResultUrl(candidates)?.source).toBe("initial_url");
	});

	it("エラー応答も選択される（成功として素通りさせない）", () => {
		const candidates: OAuthUrlCandidate[] = [
			{ source: "router_params", url: ERROR_URL },
			{ source: "initial_url", url: DEV_LAUNCHER_URL },
		];
		expect(pickOAuthResultUrl(candidates)?.source).toBe("router_params");
	});

	it("どの候補も認証結果を持たなければ null（= 失敗として扱わせる）", () => {
		const candidates: OAuthUrlCandidate[] = [
			{ source: "router_params", url: null },
			{ source: "initial_url", url: DEV_LAUNCHER_URL },
		];
		expect(pickOAuthResultUrl(candidates)).toBeNull();
	});

	it("候補が空でも null を返す", () => {
		expect(pickOAuthResultUrl([])).toBeNull();
	});
});

describe("describeOAuthUrl", () => {
	it("キー名と非機密なエラーだけを返す", () => {
		expect(describeOAuthUrl(ERROR_URL)).toEqual({
			scheme: "nanitabeyo",
			query_keys: ["error", "error_code", "intent"],
			fragment_keys: [],
			error: "server_error",
			error_code: "identity_already_exists",
		});
	});

	it("fragment のキー名も拾う", () => {
		expect(describeOAuthUrl(IMPLICIT_URL)?.fragment_keys).toEqual(["access_token", "expires_at", "refresh_token"]);
	});

	it("null / undefined は null を返す", () => {
		expect(describeOAuthUrl(null)).toBeNull();
		expect(describeOAuthUrl(undefined)).toBeNull();
	});

	// ログ基盤へ秘密値を流さないことの回帰テスト
	it("code / access_token / refresh_token の値を一切含めない", () => {
		for (const url of [PKCE_URL, IMPLICIT_URL, WEB_PKCE_URL]) {
			const serialized = JSON.stringify(describeOAuthUrl(url));
			expect(serialized).not.toContain("abc123");
			expect(serialized).not.toContain("tok123");
			expect(serialized).not.toContain("ref456");
		}
	});
});
