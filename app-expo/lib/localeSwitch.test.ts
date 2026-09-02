import { localeSwitchLandingPath, replaceLocaleInPath } from "./localeSwitch";

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

describe("#1629【28】localeSwitchLandingPath — 言語切替の着地先はタブの根", () => {
	it("プロフィール配下の深い画面から切り替えても、プロフィールの根へ降りる", () => {
		expect(localeSwitchLandingPath("/ja-JP/profile/language", "en-US")).toBe("/en-US/profile");
		expect(localeSwitchLandingPath("/ja-JP/profile/device-settings", "en-US")).toBe("/en-US/profile");
	});

	it("タブの根に居るときはそのまま", () => {
		expect(localeSwitchLandingPath("/ja-JP/profile", "en-US")).toBe("/en-US/profile");
	});

	it("ロケールしか無いときはロケールの根", () => {
		expect(localeSwitchLandingPath("/ja-JP", "en-US")).toBe("/en-US");
	});

	// ⚠️ «いまのパスをそのまま持っていく» に戻すと、戻るが効かなくなる（#1629【28】）
	it("いまのパスをそのまま返してはいけない", () => {
		expect(localeSwitchLandingPath("/ja-JP/profile/language", "en-US")).not.toBe("/en-US/profile/language");
	});
});
