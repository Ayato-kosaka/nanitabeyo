import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 🛡️ テストの後始末が «自分の run の外» まで効かないことを検証する CI ゲート（#2001）。
 *
 * 使い方: pnpm --filter app-expo assert:session-revoke-scope
 *
 * ## 何を守っているのか
 * Supabase の `signOut({ scope: "global" })` は **そのユーザーの全セッション**を失効させる。
 * テストユーザーは e2e-mobile（Android ジョブ / iOS ジョブ）と e2e-web で共用しているため、
 * 「この run の後始末」のつもりで global を撃つと、**同時に走っている別ジョブのセッションを
 * その場で殺す**。
 *
 * 実際に起きたこと（run 35662317482 / 2026-09-21 の夜間）: Android ジョブと iOS ジョブは
 * 同じ workflow run の中で並走している。Android が 23:36:39 に global revoke し、
 * その 15 分後から iOS の `tests/authenticated/` が軒並み
 * `Invalid Refresh Token: Refresh Token Not Found` で死んだ（19 失敗のうち 11 件）。
 * 「テストが落ちた」ようにしか見えないので、**原因はログを突き合わせるまで誰にも見えなかった**。
 *
 * ## なぜ «grep で禁止» なのか
 * 後始末は落ちても run を赤くしない（警告のみ）設計なので、**間違っていても気付けない**。
 * 実行時に検出する手段が無い以上、書かれた時点で止めるしかない。
 *
 * ## 例外
 * `scope: "local"`（自分のセッションだけ失効）と `scope: "others"`（自分以外）は対象外。
 * 守りたいのは「この run が発行したトークンを run 終了時に無効化する」ことで、
 * それは local で満たせている（global である必要は最初から無い）。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

/** 検査対象。テストの後始末コードが置かれている場所をすべて挙げる */
const ROOTS = ["e2e-mobile/fixtures", "e2e-mobile/utils", "e2e-web/fixtures", "e2e-web/tests/setup", "e2e-web/utils"];

/** `signOut({ scope: "global" })` / `signOut({scope:'global'})` 等の表記ゆれを拾う */
const FORBIDDEN_RE = /signOut\s*\(\s*\{[^}]*scope\s*:\s*["'`]global["'`]/g;

/** 自己診断用（ゲート自体が壊れていないことを確かめる。#2001） */
const SELF_CHECKS = [
	{ source: `await supabase.auth.signOut({ scope: "global" });`, expected: 1 },
	{ source: `await supabase.auth.signOut({scope:'global'})`, expected: 1 },
	{ source: `await supabase.auth.signOut({ scope: "local" });`, expected: 0 },
	{ source: `// かつては signOut({ scope: "global" }) だった`, expected: 1 },
];

/** ディレクトリを再帰して .ts / .mts / .mjs を集める（存在しないディレクトリは無視する） */
function collect(dir) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	const out = [];
	for (const name of entries) {
		if (name === "node_modules") continue;
		const full = path.join(dir, name);
		if (statSync(full).isDirectory()) out.push(...collect(full));
		else if (/\.(ts|mts|mjs)$/.test(name)) out.push(full);
	}
	return out;
}

/** 1 ファイルを検査して違反の配列を返す（自己診断から直接呼べるよう分けてある） */
export function findViolations(source, relPath) {
	const violations = [];
	for (const m of source.matchAll(FORBIDDEN_RE)) {
		violations.push({ file: relPath, line: source.slice(0, m.index).split("\n").length });
	}
	return violations;
}

for (const [i, check] of SELF_CHECKS.entries()) {
	const got = findViolations(check.source, `self-check-${i}`).length;
	if (got !== check.expected) {
		console.error(`❌ ゲート自身の自己診断に失敗しました（self-check ${i}: 期待 ${check.expected} / 実際 ${got}）`);
		process.exit(1);
	}
}

const files = ROOTS.flatMap((r) => collect(path.join(repoRoot, r)));
const violations = files.flatMap((f) => findViolations(readFileSync(f, "utf8"), path.relative(repoRoot, f)));

if (violations.length > 0) {
	console.error('❌ テストの後始末で `signOut({ scope: "global" })` が使われています（#2001）\n');
	for (const v of violations) console.error(`   ${v.file}:${v.line}`);
	console.error("\n   global は **そのテストユーザーの全セッション**を失効させます。");
	console.error("   Android ジョブと iOS ジョブは同じ workflow run で並走しているため、");
	console.error("   片方の «run の最後» はもう片方の «run の途中» です。");
	console.error('   自分が発行したセッションだけを消す `scope: "local"` を使ってください。');
	console.error("   機序: e2e-mobile/utils/revokeSessions.ts の #2001 コメント\n");
	process.exit(1);
}

console.log(`✅ 後始末 ${files.length} ファイル: run をまたいで効く revoke はありません`);
