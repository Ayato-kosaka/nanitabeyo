import { buildExternalEmbedPlayerSource, isAllowedEmbedNavigation } from "./embedUrl";

describe("buildExternalEmbedPlayerSource", () => {
	it("instagram はリールのコードでも /p/{code}/embed/ を組む（captioned は白カードが付くので使わない）", () => {
		expect(buildExternalEmbedPlayerSource("instagram", "DZnIRziT70s")).toEqual({
			embedUrl: "https://www.instagram.com/p/DZnIRziT70s/embed/",
			providerLabel: "Instagram",
		});
	});

	it("tiktok は embed/v2、youtube は playsinline 付き embed", () => {
		expect(buildExternalEmbedPlayerSource("tiktok", "6718335390845095173")?.embedUrl).toBe(
			"https://www.tiktok.com/embed/v2/6718335390845095173",
		);
		expect(buildExternalEmbedPlayerSource("youtube", "abc123")?.embedUrl).toBe(
			"https://www.youtube.com/embed/abc123?playsinline=1&autoplay=1&mute=1",
		);
	});

	it("id は URL エンコードする（パス注入をさせない）", () => {
		expect(buildExternalEmbedPlayerSource("instagram", "a/../b")?.embedUrl).toBe(
			"https://www.instagram.com/p/a%2F..%2Fb/embed/",
		);
	});

	it("未知 provider と空 id は null（呼び出し側が外部で開くへ縮退）", () => {
		expect(buildExternalEmbedPlayerSource("x", "abc")).toBeNull();
		expect(buildExternalEmbedPlayerSource("instagram", "")).toBeNull();
	});
});

describe("isAllowedEmbedNavigation", () => {
	it("http(s) と about: は通す（埋め込み内部のリダイレクト・広告フレームを打ち切らない）", () => {
		expect(isAllowedEmbedNavigation("https://www.instagram.com/p/abc/embed/?cr=1")).toBe(true);
		expect(isAllowedEmbedNavigation("http://example.com/redirected")).toBe(true);
		expect(isAllowedEmbedNavigation("about:blank")).toBe(true);
	});

	it("アプリ起動スキームは遮断する", () => {
		expect(isAllowedEmbedNavigation("intent://reel/abc#Intent;package=com.instagram.android;end")).toBe(false);
		expect(isAllowedEmbedNavigation("market://details?id=com.instagram.android")).toBe(false);
		expect(isAllowedEmbedNavigation("javascript:alert(1)")).toBe(false);
	});
});
