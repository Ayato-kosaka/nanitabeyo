import { extractQueryString, toInAppPath } from "./deepLinkTarget";

/**
 * 🔗 ディープリンクの行き先判定（#1027 / #1135 / #721 / #1272）。
 *
 * この判定は三度事故っている（#1027 でディープリンクの行き先を奪い、#1135 で OAuth の
 * `code` を落とし、#1272 で ?tab= 等の一般クエリを落とした）ので、分岐をすべてここで固定する。
 */
describe("toInAppPath", () => {
	describe("#721 共有リンク /s/:token", () => {
		// ⚠️ これが本題。`/s/<token>` の先頭セグメントは `s`（1 文字）で、
		// BCP 47 の判定 `/^[a-zA-Z]{2,3}...$/` に一致しない。
		// #721 の実装前は null になり、共有リンクを踏むと端末ロケールのホームへ飛んでいた。
		// Universal Links は `/*`、App Links は `pathPrefix: "/"` なので
		// **リンクは確実にアプリへ来る**。受け側で捨てているだけ、という壊れ方をする。
		it("共有リンクを行き先として採用する", () => {
			expect(toInAppPath("s/s1_0123456789abcdefghijkl")).toBe("/s/s1_0123456789abcdefghijkl");
		});

		it("先頭スラッシュ付きでも同じ", () => {
			expect(toInAppPath("/s/s1_0123456789abcdefghijkl")).toBe("/s/s1_0123456789abcdefghijkl");
		});

		it("余計なセグメントは落とす（行き先の決定に必要なのは token だけ）", () => {
			expect(toInAppPath("s/s1_0123456789abcdefghijkl/extra")).toBe("/s/s1_0123456789abcdefghijkl");
		});

		it.each([
			["token が無い", "s"],
			["token が空", "s/"],
			["token の形が不正", "s/not-a-token"],
			["別世代の prefix", "s/s2_0123456789abcdefghijkl"],
			["パス区切りを含む", "s/s1_..%2F..%2Fetc"],
		])("%s → 採用しない", (_label, path) => {
			expect(toInAppPath(path)).toBeNull();
		});
	});

	describe("#1027 ロケール配下だけを採用する", () => {
		it.each([
			["ja-JP/profile", "/ja-JP/profile"],
			["en-US/search/dish-categories", "/en-US/search/dish-categories"],
			["ja/posts", "/ja/posts"],
		])("%s → 採用する", (path, expected) => {
			expect(toInAppPath(path)).toBe(expected);
		});

		it.each([
			["ロケールではない先頭セグメント", "profile/settings"],
			["1 文字の先頭セグメント", "a/b"],
			["空", ""],
			["null", null],
			["undefined", undefined],
		])("%s → 採用しない", (_label, path) => {
			expect(toInAppPath(path)).toBeNull();
		});

		// `/s/` を許可するために「ロケール判定を 1 文字まで緩める」方向へ倒してはいけない。
		// `/a/...` のような別のルートまで巻き込み、#1027 の再発につながる
		it("共有リンク以外の 1 文字セグメントは、共有リンク対応後も採用しない", () => {
			expect(toInAppPath("a/s1_0123456789abcdefghijkl")).toBeNull();
			expect(toInAppPath("x/anything")).toBeNull();
		});
	});

	describe("#1135 認証コールバックは行き先にしない", () => {
		// `Linking.parse().path` はクエリを落とすため、採用すると `code` ごと捨てて遷移する
		it.each([["ja-JP/auth/callback"], ["en-US/auth/callback"]])("%s → 採用しない", (path) => {
			expect(toInAppPath(path)).toBeNull();
		});

		it("auth 以外の 2 段目は採用する", () => {
			expect(toInAppPath("ja-JP/authors")).toBe("/ja-JP/authors");
		});
	});

	describe("#1272 クエリ文字列を行き先まで運ぶ", () => {
		// ⚠️ これが本題。呼び出し側が渡す `Linking.parse().path` はクエリを落とすため、
		// クエリを別引数で渡さないと `?tab=saved-dish-categories` が iOS でアプリのどこにも届かない
		//（probe の実測 `local=- global=-` で確定。Android は expo-router 側の解決が先に
		//  済むため顕在化しない = 「片方の OS だけ壊れる」形になる）
		it("ロケール配下の行き先にはクエリを付けて返す", () => {
			expect(toInAppPath("ja-JP/profile", "tab=saved-dish-categories")).toBe("/ja-JP/profile?tab=saved-dish-categories");
		});

		it("複数パラメータ・エンコード済みの値もそのまま運ぶ（再シリアライズしない）", () => {
			expect(toInAppPath("ja-JP/profile", "tab=saved-dish-categories&tabRequest=1712%2F34")).toBe(
				"/ja-JP/profile?tab=saved-dish-categories&tabRequest=1712%2F34",
			);
		});

		it("クエリが無ければ従来どおりパスだけを返す", () => {
			expect(toInAppPath("ja-JP/profile")).toBe("/ja-JP/profile");
			expect(toInAppPath("ja-JP/profile", null)).toBe("/ja-JP/profile");
		});

		it("共有リンクはクエリを落とす（行き先の決定に必要なのは token だけ）", () => {
			expect(toInAppPath("s/s1_0123456789abcdefghijkl", "utm_source=x")).toBe("/s/s1_0123456789abcdefghijkl");
		});

		it("採用しないパスはクエリがあっても採用しない", () => {
			expect(toInAppPath("profile/settings", "tab=saved-dish-categories")).toBeNull();
			expect(toInAppPath("ja-JP/auth/callback", "code=abc")).toBeNull();
		});
	});
});

describe("extractQueryString（#1272）", () => {
	it.each([
		["クエリ付きディープリンク", "nanitabeyo:///ja-JP/profile?tab=saved-dish-categories", "tab=saved-dish-categories"],
		["複数パラメータ", "nanitabeyo:///ja-JP/profile?tab=a&tabRequest=2", "tab=a&tabRequest=2"],
		["https の Universal Link", "https://example.com/ja-JP/profile?tab=a", "tab=a"],
		["フラグメントは含めない", "nanitabeyo:///ja-JP/profile?tab=a#section", "tab=a"],
	])("%s → %s", (_label, url, expected) => {
		expect(extractQueryString(url)).toBe(expected);
	});

	it.each([
		["クエリ無し", "nanitabeyo:///ja-JP/profile"],
		["? だけで空", "nanitabeyo:///ja-JP/profile?"],
		["フラグメントのみ", "nanitabeyo:///ja-JP/profile#x"],
		["null", null],
		["undefined", undefined],
	])("%s → null", (_label, url) => {
		expect(extractQueryString(url as string | null | undefined)).toBeNull();
	});
});
