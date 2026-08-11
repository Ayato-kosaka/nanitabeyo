// #1194 「アプリで開く」の遷移先が環境ごとに正しく切り替わること。
//
// 実機で踏んだ症状:
//   Android + Instagram のアプリ内ブラウザで投票の共有 URL を開き
//   「アプリで開く」を押しても Instagram のブラウザから出られない。
// https のままだと WebView 内でナビゲーションが完結し App Links が発火しないため。
//
// ⚠️ 「動いている経路を巻き添えにしない」ことも仕様なので、
// 通常 Chrome / LINE / iOS が従来どおりであることまでテストで固定する。

import { buildAndroidIntentUrl, isInAppBrowser, isMetaInAppBrowser, resolveOpenInAppHref } from "./openInAppUrl";

const UA = {
	androidInstagram:
		"Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 320.0.0.42.101 Android",
	androidFacebook:
		"Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.32.109;]",
	androidLine:
		"Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Line/14.2.0",
	androidChrome:
		"Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
	iosInstagram:
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.42.101",
	iosSafari:
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

const PACKAGE = "com.nanitabeyo";
const UNIVERSAL = "https://app.nanitabeyo.net/ja-JP/search/dish-category-group-votes/tok123/vote?a=1";
const RELAY = "https://oia-relay.web.app/oia/open/?u=encoded";
const STORE = "https://play.google.com/store/apps/details?id=com.nanitabeyo";

describe("#1194 アプリ内ブラウザの判定", () => {
	it("Meta 系（Instagram / Facebook）を Meta の IAB として判定する", () => {
		expect(isMetaInAppBrowser(UA.androidInstagram)).toBe(true);
		expect(isMetaInAppBrowser(UA.androidFacebook)).toBe(true);
	});

	it("LINE / 通常 Chrome は Meta 系ではない", () => {
		expect(isMetaInAppBrowser(UA.androidLine)).toBe(false);
		expect(isMetaInAppBrowser(UA.androidChrome)).toBe(false);
	});

	it("LINE は «何らかの IAB» としては判定する（案内 UI の出し分け用）", () => {
		expect(isInAppBrowser(UA.androidLine)).toBe(true);
		expect(isInAppBrowser(UA.androidChrome)).toBe(false);
	});
});

describe("#1194 Android の intent URI", () => {
	it("host から始まり、scheme と package を fragment 側に持つ", () => {
		const intent = buildAndroidIntentUrl(UNIVERSAL, PACKAGE);

		// ⚠️ `intent://https://…` になっていないこと。この取り違えは «何も起きない» で終わる
		expect(intent).toBe(
			"intent://app.nanitabeyo.net/ja-JP/search/dish-category-group-votes/tok123/vote?a=1" +
				"#Intent;scheme=https;package=com.nanitabeyo;end",
		);
	});

	it("ストア URL を渡すと fallback がエンコードされて載る", () => {
		const intent = buildAndroidIntentUrl(UNIVERSAL, PACKAGE, STORE)!;

		// 素の `?`/`=` が残ると Intent URI のパラメータ解析が壊れる
		expect(intent).toContain(`S.browser_fallback_url=${encodeURIComponent(STORE)}`);
		expect(intent).not.toContain("S.browser_fallback_url=https://play.google.com");
		expect(intent.endsWith(";end")).toBe(true);
	});

	it("https 以外や壊れた URL は null（呼び出し側が https へ退避できる）", () => {
		expect(buildAndroidIntentUrl("nanitabeyo:///ja-JP/search", PACKAGE)).toBeNull();
		expect(buildAndroidIntentUrl("not a url", PACKAGE)).toBeNull();
	});
});

describe("#1194 「アプリで開く」の遷移先", () => {
	const href = (userAgent: string) =>
		resolveOpenInAppHref({
			universalUrl: UNIVERSAL,
			userAgent,
			relayUrl: RELAY,
			storeUrl: STORE,
			androidPackage: PACKAGE,
		});

	it("Android + Instagram では intent:// を返す（これが今回の修正の本体）", () => {
		expect(href(UA.androidInstagram).startsWith("intent://app.nanitabeyo.net/")).toBe(true);
	});

	it("Android + Facebook でも intent:// を返す", () => {
		expect(href(UA.androidFacebook).startsWith("intent://")).toBe(true);
	});

	// ⚠️ 実機で «開ける» ことを確認済みの経路。動いているものを巻き添えにしない
	it("Android + LINE は従来どおり https のまま", () => {
		expect(href(UA.androidLine)).toBe(UNIVERSAL);
	});

	it("通常の Android Chrome も https のまま（App Links が素直に効く）", () => {
		expect(href(UA.androidChrome)).toBe(UNIVERSAL);
	});

	it("iOS は IAB かどうかに関わらず relay 経由（intent:// は Android 専用）", () => {
		expect(href(UA.iosSafari)).toBe(RELAY);
		expect(href(UA.iosInstagram)).toBe(RELAY);
	});

	it("relay が無い iOS は universal URL へ退避する", () => {
		expect(
			resolveOpenInAppHref({
				universalUrl: UNIVERSAL,
				userAgent: UA.iosSafari,
				androidPackage: PACKAGE,
			}),
		).toBe(UNIVERSAL);
	});
});
