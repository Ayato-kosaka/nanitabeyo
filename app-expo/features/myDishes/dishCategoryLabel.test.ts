/*
#1375（オーナー実機指摘「うどんで絞ったら udon が出る」）

表示名の決め方を固定する。⚠️ ここが落ちたら、日本語 UI にローマ字が混ざる状態へ戻る。

#1629（オーナー確定）**`dishes.name` へは落とさない。**

> dishes.name を使うのではなく、dish_categories から locale で引いて欲しい。
> dishes.name は廃止にしても良いカラムだと思っています。

以前は最後に «その店での呼び名»（`dishes.name`）へ落としていた。そのせいで
取り込み由来の行に «udon» が出たうえ、`dishes.name` が **空**の行では空文字が
«表示名» として下流へ流れ、料理カテゴリー欄が空欄のまま投稿できなくなっていた。
*/
import { resolveDishCategoryLabel } from "./dishCategoryLabel";

describe("resolveDishCategoryLabel", () => {
	it("ユーザーの言語の表記を最優先する", () => {
		expect(resolveDishCategoryLabel({ ja: "うどん", en: "Udon" }, "ja-JP")).toBe("うどん");
	});

	it("その言語の表記が無ければ英語へ落とす", () => {
		expect(resolveDishCategoryLabel({ en: "Udon" }, "ko-KR")).toBe("Udon");
	});

	// ★ ここが #1629 の要点。呼び名へ落とさず null を返し、呼び出し側が «出さない» を選ぶ
	it("表記が 1 つも無ければ null（店での呼び名へは落とさない）", () => {
		expect(resolveDishCategoryLabel(null, "ja-JP")).toBeNull();
		expect(resolveDishCategoryLabel({}, "ja-JP")).toBeNull();
		expect(resolveDishCategoryLabel(undefined, "ja-JP")).toBeNull();
	});

	it("ロケールは言語コードへ落として引く（ja-JP → ja）", () => {
		expect(resolveDishCategoryLabel({ ja: "うどん" }, "ja-JP")).toBe("うどん");
	});

	it("空文字の表記は «無い» とみなす（空のラベルを表示しない）", () => {
		expect(resolveDishCategoryLabel({ ja: "", en: "Udon" }, "ja-JP")).toBe("Udon");
		expect(resolveDishCategoryLabel({ ja: "", en: "" }, "ja-JP")).toBeNull();
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
	])("%s でも投げず、英語へ落とす", (_name, locale) => {
		expect(resolveDishCategoryLabel({ en: "Udon" }, locale as string)).toBe("Udon");
		expect(resolveDishCategoryLabel(null, locale as string)).toBeNull();
	});
});
