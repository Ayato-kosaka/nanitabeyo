#!/usr/bin/env node
// #0 【運用】docs/README.md の管理規約のうち、機械的に検査できるものだけを強制する。
//
// 2026-08 に、実装のたびに生成された *_IMPLEMENTATION.md / *_SUMMARY.md が docs/ へ堆積し、
// 存在しない API を説明する文書が複数残る事故が起きた（docs/decisions/20260823-*）。
// 規約を書いただけでは同じことが起きるため、禁止パターンだけを CI で落とす。
//
// ここで検査するのは「ファイル名と置き場所」に限る。中身が陳腐化しているかは機械では判定
// できないので、それはレビューの仕事として残す。

import { execSync } from "node:child_process";
import path from "node:path";

/** 検査対象から外す。生成物・依存・履歴。 */
const IGNORED_PREFIXES = ["node_modules/", ".git/", "docs/ui-catalog"];

/** ファイル名そのものが規約違反になるパターン。 */
const FORBIDDEN_NAMES = [
	{
		test: (base) => /_IMPLEMENTATION\.md$/i.test(base) || /^IMPLEMENTATION_/i.test(base),
		why: "実装解説の md は作らない。設計判断は該当コードの 【設計】 コメント、経緯は PR 本文へ",
	},
	{
		test: (base) => /_SUMMARY\.md$/i.test(base) || /^SUMMARY_/i.test(base),
		why: "実装サマリーは PR 本文か Issue コメントに書く。ファイルとして残さない",
	},
	{
		test: (base) => /_OLD\.md$/i.test(base) || /_V\d+\.md$/i.test(base) || /\.md\.bak$/i.test(base),
		why: "退避ファイルは作らない。古くなったら削除する（履歴は git が持っている）",
	},
	{
		test: (base) => /^README_.+\.md$/i.test(base),
		why: "1 ディレクトリに README は 1 つ。分冊せず README.md へ統合する",
	},
];

/** 置いてはいけない場所。 */
const FORBIDDEN_PATHS = [
	{
		test: (p) => p.startsWith("docs/archive/"),
		why: "アーカイブディレクトリは作らない。価値がないものは削除する",
	},
];

const RULES_URL = "docs/README.md";

function listTrackedMarkdown() {
	const out = execSync("git ls-files -- '*.md' '*.markdown'", { encoding: "utf8" });
	return out
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((p) => !IGNORED_PREFIXES.some((prefix) => p.startsWith(prefix)));
}

const violations = [];
for (const file of listTrackedMarkdown()) {
	const base = path.basename(file);
	// 1 ファイルが複数ルールに当たっても、報告は最初の 1 件に絞る（同じファイルを二重に並べない）。
	const hit = FORBIDDEN_NAMES.find((rule) => rule.test(base)) ?? FORBIDDEN_PATHS.find((rule) => rule.test(file));
	if (hit) violations.push({ file, why: hit.why });
}

if (violations.length === 0) {
	console.log("assert-doc-hygiene: OK");
	process.exit(0);
}

console.error("");
console.error("ドキュメント管理規約に反するファイルがあります。");
console.error(`規約: ${RULES_URL}`);
console.error("");
for (const { file, why } of violations) {
	console.error(`  ✗ ${file}`);
	console.error(`      ${why}`);
}
console.error("");
console.error("その内容が本当に必要なら、次のどれかへ移してください。");
console.error("  - 設計で決まったこと     → 該当コードの `#Issue番号 【設計】` コメント");
console.error("  - 実装サマリー・完了報告 → PR 本文 / Issue コメント");
console.error("  - 横断的な仕様の要約     → docs/specs/<kebab-case>.md");
console.error("  - 繰り返す運用手順       → docs/runbooks/<kebab-case>.md");
console.error("  - 覆せない決定の記録     → docs/decisions/YYYYMMDD-<slug>.md");
console.error("");
process.exit(1);
