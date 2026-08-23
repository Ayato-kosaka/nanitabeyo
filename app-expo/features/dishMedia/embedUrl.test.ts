import { buildExternalEmbedPlayerSource } from "./embedUrl";

describe("buildExternalEmbedPlayerSource", () => {
	it("instagram はリールのコードでも /p/{code}/embed/captioned/ を組む", () => {
		expect(buildExternalEmbedPlayerSource("instagram", "DZnIRziT70s")).toEqual({
			embedUrl: "https://www.instagram.com/p/DZnIRziT70s/embed/captioned/",
			providerLabel: "Instagram",
		});
	});

	it("tiktok は embed/v2、youtube は playsinline 付き embed", () => {
		expect(buildExternalEmbedPlayerSource("tiktok", "6718335390845095173")?.embedUrl).toBe(
			"https://www.tiktok.com/embed/v2/6718335390845095173",
		);
		expect(buildExternalEmbedPlayerSource("youtube", "abc123")?.embedUrl).toBe(
			"https://www.youtube.com/embed/abc123?playsinline=1",
		);
	});

	it("id は URL エンコードする（パス注入をさせない）", () => {
		expect(buildExternalEmbedPlayerSource("instagram", "a/../b")?.embedUrl).toBe(
			"https://www.instagram.com/p/a%2F..%2Fb/embed/captioned/",
		);
	});

	it("未知 provider と空 id は null（呼び出し側が外部で開くへ縮退）", () => {
		expect(buildExternalEmbedPlayerSource("x", "abc")).toBeNull();
		expect(buildExternalEmbedPlayerSource("instagram", "")).toBeNull();
	});
});
