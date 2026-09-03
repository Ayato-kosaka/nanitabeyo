// #843 GET /v1/maps/embed の URL 組み立て（純粋関数）の検証。
jest.mock("@/constants/Env", () => ({ Env: { BACKEND_BASE_URL: "https://api.example.com" } }));

import { buildMapsEmbedApiUrl } from "./embedUrl";

describe("buildMapsEmbedApiUrl", () => {
	it("search モード: mode/q を含む自社 API の URL を組み立てる", () => {
		const url = buildMapsEmbedApiUrl({ mode: "search", q: "ラーメン 渋谷" });
		const parsed = new URL(url);
		expect(parsed.origin + parsed.pathname).toBe("https://api.example.com/v1/maps/embed");
		expect(parsed.searchParams.get("mode")).toBe("search");
		expect(parsed.searchParams.get("q")).toBe("ラーメン 渋谷");
	});

	it("place モード: q に place_id:<id> をそのまま渡す", () => {
		const url = buildMapsEmbedApiUrl({ mode: "place", q: "place_id:ChIJplace1" });
		const parsed = new URL(url);
		expect(parsed.searchParams.get("mode")).toBe("place");
		expect(parsed.searchParams.get("q")).toBe("place_id:ChIJplace1");
	});

	it("center / zoom / hl は指定したときだけ含める", () => {
		const withoutOptional = new URL(buildMapsEmbedApiUrl({ mode: "search", q: "ramen" }));
		expect(withoutOptional.searchParams.has("center")).toBe(false);
		expect(withoutOptional.searchParams.has("zoom")).toBe(false);
		expect(withoutOptional.searchParams.has("hl")).toBe(false);

		const withOptional = new URL(
			buildMapsEmbedApiUrl({
				mode: "search",
				q: "ramen",
				center: { latitude: 35.6, longitude: 139.7 },
				zoom: 15,
				hl: "ja",
			}),
		);
		expect(withOptional.searchParams.get("center")).toBe("35.6,139.7");
		expect(withOptional.searchParams.get("zoom")).toBe("15");
		expect(withOptional.searchParams.get("hl")).toBe("ja");
	});
});
