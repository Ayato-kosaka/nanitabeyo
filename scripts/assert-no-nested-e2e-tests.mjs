// #1590 【設計】e2e の spec に «test()/it() の入れ子» が無いことを保証する。
//
// 入れ子になった test は **1 度も実行されない**（Playwright / Jest とも、
// 外側の test の実行中に登録された test は無視される）。構文としては正しいので
// tsc も eslint も気づかず、CI は緑のまま «検証しているつもり» になる。
//
// このリポジトリで実際に 2 度起きた:
//   - e2e-web/tests/profile/settings.spec.ts
//     «バージョン情報が表示される» の中へ «匿名時は通知カードが表示されない» が入れ子になり、
//     バージョンも通知カードもどちらも assert されていなかった
//   - e2e-mobile/tests/profile/settings.test.ts
//     ハプティクスの it が閉じられないまま通知の it が入れ子になっていた
//
// どちらもマージ後にベース取り込みで偶然見つかったもので、
// «見つからなければそのまま出ていた» 類の欠陥である。
//
// 使い方: node ./scripts/assert-no-nested-e2e-tests.mjs [走査するディレクトリ...]

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOTS = process.argv.slice(2).length ? process.argv.slice(2) : ["e2e-web/tests", "e2e-mobile/tests"];
const findings = [];

function walk(dir) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p);
		else if (/\.(spec|test)\.ts$/.test(name)) scan(p);
	}
}

/**
 * 文字列・テンプレート・コメント・**正規表現リテラル**を同じ長さの空白へ潰す（行番号を保つ）。
 *
 * ⚠️ **1 パスの走査でやること。** 置換を順番に掛ける書き方だと必ず破綻する。実際に踏んだ 2 つ:
 *
 *   1. `//` を含む正規表現（`/^https:\/\/x\//`）を先に潰さないと、`//` の行コメント規則が
 *      **その行の残りを食う**。`toMatch(` を閉じる `)` が消えて括弧が釣り合わなくなる
 *   2. かといって正規表現を先に潰すと、**文字列の中の `https://`** が «`:` の直後の `/`»
 *      に見えて正規表現の開始と誤認される
 *
 * ⚠️ **誤検知より怖いのは逆である。** どちらの壊れ方でも行の残りが消えるので、
 *    **本物の入れ子を見逃す**（このガードが守りたいものが素通りする）。
 *    2026-09-05 に 1 の形で誤検知、その修正の検証で 2 の形の見逃しを実測した。
 *
 * `/` が除算か正規表現かは «直前の意味のあるトークン» で決める（定番の見分け方）。
 * 値が来たあと（識別子・数値・`)`・`]`）の `/` は除算、それ以外は正規表現の開始とみなす。
 */
function blank(src) {
	const out = src.split("");
	const keep = (i) => (src[i] === "\n" ? "\n" : " ");
	let i = 0;
	let prev = ""; // 直前の «意味のある» 文字（空白・コメントを飛ばしたもの）

	while (i < src.length) {
		const c = src[i];
		const next = src[i + 1];

		// 行コメント
		if (c === "/" && next === "/") {
			while (i < src.length && src[i] !== "\n") ((out[i] = keep(i)), i++);
			continue;
		}
		// ブロックコメント
		if (c === "/" && next === "*") {
			const close = src.indexOf("*/", i + 2);
			const stop = close === -1 ? src.length : close + 2;
			while (i < stop) ((out[i] = keep(i)), i++);
			continue;
		}
		// 文字列・テンプレート
		if (c === '"' || c === "'" || c === "`") {
			const quote = c;
			i++; // 開き記号はそのまま残す（括弧の数え方に影響しない）
			while (i < src.length) {
				if (src[i] === "\\") {
					out[i] = keep(i);
					out[i + 1] = keep(i + 1);
					i += 2;
					continue;
				}
				if (src[i] === quote) break;
				out[i] = keep(i);
				i++;
			}
			i++; // 閉じ記号
			prev = quote;
			continue;
		}
		// 正規表現リテラル（直前が «値» でなければ）
		if (c === "/" && !/[\w$)\]]/.test(prev)) {
			let j = i + 1;
			let inClass = false;
			let closed = false;
			while (j < src.length && src[j] !== "\n") {
				if (src[j] === "\\") {
					j += 2;
					continue;
				}
				if (src[j] === "[") inClass = true;
				else if (src[j] === "]") inClass = false;
				else if (src[j] === "/" && !inClass) {
					closed = true;
					break;
				}
				j++;
			}
			if (closed) {
				// 中身とフラグを空白へ。前後の `/` は残す（括弧ではないので影響しない）
				let k = i + 1;
				while (k < j) ((out[k] = keep(k)), k++);
				i = j + 1;
				while (i < src.length && /[gimsuy]/.test(src[i])) ((out[i] = keep(i)), i++);
				prev = "/";
				continue;
			}
		}
		if (!/\s/.test(c)) prev = c;
		i++;
	}
	return out.join("");
}

function scan(file) {
	const src = readFileSync(file, "utf8");
	const s = blank(src);
	const lineOf = (i) => s.slice(0, i).split("\n").length;

	// test( / it( の呼び出しを «開始 index → 対応する ) の index» で範囲化する
	const calls = [];
	const re = /(^|[^\w.$])(test|it)\s*\(/g;
	let m;
	while ((m = re.exec(s))) {
		const open = m.index + m[0].length - 1; // '(' の位置
		let depth = 0;
		let end = -1;
		for (let i = open; i < s.length; i++) {
			if (s[i] === "(") depth++;
			else if (s[i] === ")") {
				depth--;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		if (end !== -1) calls.push({ start: m.index + m[0].length - m[2].length - 1, open, end });
	}

	for (const c of calls) {
		const outer = calls.find((o) => o !== c && o.open < c.start && c.end < o.end);
		if (outer) findings.push({ file, line: lineOf(c.start), outerLine: lineOf(outer.start) });
	}
}

/*
⚠️ **ガード自身が壊れていないかを見る。**

このガードは «通れば安全» ではなく «落ちたら確実に壊れている» の側なので、
`blank()` が行の残りを食うと **本物の入れ子を見逃す**（守りたいものが素通りする）。
2026-09-05 に実際に 2 つの形で見逃していたことを実測したので、その形を固定する。

    node ./scripts/assert-no-nested-e2e-tests.mjs --self-test
*/
function selfTest() {
	const dir = mkdtempSync(join(tmpdir(), "assert-nested-"));
	const write = (name, body) => writeFileSync(join(dir, name), body, "utf8");

	// 検知されなければならない 3 つ
	write("a-plain.spec.ts", 'test("outer", async () => {\n  test("inner", async () => {});\n});\n');
	// ← 修正前は «//» を含む正規表現が行コメント扱いされ、括弧が釣り合わず見逃していた
	write(
		"b-regex.spec.ts",
		'test("outer", async () => {\n  expect(u).toMatch(/^https:\\/\\/x\\//);\n  test("inner", async () => {});\n});\n',
	);
	// ← 正規表現を先に潰す実装にすると、今度は文字列中の «https://» を正規表現と誤認して見逃す
	write(
		"c-url-string.spec.ts",
		'test("outer", async () => {\n  const u = "https://www.google.com/maps/search/";\n  test("inner", async () => {});\n});\n',
	);
	// 検知されてはならない 1 つ（上の 2 つを両方含むが入れ子ではない）
	write(
		"d-clean.spec.ts",
		'test("a", async () => {\n  const u = "https://x/y";\n  expect(u).toMatch(/^https:\\/\\/x\\//);\n});\ntest("b", async () => {});\n',
	);

	walk(dir);
	const got = new Set(findings.map((f) => f.file.split("/").pop()));
	rmSync(dir, { recursive: true, force: true });

	const problems = [];
	for (const name of ["a-plain.spec.ts", "b-regex.spec.ts", "c-url-string.spec.ts"]) {
		if (!got.has(name)) problems.push(`${name} の入れ子を **見逃した**`);
	}
	if (got.has("d-clean.spec.ts")) problems.push("d-clean.spec.ts を誤検知した");

	if (problems.length) {
		console.error("❌ ガード自身の自己診断に失敗しました:");
		for (const p of problems) console.error(`   ${p}`);
		process.exit(1);
	}
	console.log("✅ ガード自身の自己診断: 入れ子 3 形を検知し、正常な spec は誤検知しません");
	process.exit(0);
}

if (process.argv.includes("--self-test")) selfTest();

for (const r of ROOTS) walk(r);
if (findings.length) {
	console.error("❌ test()/it() の入れ子を検出しました（内側の中身は 1 度も実行されません）:");
	for (const f of findings) console.error(`   ${f.file}:${f.line}（外側の test は ${f.outerLine} 行目）`);
	process.exit(1);
}
console.log(`✅ e2e の spec に test()/it() の入れ子はありません`);
