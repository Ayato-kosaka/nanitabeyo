import { isGuestUser } from "./authGuest";

/**
 * #1092 PR4b ゲスト判定の境界。
 *
 * `user?.is_anonymous !== false` というコピーが各所にあったが、この式は
 * `is_anonymous` が **undefined**（型上 optional）のときもゲストへ倒れる。
 * ゲートを外して認証未確定から画面が動き出す今、その差が実害（ログイン済みなのに
 * 通知タブ・自分のレビュータブが出ない）になるため、判定を 1 箇所に集めて固定する。
 */
describe("#1092 isGuestUser", () => {
	it("user が居なければゲスト（認証未確定・失敗を含む）", () => {
		expect(isGuestUser(null)).toBe(true);
		expect(isGuestUser(undefined)).toBe(true);
	});

	it("is_anonymous === true はゲスト", () => {
		expect(isGuestUser({ is_anonymous: true })).toBe(true);
	});

	it("is_anonymous === false はログイン済み", () => {
		expect(isGuestUser({ is_anonymous: false })).toBe(false);
	});

	it("is_anonymous が欠けている user はログイン済み扱い（ログイン済みの人から機能を奪わない）", () => {
		expect(isGuestUser({})).toBe(false);
		expect(isGuestUser({ is_anonymous: undefined })).toBe(false);
	});
});
