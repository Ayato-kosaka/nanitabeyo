import * as fs from "node:fs";
import * as path from "node:path";
// 注: このテストはブラウザを一切使わない Node 単体の検証のため、例外的に
// fixtures/test ではなく @playwright/test を直接 import する
// (firebase-rewrites.spec.ts と同じ理由)
import { test, expect } from "@playwright/test";

/**
 * 🔒 #2071 戻るボタンの locator が «画面ごとの id» を指しているかの静的検査
 *
 * ## なぜ要るか（起きた事故）
 *
 * `ScreenHeader` は #1404 でこう決めた:
 *
 *     const backTestID = testID ? `${testID}-back` : "screen-header-back";
 *
 * つまり **画面が `testID` を渡し始めた瞬間に、その画面の戻るボタンの id が変わる**。
 *
 * 2026-09-21 の夜間から `review-no-photo.spec.ts` が «戻るボタンが 0 件» で落ち続けていた。
 * 原因は #1579 で `review.tsx` のヘッダーを分岐の外へ括り出したときに
 * `testID="restaurant-review-screen"` が付き、id が `restaurant-review-screen-back` へ
 * 変わったこと。**e2e-mobile の Screen Object は同じ PR で追随したのに、e2e-web が
 * 取り残された。** アプリは 1 バイトも壊れていないのに、夜間が 4 夜以上赤かった。
 *
 * これは #1404 / #1579 / #1742 と同じ形で **4 度目**である（規約を 1 箇所へ書いて兄弟が古いまま）。
 * だから機械で縛る。
 *
 * ## 何を縛るか
 *
 * **e2e-web の locator から `screen-header-back` を禁止する。** あれは «testID を渡していない
 * 画面» のための後方互換の既定値であって、特定の画面を検証する spec が指してよい id ではない
 * （#1404 の実測どおり、push した画面と背面の画面が同時に DOM に居ると 2 件に当たって
 * strict mode violation でも落ちる）。画面ごとの `${testID}-back` を使うこと。
 *
 * ⚠️ **コメントの中の言及は許す。** 経緯を書き残せなくなると、次の人が同じ id へ戻す。
 */

const E2E_WEB_ROOT = path.resolve(__dirname, "../..");
const SEARCH_DIRS = ["tests", "pages", "utils", "fixtures"];
const AMBIGUOUS_BACK_TESTID = "screen-header-back";
/** この検査ファイル自身の名前（走査から除くため。理由は下の filter のコメント） */
const SELF_FILE_NAME = "screen-header-back-locators.spec.ts";

/** `//` 行コメントと `/* *\/` ブロックコメントを空白へ潰す（文字列リテラルの中は残す） */
const stripComments = (source: string): string => {
	let out = "";
	let i = 0;
	let quote: string | null = null;
	while (i < source.length) {
		const ch = source[i];
		const next = source[i + 1];
		if (quote) {
			if (ch === "\\") {
				out += "  ";
				i += 2;
				continue;
			}
			if (ch === quote) quote = null;
			out += ch;
			i += 1;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch;
			out += ch;
			i += 1;
			continue;
		}
		if (ch === "/" && next === "/") {
			while (i < source.length && source[i] !== "\n") {
				out += " ";
				i += 1;
			}
			continue;
		}
		if (ch === "/" && next === "*") {
			i += 2;
			out += "  ";
			while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
				out += source[i] === "\n" ? "\n" : " ";
				i += 1;
			}
			i += 2;
			out += "  ";
			continue;
		}
		out += ch;
		i += 1;
	}
	return out;
};

const listTsFiles = (dir: string): string[] => {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return listTsFiles(full);
		return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
	});
};

test.describe("#2071 戻るボタンの locator", () => {
	// ⚠️ **この検査自身を除く。** 禁止する id を文字列リテラルとして持っているので、
	//    除かないと «自分が唯一の違反者» になって永久に赤い（偽陽性は見逃しより質が悪い）。
	const files = SEARCH_DIRS.flatMap((dir) => listTsFiles(path.join(E2E_WEB_ROOT, dir))).filter(
		(file) => path.basename(file) !== SELF_FILE_NAME,
	);

	test("検査対象のファイルが実際に見つかる（0 件で緑にならない）", () => {
		// ⚠️ «見に行った先が空» で緑になる検査は緑の意味を持たない（#1936 と同じ理由）
		expect(files.length).toBeGreaterThan(30);
	});

	test(`locator に ${AMBIGUOUS_BACK_TESTID} を使っていない（画面ごとの \${testID}-back を使う）`, () => {
		const offenders = files
			.map((file) => ({ file, code: stripComments(fs.readFileSync(file, "utf8")) }))
			.filter(({ code }) => code.includes(AMBIGUOUS_BACK_TESTID))
			.map(({ file }) => path.relative(E2E_WEB_ROOT, file));

		expect(
			offenders,
			[
				`e2e-web の locator に "${AMBIGUOUS_BACK_TESTID}" が残っています。`,
				"ScreenHeader は testID を渡している画面では `${testID}-back` を描きます（#1404）。",
				"その画面の testID を使ってください（例: restaurant-review-screen-back）。",
			].join("\n"),
		).toEqual([]);
	});

	test("コメントの中の言及は違反にしない（経緯を書き残せる）", () => {
		// ⚠️ この検査自体が «コメント除去が効いていること» の対照実験である。
		//    除去を壊すと、いま現に上の test が赤くなる（このファイルも本文で言及しているため）。
		const code = stripComments(`
			// 汎用の ${AMBIGUOUS_BACK_TESTID} は使わない
			/* ${AMBIGUOUS_BACK_TESTID} */
			const ok = page.getByTestId("restaurant-review-screen-back");
		`);
		expect(code).not.toContain(AMBIGUOUS_BACK_TESTID);
		expect(code).toContain("restaurant-review-screen-back");
	});

	test("文字列リテラルの中は残す（除去が行き過ぎていない）", () => {
		const code = stripComments(`const id = "${AMBIGUOUS_BACK_TESTID}";`);
		expect(code).toContain(AMBIGUOUS_BACK_TESTID);
	});
});
