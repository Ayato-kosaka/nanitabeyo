import { readPushCache } from "./pushTokenCache";

/**
 * #1599 SecureStore の値が壊れていると `JSON.parse` が throw していた件。
 *
 * 投げた先の catch は「番人を外して次の再描画で再試行する」作りなので、
 * 壊れた値がある限り
 *
 *   再描画 → parse で throw → error ログ → 番人を外す → 再描画 → …
 *
 * を繰り返す。しかも throw は `SecureStore.setItemAsync`（壊れた値を上書きする行）
 * **より前**で起きるので、**キャッシュは永遠に直らない**。
 * その端末では Push 通知が二度と登録されない。
 *
 * キャッシュは «速くするためだけのもの» なので、読めない値は «無い» に倒す。
 * そうすれば needsSync が立ち、通常の登録経路が走って壊れた値を上書きする（自己修復）。
 */
describe("#1599 readPushCache", () => {
	const valid = {
		token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
		userId: "11111111-1111-4111-8111-111111111111",
		platform: "ios",
		appVersion: "1.14.0",
	};

	it("正しいキャッシュはそのまま返す", () => {
		expect(readPushCache(JSON.stringify(valid))).toEqual(valid);
	});

	it("appVersion が無くても通す（省略可能なので）", () => {
		const { appVersion: _omit, ...withoutVersion } = valid;
		expect(readPushCache(JSON.stringify(withoutVersion))).toEqual(withoutVersion);
	});

	it.each([
		["", "空文字"],
		[null, "null"],
		[undefined, "undefined"],
	])("%s は «キャッシュ無し» として null（%s）", (raw, _label) => {
		expect(readPushCache(raw as string | null | undefined)).toBeNull();
	});

	it.each([
		["{", "途中で切れた JSON"],
		["not json at all", "JSON ではない"],
		['{"token":', "キーだけ"],
	])("壊れた値でも throw せず null を返す: %s（%s）", (raw, _label) => {
		expect(() => readPushCache(raw)).not.toThrow();
		expect(readPushCache(raw)).toBeNull();
	});

	it.each([
		["null", "JSON としては妥当だがオブジェクトでない"],
		["[]", "配列"],
		["123", "数値"],
		['"string"', "文字列"],
		['{"token":123,"userId":"u","platform":"ios"}', "token が数値"],
		['{"userId":"u","platform":"ios"}', "token が無い"],
		['{"token":"t","platform":"ios"}', "userId が無い"],
		['{"token":"t","userId":"u"}', "platform が無い"],
	])("JSON として読めても形が違えば null: %s（%s）", (raw, _label) => {
		expect(readPushCache(raw)).toBeNull();
	});

	it("【回帰】どんな入力でも決して throw しない", () => {
		// ここが本体。throw する経路が 1 つでも残ると、その端末の Push 登録が
		// 永久に直らなくなる
		const inputs = ["", "{", "}", "[", "undefined", "NaN", "{'token':'t'}", "\\", '{"a":', "🙂", "a".repeat(10000)];
		for (const raw of inputs) {
			expect(() => readPushCache(raw)).not.toThrow();
		}
	});
});
