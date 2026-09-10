// #843 / #1810 GET /v1/maps/embed 用の URL・リクエストボディ組み立て（純粋関数）の検証。
jest.mock("@/constants/Env", () => ({ Env: { BACKEND_BASE_URL: "https://api.example.com" } }));

import { buildMapsEmbedTokenRequestPayload, buildMapsEmbedUrlFromToken } from "./embedUrl";

describe("buildMapsEmbedTokenRequestPayload", () => {
	it("search モード: mode/q をそのまま含む", () => {
		const payload = buildMapsEmbedTokenRequestPayload({ mode: "search", q: "ラーメン 渋谷" });

		expect(payload.mode).toBe("search");
		expect(payload.q).toBe("ラーメン 渋谷");
	});

	it("place モード: q に place_id:<id> をそのまま渡す", () => {
		const payload = buildMapsEmbedTokenRequestPayload({ mode: "place", q: "place_id:ChIJplace1" });

		expect(payload.mode).toBe("place");
		expect(payload.q).toBe("place_id:ChIJplace1");
	});

	it("center は '<lat>,<lng>' 文字列へ変換する。省略時は含めない", () => {
		const withoutCenter = buildMapsEmbedTokenRequestPayload({ mode: "search", q: "ramen" });
		expect(withoutCenter.center).toBeUndefined();

		const withCenter = buildMapsEmbedTokenRequestPayload({
			mode: "search",
			q: "ramen",
			center: { latitude: 35.6, longitude: 139.7 },
		});
		expect(withCenter.center).toBe("35.6,139.7");
	});

	it("zoom / hl は指定したときだけ含める", () => {
		const withoutOptional = buildMapsEmbedTokenRequestPayload({ mode: "search", q: "ramen" });
		expect(withoutOptional.zoom).toBeUndefined();
		expect(withoutOptional.hl).toBeUndefined();

		const withOptional = buildMapsEmbedTokenRequestPayload({
			mode: "search",
			q: "ramen",
			zoom: 15,
			hl: "ja",
		});
		expect(withOptional.zoom).toBe(15);
		expect(withOptional.hl).toBe("ja");
	});
});

describe("buildMapsEmbedUrlFromToken", () => {
	it("token を query として自社 API の URL を組み立てる", () => {
		const url = buildMapsEmbedUrlFromToken("met1.abc.def");

		const parsed = new URL(url);
		expect(parsed.origin + parsed.pathname).toBe("https://api.example.com/v1/maps/embed");
		expect(parsed.searchParams.get("token")).toBe("met1.abc.def");
	});

	it("token に含まれる記号（`.` `+` 等）を正しく percent-encode する", () => {
		const url = buildMapsEmbedUrlFromToken("met1.a+b/c=.sig");

		const parsed = new URL(url);
		expect(parsed.searchParams.get("token")).toBe("met1.a+b/c=.sig");
	});
});
