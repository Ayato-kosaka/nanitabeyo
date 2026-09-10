import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 🛡️ カルーセルの «切れている隣のカード» を掴む locator を検出する CI ゲート（#1742 / #1579）。
 *
 * ## 守る不変条件
 * `DishMediaFeed` は **前後のセルも描く**。したがってカードの中にある `dish-action-*` は
 * 素の `by.id()` だと複数一致し、`atIndex(0)` は **画面端で切れている隣のカード**を掴む。
 * Detox の `toBeVisible()` は «自分の面積の 75% 以上が見えていること» を要求するので、
 * 切れているビューは **永遠に条件を満たさず 25 秒待って落ちる**。
 *
 * 正しい書き方は `screens/ResultScreen.ts` の `activeCardChild()` を使うこと
 *（アプリ側の目印 `dish-media-card-active` の子孫へ限定する）。
 *
 * ## なぜ機械で縛るのか
 * この注意は #1742 が `ResultScreen.ts` の `activeCard` に**日本語で書き残していた**。
 * それでも**同じファイルの真上にある `likeButton` / `saveButton` が古いまま**残り、
 * 09-09 夜間では `reaction-rollback` の 3 件と `dish-media-unarrived-excluded` が
 * これで落ちていた（#1579）。**コメントは grep されない。**
 *
 * ## 対象外（カードの子孫ではないもの）
 * `dish-action-share` / `dish-action-report` は «…» メニュー（別の Modal）の中に描かれる。
 * カードの子孫ではないので限定してはいけない。
 *
 * 使い方: `pnpm --filter app-expo assert:carousel-locator-scope`
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const E2E_ROOT = path.join(repoRoot, "e2e-mobile");

/** «…» メニュー（別 Modal）の中に描かれるので、カードへ限定してはいけない */
const NOT_CARD_CHILDREN = new Set(["dish-action-share", "dish-action-report"]);

const ID_RE = /by\.id\(\s*["'`](dish-action-[a-z-]+)["'`]\s*\)/g;

/**
 * コメントと文字列リテラルを **同じ長さの空白へ潰す**（index を保つので行番号がずれない）。
 *
 * ⚠️ これが無いと **説明文の中の `by.id("dish-action-like")` を «違反» と読む**。
 * 実際、このガードの最初の版は自分が書いた注意書き 2 箇所を落として赤くなった。
 * **偽陽性は見逃しより質が悪い**（緑のコードが赤くなると、次からガードが信用されない）。
 *
 * 文字列も潰すのは、`by.id` の綴りを含む文字列（説明・エラーメッセージ）を拾わないため。
 * 潰しても `by.id("...")` 自体は «コードの外側» が残るので検出できる — と思うのは誤りなので、
 * **文字列は潰さず、コメントだけ潰す**。testID は文字列リテラルとして書かれているため。
 */
function blankComments(src) {
	const out = src.split("");
	let i = 0;
	let state = "code"; // code | line | block | squote | dquote | tick
	while (i < src.length) {
		const c = src[i];
		const next = src[i + 1];
		if (state === "code") {
			if (c === "/" && next === "/") { state = "line"; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
			if (c === "/" && next === "*") { state = "block"; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
			if (c === "'") state = "squote";
			else if (c === '"') state = "dquote";
			else if (c === "`") state = "tick";
			i += 1;
			continue;
		}
		if (state === "line") {
			if (c === "\n") { state = "code"; i += 1; continue; }
			out[i] = " ";
			i += 1;
			continue;
		}
		if (state === "block") {
			if (c === "*" && next === "/") { state = "code"; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
			if (c !== "\n") out[i] = " ";
			i += 1;
			continue;
		}
		// 文字列の中: エスケープを飛ばしつつ閉じを待つ（中身は潰さない）
		if (c === "\\") { i += 2; continue; }
		if ((state === "squote" && c === "'") || (state === "dquote" && c === '"') || (state === "tick" && c === "`")) {
			state = "code";
		}
		i += 1;
	}
	return out.join("");
}

function collect(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === "artifacts") continue;
		const full = path.join(dir, name);
		if (statSync(full).isDirectory()) out.push(...collect(full));
		else if (/\.ts$/.test(name)) out.push(full);
	}
	return out;
}

/** 1 ファイルを検査して違反を返す（テストから直接呼べるよう分けてある） */
export function findViolations(rawSource, relPath) {
	const source = blankComments(rawSource);
	const violations = [];
	for (const m of source.matchAll(ID_RE)) {
		const testId = m[1];
		if (NOT_CARD_CHILDREN.has(testId)) continue;
		// 同じ式のうちに withAncestor が続いていれば良い（改行を挟むこともある）
		const after = source.slice(m.index + m[0].length, m.index + m[0].length + 120);
		if (/^\s*\.withAncestor\(/.test(after)) continue;
		const line = source.slice(0, m.index).split("\n").length;
		violations.push({ file: relPath, line, testId });
	}
	return violations;
}

/**
 * ガード自身の自己検査。**両方向**（欠陥を落とすこと / 正しいものを落とさないこと）を見る。
 *
 * ⚠️ このガードの最初の版は **自分が書いた注意書き 2 箇所を «違反» と読んで赤くなった**。
 * 偽陽性は見逃しより質が悪いので、コメント除去が壊れたらここで止める。
 */
const SELF_CHECKS = [
	{ name: "素の by.id は落とす", src: 'const a = by.id("dish-action-like");', expect: 1 },
	{
		name: "withAncestor 付きは通す",
		src: 'const a = by.id("dish-action-like").withAncestor(by.id("dish-media-card-active"));',
		expect: 0,
	},
	{
		name: "改行を挟んだ withAncestor も通す",
		src: 'const a = by.id("dish-action-save")\n\t.withAncestor(by.id("dish-media-card-active"));',
		expect: 0,
	},
	{ name: "行コメントの中の例は落とさない", src: '// by.id("dish-action-like") だった\nconst a = 1;', expect: 0 },
	{ name: "ブロックコメントの中の例は落とさない", src: '/**\n * `by.id("dish-action-like")`\n */\nconst a = 1;', expect: 0 },
	{ name: "share / report は対象外", src: 'const a = by.id("dish-action-report");', expect: 0 },
	{
		name: "コメントの後ろの実コードは見る",
		src: '// by.id("dish-action-like") は駄目\nconst a = by.id("dish-action-save");',
		expect: 1,
	},
];

const selfFailures = SELF_CHECKS.filter((c) => findViolations(c.src, "self-check.ts").length !== c.expect);
if (selfFailures.length > 0) {
	console.error("❌ ガード自身が壊れています（自己検査に失敗）\n");
	for (const c of selfFailures) {
		console.error(`   ${c.name}: 期待 ${c.expect} 件`);
	}
	process.exit(1);
}

const files = collect(E2E_ROOT);

// «見に行った先が空» で緑になると、規約を守っていないのに «守れている» と読める
if (files.length === 0) {
	console.error(`❌ 検査対象が 1 件も見つかりません（${E2E_ROOT}）。パスが変わっていませんか`);
	process.exit(1);
}

const violations = files.flatMap((f) => findViolations(readFileSync(f, "utf8"), path.relative(repoRoot, f)));

if (violations.length > 0) {
	console.error("❌ カルーセルのカード内 locator が active なカードへ限定されていません（#1742 / #1579）\n");
	for (const v of violations) {
		console.error(`   ${v.file}:${v.line}  ${v.testId}`);
	}
	console.error("\n   DishMediaFeed は前後のセルも描くので、素の by.id() は «画面端で切れている隣のカード» を掴みます。");
	console.error("   Detox の toBeVisible() は «自分の面積の 75% 以上» を要求するため、永遠に満たされず 25 秒待って落ちます。");
	console.error("   `screens/ResultScreen.ts` の `activeCardChild(\"<testID>\")` を使ってください。\n");
	process.exit(1);
}

console.log(`✅ e2e-mobile ${files.length} ファイル: カード内 locator はすべて active なカードへ限定されています`);
