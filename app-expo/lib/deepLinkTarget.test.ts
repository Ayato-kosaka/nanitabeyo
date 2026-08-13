import { toInAppPath } from "./deepLinkTarget";

/**
 * 🔗 ディープリンクの行き先判定（#1027 / #1135 / #721）。
 *
 * この判定は二度事故っている（#1027 でディープリンクの行き先を奪い、#1135 で OAuth の
 * `code` を落とした）ので、分岐をすべてここで固定する。
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
			["en-US/search/topics", "/en-US/search/topics"],
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
});
