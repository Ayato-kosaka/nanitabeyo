import { resolveNextPath, resolvePostLoginTarget, shouldAutoLeaveLoginScreen } from "./authNext";

/**
 * 🔒🧭 ログイン画面の行き先判定（#1359）。
 *
 * ここは «実機・実ブラウザでしか踏まない経路» の判定を、実機に出す前に固定するためのテスト。
 * 守るものは 2 つある。
 *
 * 1. **open redirect / 任意画面への誘導を塞ぐ**。`next` は URL に出るので、web では
 *    `?next=https://evil.com`、ネイティブでは `nanitabeyo://ja-JP/auth/login?next=...` の
 *    ディープリンクで第三者が行き先を指定できる。
 * 2. **履歴が無いときのフォールバックが必ず存在する**。コールドロードと web の OAuth
 *    全画面リダイレクトでは `router.canGoBack()` が false になり、back できない。
 */
describe("resolveNextPath", () => {
	describe("外部への遷移を弾く", () => {
		it.each([
			// プロトコル相対 URL。ブラウザは `//evil.com` を https://evil.com として解決する
			["プロトコル相対", "//evil.com"],
			["プロトコル相対 + パス", "//evil.com/ja-JP/profile"],
			// ブラウザは `\` を `/` として解釈するため、`/\evil.com` は `//evil.com` と同じ意味になる
			["バックスラッシュによるプロトコル相対", "/\\evil.com"],
			["https", "https://evil.com"],
			["http", "http://evil.com"],
			// web で href に載ると XSS になる
			["javascript", "javascript:alert(1)"],
			["大文字混じりの javascript", "JavaScript:alert(1)"],
			["アプリのカスタムスキーム", "nanitabeyo://ja-JP/profile"],
			// 相対パスは基準 URL 次第で行き先が変わる。内部パスは必ず `/` 始まりで受け取る
			["相対パス", "ja-JP/profile"],
			["親ディレクトリ", "../../evil"],
		])("%s → 採用しない", (_label, next) => {
			expect(resolveNextPath(next, "ja-JP")).toBeNull();
		});

		// 前後の空白を削ってからスキームを判定する。空白を挟めば通る、を作らない
		it("前後に空白を挟んだスキーム付き URL も採用しない", () => {
			expect(resolveNextPath("  https://evil.com  ", "ja-JP")).toBeNull();
		});

		it("制御文字を含むパスは採用しない", () => {
			expect(resolveNextPath("/ja-JP/profile\nSet-Cookie: x=1", "ja-JP")).toBeNull();
		});
	});

	describe("指定なしと同じ扱いにするもの", () => {
		it.each([
			["空文字列", ""],
			["空白だけ", "   "],
			["undefined", undefined],
			["null", null],
			// useLocalSearchParams は同名パラメータが 2 つあると配列を返す
			["配列", ["/ja-JP/profile"]],
			["数値", 1],
		])("%s → null", (_label, next) => {
			expect(resolveNextPath(next, "ja-JP")).toBeNull();
		});
	});

	describe("内部パスは採用し、ロケールを現在の locale で上書きする", () => {
		it("同じロケールのパスはそのまま", () => {
			expect(resolveNextPath("/ja-JP/profile", "ja-JP")).toBe("/ja-JP/profile");
		});

		// ⚠️ これが本題のひとつ。共有された `/en-US/...` や前セッションのディープリンクを
		// そのまま使うと、ログインを挟んだ瞬間だけ表示言語が変わる
		it.each([
			["/en-US/profile", "/ja-JP/profile"],
			["/en-US/restaurant/abc/review", "/ja-JP/restaurant/abc/review"],
			["/ja/posts", "/ja-JP/posts"],
			["/zh-Hant-TW/search", "/ja-JP/search"],
		])("%s → %s（locale を差し替える）", (next, expected) => {
			expect(resolveNextPath(next, "ja-JP")).toBe(expected);
		});

		it("locale が ja-JP 以外でも同じように差し替える", () => {
			expect(resolveNextPath("/ja-JP/profile", "en-US")).toBe("/en-US/profile");
		});

		it("クエリ・フラグメントは行き先の一部として保持する", () => {
			expect(resolveNextPath("/en-US/profile?tab=saved-dish-categories", "ja-JP")).toBe(
				"/ja-JP/profile?tab=saved-dish-categories",
			);
			expect(resolveNextPath("/en-US#section", "ja-JP")).toBe("/ja-JP#section");
		});

		// 先頭セグメントがロケールの形をしていないパスにロケールを «足さない»。
		// 足すと `/ja-JP/s/<token>` という存在しない route になる
		it.each([
			["共有リンク", "/s/s1_0123456789abcdefghijkl"],
			["ロケールを持たないルート", "/store"],
			["ルート直下", "/"],
		])("%s → ロケールを足さずそのまま採用する", (_label, next) => {
			expect(resolveNextPath(next, "ja-JP")).toBe(next);
		});
	});

	// #1359 【設計】ログイン画面自身を指す next を弾く。
	// ログイン済みで `?next=/ja-JP/auth/login` を開くと login.tsx の自動離脱が同一ルートへ replace し、
	// 再マウントされない場合は hasLeftRef が true のまま残って「ログイン済みなのにログイン画面に留まる」。
	// 通常導線（4 箇所）はこの値を組まないので、踏めるのは自作 URL / ディープリンクだけ
	describe("ログイン画面自身への遷移は採用しない", () => {
		it.each([
			["ロケール付き", "/ja-JP/auth/login"],
			["別ロケール（差し替え後に自ルートになる）", "/en-US/auth/login"],
			["ロケール無し", "/auth/login"],
			["クエリ付き（next の入れ子）", "/ja-JP/auth/login?next=%2Fja-JP%2Fprofile"],
			["末尾スラッシュ", "/ja-JP/auth/login/"],
		])("%s → null", (_label, next) => {
			expect(resolveNextPath(next, "ja-JP")).toBeNull();
		});

		// 同じ auth 配下でも login «以外» は通す。ここまで弾くと callback からの復帰を塞ぐ
		it.each([
			["/ja-JP/auth/callback", "/ja-JP/auth/callback"],
			["/ja-JP/auth/login/otp", "/ja-JP/auth/login/otp"],
			["/ja-JP/auth", "/ja-JP/auth"],
			// 先頭がロケールでないので login と «別の» ルート。ロケールも足さない
			["/auth/login/extra", "/auth/login/extra"],
		])("%s は採用する", (next, expected) => {
			expect(resolveNextPath(next, "ja-JP")).toBe(expected);
		});
	});
});

describe("resolvePostLoginTarget", () => {
	// 同一セッションで push されてきた場合。元画面はマウントされたままなので、
	// URL に出ていない画面内 state（地図の選択中の店など）ごと復帰できる back を優先する
	it("履歴があれば back。next が指定されていても back が勝つ", () => {
		expect(resolvePostLoginTarget({ canGoBack: true, locale: "ja-JP" })).toEqual({ type: "back" });
		expect(resolvePostLoginTarget({ canGoBack: true, next: "/ja-JP/review", locale: "ja-JP" })).toEqual({
			type: "back",
		});
	});

	// コールドロード / web の OAuth 全画面リダイレクト。ここでだけ next が効く
	it("履歴が無ければ next へ replace する", () => {
		expect(resolvePostLoginTarget({ canGoBack: false, next: "/ja-JP/review", locale: "ja-JP" })).toEqual({
			type: "replace",
			href: "/ja-JP/review",
		});
	});

	it("履歴が無く next のロケールが違えば、現在の locale へ寄せて replace する", () => {
		expect(resolvePostLoginTarget({ canGoBack: false, next: "/en-US/review", locale: "ja-JP" })).toEqual({
			type: "replace",
			href: "/ja-JP/review",
		});
	});

	it.each([
		["next なし", undefined],
		["空文字列", ""],
		["外部 URL", "https://evil.com"],
		["プロトコル相対", "//evil.com"],
	])("履歴が無く %s なら、マイページへ replace する", (_label, next) => {
		expect(resolvePostLoginTarget({ canGoBack: false, next, locale: "ja-JP" })).toEqual({
			type: "replace",
			href: "/ja-JP/profile",
		});
	});

	it("フォールバック先のロケールも現在の locale に従う", () => {
		expect(resolvePostLoginTarget({ canGoBack: false, locale: "en-US" })).toEqual({
			type: "replace",
			href: "/en-US/profile",
		});
	});
});

describe("shouldAutoLeaveLoginScreen", () => {
	/**
	 * #1736 【バグ】ログイン成功後、権限フローの画面が 2 枚生えて OS の許可ダイアログも 2 回出た。
	 *
	 * ネイティブの OAuth は「ログイン画面 → auth/callback → next」と replace で進むが、
	 * replace された画面は遷移アニメーションの間マウントされたままなので、その隙間に
	 * セッション確立が届くと **ログイン画面の自動離脱**が callback と二重に next へ replace する。
	 * dev の実測でも、ログイン経由のセッションだけ
	 * `onboarding_location_permission_settled` が 2 回記録されていた。
	 */
	it("ログイン画面に居てログイン済みなら離脱する", () => {
		expect(shouldAutoLeaveLoginScreen({ isAuthResolved: true, isGuest: false, pathname: "/ja-JP/auth/login" })).toBe(
			true,
		);
	});

	it("ロケールが無いパスでもログイン画面として扱う", () => {
		expect(shouldAutoLeaveLoginScreen({ isAuthResolved: true, isGuest: false, pathname: "/auth/login" })).toBe(true);
	});

	it("callback へ遷移した後は離脱しない（二重 replace の防止）", () => {
		expect(shouldAutoLeaveLoginScreen({ isAuthResolved: true, isGuest: false, pathname: "/ja-JP/auth/callback" })).toBe(
			false,
		);
	});

	it("すでに行き先（権限フロー）へ着いた後も離脱しない", () => {
		expect(
			shouldAutoLeaveLoginScreen({ isAuthResolved: true, isGuest: false, pathname: "/ja-JP/onboarding/location" }),
		).toBe(false);
	});

	it("認証が未確定・ゲストのままなら離脱しない", () => {
		expect(shouldAutoLeaveLoginScreen({ isAuthResolved: false, isGuest: false, pathname: "/ja-JP/auth/login" })).toBe(
			false,
		);
		expect(shouldAutoLeaveLoginScreen({ isAuthResolved: true, isGuest: true, pathname: "/ja-JP/auth/login" })).toBe(
			false,
		);
	});
});
