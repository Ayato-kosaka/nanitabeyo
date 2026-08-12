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
});
