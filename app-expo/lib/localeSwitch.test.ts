import { replaceLocaleInPath } from "./localeSwitch";

describe("replaceLocaleInPath", () => {
	it("先頭セグメントのロケールだけを差し替え、以降のパスは保つ", () => {
		expect(replaceLocaleInPath("/ja-JP/profile/settings", "en-US")).toBe("/en-US/profile/settings");
	});

	it("ロケール直下（末尾スラッシュ無し）でも動く", () => {
		expect(replaceLocaleInPath("/ja-JP", "en-US")).toBe("/en-US");
	});

	it("深いパスでも先頭だけを差し替える", () => {
		expect(replaceLocaleInPath("/ja-JP/review/restaurant/abc123", "fr-FR")).toBe("/fr-FR/review/restaurant/abc123");
	});

	it("先頭セグメントがロケールの形でなければロケール直下へフォールバックする", () => {
		expect(replaceLocaleInPath("/s/token123", "en-US")).toBe("/en-US");
	});
});
