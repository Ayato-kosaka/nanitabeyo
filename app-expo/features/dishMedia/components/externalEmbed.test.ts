import { buildExternalEmbedDocument, isProviderNavigationUrl } from "./externalEmbed";

describe("external dish media embed", () => {
	it("providerごとのCSPに閉じ込める", () => {
		const html = buildExternalEmbedDocument({
			provider: "instagram",
			externalContentId: "abc",
			canonicalUrl: "https://www.instagram.com/p/abc/",
			embedHtml: '<blockquote class="instagram-media"></blockquote>',
			thumbnailUrl: null,
			publishedAt: null,
			lastVerifiedAt: "2026-08-12T00:00:00Z",
		});

		expect(html).toContain("Content-Security-Policy");
		expect(html).toContain("https://*.instagram.com");
		expect(html).not.toContain("https://*.tiktok.com");
		expect(html).toContain("form-action 'none'");
	});

	it("WebView内のtop-level遷移は同じproviderだけ許可する", () => {
		expect(isProviderNavigationUrl("x", "https://x.com/example/status/1")).toBe(true);
		expect(isProviderNavigationUrl("x", "https://help.twitter.com/example")).toBe(true);
		expect(isProviderNavigationUrl("x", "https://evil.example/phishing")).toBe(false);
		expect(isProviderNavigationUrl("x", "javascript:alert(1)")).toBe(false);
	});

	// #1273 ①で確立した無料の発見手法は YouTube 由来なので、provider allowlist に
	// youtube が入っていないと発見した dish_media を1件も描画できない。
	it("youtube の埋め込みを YouTube ドメインだけに閉じ込める", () => {
		const html = buildExternalEmbedDocument({
			provider: "youtube",
			externalContentId: "5Oj2xzV83vo",
			canonicalUrl: "https://www.youtube.com/watch?v=5Oj2xzV83vo",
			embedHtml: '<iframe src="https://www.youtube.com/embed/5Oj2xzV83vo"></iframe>',
			thumbnailUrl: null,
			publishedAt: null,
			lastVerifiedAt: "2026-08-14T00:00:00Z",
		});

		expect(html).toContain("Content-Security-Policy");
		expect(html).toContain("https://*.youtube.com");
		// privacy-enhanced mode の iframe も同じ document で描画できる
		expect(html).toContain("https://*.youtube-nocookie.com");
		// 他 provider のドメインは混入しない
		expect(html).not.toContain("https://*.instagram.com");
		expect(html).not.toContain("https://*.tiktok.com");
	});

	it("youtube の top-level 遷移は YouTube ドメインだけ許可する", () => {
		expect(isProviderNavigationUrl("youtube", "https://www.youtube.com/watch?v=5Oj2xzV83vo")).toBe(true);
		expect(isProviderNavigationUrl("youtube", "https://youtu.be/5Oj2xzV83vo")).toBe(true);
		expect(isProviderNavigationUrl("youtube", "https://www.youtube-nocookie.com/embed/5Oj2xzV83vo")).toBe(true);
		expect(isProviderNavigationUrl("youtube", "https://evil.example/phishing")).toBe(false);
		// provider を跨いだ遷移は許さない
		expect(isProviderNavigationUrl("youtube", "https://x.com/example/status/1")).toBe(false);
	});
});
