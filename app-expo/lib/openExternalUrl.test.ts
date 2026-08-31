/**
 * #1121 `openExternalUrl` の分岐テスト。
 *
 * Web で `Linking.openURL()` が呼ばれると同一タブ遷移になり、`/ja-JP/search/dish-categories` の
 * Google Maps fallback が「戻るとエラー」になる。ここが退行すると画面側では気付けないので、
 * Web / ネイティブそれぞれで **どちらの API を呼ぶか** を固定する。
 *
 * `Platform.OS` は jest-expo 側で固定されているため、モジュールごと差し替えて読み直す。
 */

type OpenExternalUrl = (url: string) => Promise<void>;

const URL_TO_OPEN = "https://www.google.com/maps/search/?api=1&query=%E3%83%A9%E3%83%BC%E3%83%A1%E3%83%B3";

const loadOpenExternalUrl = (os: string, linkingOpenURL: jest.Mock): OpenExternalUrl => {
	jest.resetModules();
	// jest.doMock はホイストされないので、テストごとに OS を変えて読み直せる
	jest.doMock("react-native", () => ({ Platform: { OS: os } }));
	jest.doMock("expo-linking", () => ({ openURL: linkingOpenURL }));
	return require("./openExternalUrl").openExternalUrl;
};

describe("#1121 openExternalUrl", () => {
	describe("Web", () => {
		it("別タブで開き、Linking.openURL（同一タブ遷移）は呼ばない", async () => {
			const linkingOpenURL = jest.fn();
			const windowOpen = jest.fn().mockReturnValue({});
			(globalThis as any).window = { open: windowOpen };

			const openExternalUrl = loadOpenExternalUrl("web", linkingOpenURL);
			await openExternalUrl(URL_TO_OPEN);

			expect(windowOpen).toHaveBeenCalledWith(URL_TO_OPEN, "_blank", "noopener,noreferrer");
			expect(linkingOpenURL).not.toHaveBeenCalled();
		});

		it("ポップアップブロックで null が返っても throw せず、同一タブへ fallback しない", async () => {
			const linkingOpenURL = jest.fn();
			// ブロックされたブラウザは null を返す
			const windowOpen = jest.fn().mockReturnValue(null);
			(globalThis as any).window = { open: windowOpen };

			const openExternalUrl = loadOpenExternalUrl("web", linkingOpenURL);

			await expect(openExternalUrl(URL_TO_OPEN)).resolves.toBeUndefined();
			expect(linkingOpenURL).not.toHaveBeenCalled();
		});
	});

	describe("ネイティブ", () => {
		it.each(["ios", "android"])("%s では Linking.openURL へ委ねる", async (os) => {
			const linkingOpenURL = jest.fn().mockResolvedValue(true);
			const windowOpen = jest.fn();
			(globalThis as any).window = { open: windowOpen };

			const openExternalUrl = loadOpenExternalUrl(os, linkingOpenURL);
			await openExternalUrl(URL_TO_OPEN);

			expect(linkingOpenURL).toHaveBeenCalledWith(URL_TO_OPEN);
			expect(windowOpen).not.toHaveBeenCalled();
		});

		it("Linking.openURL の失敗（対応アプリ無しなど）はそのまま呼び出し側へ伝える", async () => {
			// useGoogleMapsFallback の google_maps_fallback_open_failed ログはこの reject に依存している
			const linkingOpenURL = jest.fn().mockRejectedValue(new Error("No Activity found to handle Intent"));

			const openExternalUrl = loadOpenExternalUrl("ios", linkingOpenURL);

			await expect(openExternalUrl(URL_TO_OPEN)).rejects.toThrow("No Activity found to handle Intent");
		});
	});
});
