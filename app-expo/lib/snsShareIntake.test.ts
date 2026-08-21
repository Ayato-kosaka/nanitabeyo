/**
 * #1400（親 #1375）共有された URL の «行き先» の分岐を固定する。
 *
 * この PR はネイティブに一切触らないので、共有インテントの受け取りは実機でしか確かめられない。
 * 逆に言えば **「URL 文字列を渡されたとき何が起きるか」はここで全部固定できる**（設計 §5 PR1）。
 *
 * ## ここで守っているもの
 * 1. 3 分岐（content / shortlink / null）がそれぞれ別の行き先へ行くこと
 * 2. 未ログインで共有された URL が **捨てられない**こと（`?next=` に載って往復すること）
 * 3. `?next=` が `lib/authNext.ts` の検証（open redirect 対策）を**実際に通る**形であること
 *    — ここを型や目視で済ませると、`resolveNextPath()` が弾いた瞬間に共有が
 *      «ログイン後マイページへ着地して終わり» に化ける
 */
import { resolveNextPath } from "./authNext";
import {
	LOGIN_PATHNAME,
	SNS_IMPORT_PATHNAME,
	buildSnsImportPath,
	resolveSnsShareIntake,
	resolveSnsShareIntakeView,
} from "./snsShareIntake";

/** 実在の形に寄せたサンプル（`shared/utils/__tests__/snsUrl.test.ts` と同じ素性のもの） */
const TIKTOK_POST_URL = "https://www.tiktok.com/@cookpad/video/7261234567890123456";
const TIKTOK_SHORT_URL = "https://vm.tiktok.com/ZGeAbCdEf/";
const YOUTUBE_SHORTS_URL = "https://www.youtube.com/shorts/dQw4w9WgXcQ";
const INSTAGRAM_REEL_URL = "https://www.instagram.com/reel/Cabcdefghij/";
/** 対象外（#1399 リーダー確定で X と threads はスコープ外） */
const UNSUPPORTED_URL = "https://x.com/someone/status/1234567890";

describe("resolveSnsShareIntakeView（画面が描くべき状態）", () => {
	it("投稿 URL は confirm（取り込み確認）", () => {
		const view = resolveSnsShareIntakeView(TIKTOK_POST_URL);
		expect(view).toEqual({
			state: "confirm",
			content: expect.objectContaining({ provider: "tiktok", canonicalUrl: TIKTOK_POST_URL }),
		});
	});

	it("短縮 URL は expandPending（展開が要る）。unsupported と混ぜない", () => {
		const view = resolveSnsShareIntakeView(TIKTOK_SHORT_URL);
		expect(view).toEqual({
			state: "expandPending",
			shortlink: expect.objectContaining({ provider: "tiktok", expandUrl: TIKTOK_SHORT_URL }),
		});
	});

	it("対象外の URL は unsupported", () => {
		expect(resolveSnsShareIntakeView(UNSUPPORTED_URL)).toEqual({ state: "unsupported" });
	});

	it("URL 以外のテキスト（Android の ACTION_SEND は主にこれ）も unsupported", () => {
		expect(resolveSnsShareIntakeView("この店おいしかった")).toEqual({ state: "unsupported" });
	});

	it("url が無い（直接このルートを開いた / 途中で落ちた）ときも unsupported に倒す", () => {
		expect(resolveSnsShareIntakeView(undefined)).toEqual({ state: "unsupported" });
		expect(resolveSnsShareIntakeView(null)).toEqual({ state: "unsupported" });
		expect(resolveSnsShareIntakeView("")).toEqual({ state: "unsupported" });
	});
});

describe("resolveSnsShareIntake（ログイン済み）", () => {
	const intakeOf = (sharedText: string) => resolveSnsShareIntake({ sharedText, locale: "ja-JP", isLoggedIn: true });

	it.each([
		["TikTok の投稿", TIKTOK_POST_URL, TIKTOK_POST_URL],
		["YouTube Shorts", YOUTUBE_SHORTS_URL, YOUTUBE_SHORTS_URL],
		["Instagram の reel", INSTAGRAM_REEL_URL, INSTAGRAM_REEL_URL],
	])("%s は取り込み確認へ進み、canonical URL を運ぶ", (_label, shared, expectedUrl) => {
		expect(intakeOf(shared)).toEqual({
			type: "import",
			pathname: SNS_IMPORT_PATHNAME,
			params: { locale: "ja-JP", url: expectedUrl },
		});
	});

	it("短縮 URL は «展開先の URL» を運んで取り込み確認へ進む（この PR では叩かない）", () => {
		expect(intakeOf(TIKTOK_SHORT_URL)).toEqual({
			type: "import",
			pathname: SNS_IMPORT_PATHNAME,
			params: { locale: "ja-JP", url: TIKTOK_SHORT_URL },
		});
	});

	it("対象外の URL は url を運ばない（画面の文言は URL を必要としない）", () => {
		expect(intakeOf(UNSUPPORTED_URL)).toEqual({
			type: "import",
			pathname: SNS_IMPORT_PATHNAME,
			params: { locale: "ja-JP" },
		});
	});

	it("共有テキストに説明文が混ざっていても canonical だけを運ぶ（トラッキングパラメータも落ちる）", () => {
		const shared = `この動画すごい ${INSTAGRAM_REEL_URL}?igsh=trackingvalue を見て`;
		expect(intakeOf(shared)).toEqual({
			type: "import",
			pathname: SNS_IMPORT_PATHNAME,
			params: { locale: "ja-JP", url: INSTAGRAM_REEL_URL },
		});
	});

	it("ロケールは呼び出し側の現在値をそのまま使う", () => {
		const route = resolveSnsShareIntake({ sharedText: TIKTOK_POST_URL, locale: "en-US", isLoggedIn: true });
		expect(route.params.locale).toBe("en-US");
	});
});

describe("resolveSnsShareIntake（未ログイン）", () => {
	const intakeOf = (sharedText: string) => resolveSnsShareIntake({ sharedText, locale: "ja-JP", isLoggedIn: false });

	it("取り込める URL は捨てずに ?next= へ載せてログインへ送る", () => {
		expect(intakeOf(TIKTOK_POST_URL)).toEqual({
			type: "login",
			pathname: LOGIN_PATHNAME,
			params: { locale: "ja-JP", next: buildSnsImportPath("ja-JP", TIKTOK_POST_URL) },
		});
	});

	it("短縮 URL も同じく保持する（展開はログイン後の話）", () => {
		const route = intakeOf(TIKTOK_SHORT_URL);
		expect(route.type).toBe("login");
	});

	// ログインしても取り込めないものでログインを強いない。Android の ACTION_SEND は
	// URL 以外のテキストも飛ばしてくるので、この経路は稀ではない（設計 §6 R-4）
	it("対象外の URL ではログインへ送らず、そのまま «非対応» の説明へ進む", () => {
		expect(intakeOf(UNSUPPORTED_URL)).toEqual({
			type: "import",
			pathname: SNS_IMPORT_PATHNAME,
			params: { locale: "ja-JP" },
		});
	});
});

describe("未ログインで共有 → ログイン → 元の URL で取り込みが続行される", () => {
	// ログイン画面（app/[locale]/auth/login.tsx）は `resolveNextPath()` を通した値へ replace する。
	// 通らない形を作ってしまうと共有した URL が黙って消えるので、往復をそのまま再現する。
	it.each([
		["TikTok の投稿", TIKTOK_POST_URL],
		["YouTube Shorts", YOUTUBE_SHORTS_URL],
		["Instagram の reel", INSTAGRAM_REEL_URL],
		["TikTok の短縮 URL", TIKTOK_SHORT_URL],
	])("%s", (_label, sharedUrl) => {
		const route = resolveSnsShareIntake({ sharedText: sharedUrl, locale: "ja-JP", isLoggedIn: false });
		if (route.type !== "login") throw new Error("未ログインならログインへ送られるはず");

		// ① login.tsx が open redirect 対策の検証を通す
		const href = resolveNextPath(route.params.next, "ja-JP");
		expect(href).toBe(`/ja-JP/sns-import?url=${encodeURIComponent(sharedUrl)}`);

		// ② 復帰先の画面が受け取る `url` パラメータ（expo-router がデコードして渡す）
		const restoredUrl = new URL(`https://example.test${href}`).searchParams.get("url");
		expect(restoredUrl).toBe(sharedUrl);

		// ③ その URL で、共有直後とまったく同じ状態が再現される
		expect(resolveSnsShareIntakeView(restoredUrl)).toEqual(resolveSnsShareIntakeView(sharedUrl));
	});

	it("ログインを挟んでロケールが変わっても、行き先は現在のロケールへ寄る（URL は保持される）", () => {
		const route = resolveSnsShareIntake({ sharedText: TIKTOK_POST_URL, locale: "ja-JP", isLoggedIn: false });
		if (route.type !== "login") throw new Error("未ログインならログインへ送られるはず");

		expect(resolveNextPath(route.params.next, "en-US")).toBe(
			`/en-US/sns-import?url=${encodeURIComponent(TIKTOK_POST_URL)}`,
		);
	});
});

describe("buildSnsImportPath", () => {
	it("url があればクエリに載せる（エンコードする）", () => {
		expect(buildSnsImportPath("ja-JP", TIKTOK_POST_URL)).toBe(
			`/ja-JP/sns-import?url=${encodeURIComponent(TIKTOK_POST_URL)}`,
		);
	});

	it("url が無ければクエリを付けない", () => {
		expect(buildSnsImportPath("ja-JP")).toBe("/ja-JP/sns-import");
		expect(buildSnsImportPath("ja-JP", null)).toBe("/ja-JP/sns-import");
	});
});
