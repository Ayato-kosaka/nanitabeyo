/*
#1561 `asApiList` は «API を信じない» ための関数なので、
**型が嘘をついている入力**（null / undefined / 配列でないもの）で固定する。
TypeScript 上は起こりえない値なので、テストでは意図的に型を外して渡す。
*/
import { asApiList } from "./apiList";

describe("asApiList", () => {
	it("配列はそのまま返す（同じ参照）", () => {
		const list = [1, 2, 3];
		expect(asApiList(list)).toBe(list);
	});

	it("空配列もそのまま", () => {
		const list: number[] = [];
		expect(asApiList(list)).toBe(list);
	});

	it.each([
		["undefined", undefined],
		["null", null],
		// 実際に落ちた原因はこの形（200 は返るが data が無い / 別の形）
		["オブジェクト", { items: [1] }],
		["文字列", "abc"],
		["数値", 0],
	])("%s は空配列へ落とす", (_name, value) => {
		expect(asApiList(value as unknown as number[])).toEqual([]);
	});

	it("落とした先は毎回新しい配列（呼び出し側が push しても他へ漏れない）", () => {
		const a = asApiList(undefined);
		const b = asApiList(undefined);
		expect(a).not.toBe(b);
	});
});
