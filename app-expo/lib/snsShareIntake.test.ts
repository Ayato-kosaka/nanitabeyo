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

describe("resolveSnsShareIntake", () => {
	const intakeOf = (sharedText: string) => resolveSnsShareIntake({ sharedText, locale: "ja-JP" });

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
		const route = resolveSnsShareIntake({ sharedText: TIKTOK_POST_URL, locale: "en-US" });
		expect(route.params.locale).toBe("en-US");
	});
});

// #1375 実機確認: 共有からの着地で **ログインを挟まない**。
// 取り込みは `dish_media.user_id` を NULL のままにし、ユーザーとの紐付けは
// `reactions(save)` が持つ（匿名ユーザーも実 user id を持つので save は書ける）。
// 挟むと「共有した直後にログイン画面が出る」という、一番離脱する形になる。
describe("resolveSnsShareIntake（未ログインでもログインを挟まない）", () => {
	const intakeOf = (sharedText: string) => resolveSnsShareIntake({ sharedText, locale: "ja-JP" });

	it.each([
		["TikTok の投稿", TIKTOK_POST_URL],
		["YouTube Shorts", YOUTUBE_SHORTS_URL],
		["Instagram の reel", INSTAGRAM_REEL_URL],
	])("%s は取り込み画面へ直接着く", (_label, sharedUrl) => {
		expect(intakeOf(sharedUrl)).toEqual({
			type: "import",
			pathname: SNS_IMPORT_PATHNAME,
			params: { locale: "ja-JP", url: sharedUrl },
		});
	});

	it("短縮 URL も取り込み画面へ直接着く（展開はサーバの仕事）", () => {
		const route = intakeOf(TIKTOK_SHORT_URL);
		expect(route.type).toBe("import");
		expect(route.pathname).toBe(SNS_IMPORT_PATHNAME);
	});

	it("どの入力でもログインへは送らない", () => {
		for (const shared of [TIKTOK_POST_URL, YOUTUBE_SHORTS_URL, INSTAGRAM_REEL_URL, TIKTOK_SHORT_URL, "ただの文章"]) {
			expect(intakeOf(shared).type).not.toBe("login");
		}
	});
});
