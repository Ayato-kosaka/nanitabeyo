/*
#1375（オーナー実機指摘「うどんで絞ったら udon が出る」）

表示名の決め方を固定する。⚠️ ここが落ちたら、日本語 UI にローマ字が混ざる状態へ戻る。
*/
import { resolveDishCategoryLabel } from "./dishCategoryLabel";

describe("resolveDishCategoryLabel", () => {
	it("ユーザーの言語の表記を最優先する（店での呼び名がローマ字でも日本語を出す）", () => {
		expect(resolveDishCategoryLabel({ ja: "うどん", en: "Udon" }, "udon", "ja-JP")).toBe("うどん");
	});

	it("その言語の表記が無ければ英語へ落とす", () => {
		expect(resolveDishCategoryLabel({ en: "Udon" }, "udon", "ko-KR")).toBe("Udon");
	});

	it("表記が 1 つも無ければ店での呼び名を使う（何も出ないよりはよい）", () => {
		expect(resolveDishCategoryLabel(null, "きつねうどん", "ja-JP")).toBe("きつねうどん");
		expect(resolveDishCategoryLabel({}, "きつねうどん", "ja-JP")).toBe("きつねうどん");
	});

	it("どちらも無ければ null（QID を代わりに見せない）", () => {
		expect(resolveDishCategoryLabel(null, null, "ja-JP")).toBeNull();
		expect(resolveDishCategoryLabel(undefined, "", "ja-JP")).toBeNull();
	});

	it("ロケールは言語コードへ落として引く（ja-JP → ja）", () => {
		expect(resolveDishCategoryLabel({ ja: "うどん" }, "udon", "ja-JP")).toBe("うどん");
	});

	it("空文字の表記は «無い» とみなす（空のラベルを表示しない）", () => {
		expect(resolveDishCategoryLabel({ ja: "", en: "Udon" }, "udon", "ja-JP")).toBe("Udon");
	});
});

/*
⚠️ `locale` が未設定でも **投げてはいけない**。この関数は描画中に呼ばれるので、
投げると画面ごと落ちる（`i18n.locale` がまだ入っていない瞬間が実在し、実際にテストで踏んだ）。
*/
describe("locale が未設定でも落ちない", () => {
	it.each([
		["undefined", undefined],
		["null", null],
		["空文字", ""],
	])("%s でも投げず、英語 → 店での呼び名の順で落とす", (_name, locale) => {
		expect(resolveDishCategoryLabel({ en: "Udon" }, "udon", locale as string)).toBe("Udon");
		expect(resolveDishCategoryLabel(null, "きつねうどん", locale as string)).toBe("きつねうどん");
	});
});
