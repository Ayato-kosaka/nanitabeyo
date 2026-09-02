// #1749 【設計】UI カタログの spec が使う画面 ID が、必ず `catalog/screens.json` に在ることを保証する。
//
// `captureScreenIfReachable()` は «撮れたら撮る» を謳っているが、未定義 ID のときだけは
// 例外である。`getScreen(id)` を try の外で呼んでいるため、ID が引けないと **その it 全体が
// そこで落ち、以降の撮影が丸ごと失われる**。
//
// 実際に起きたこと（#1749）: 画面 ID を «トピック → 料理カテゴリ» へ改名したとき、
// spec 側だけ直して `catalog/screens.json` が取り残された。結果、UI カタログの検索フローは
// `search-dishCategories` の時点で落ち、**`search-result-feed`（お店提案の地図＋カード）が
// 一度も撮れていなかった**。気づいたのは #1743 でその画面を撮ろうとしたときで、
// それまで «撮れていない» ことは誰にも見えていなかった。
//
// ⚠️ これは静的な文字列走査であって型検査ではない。spec が ID を渡す書き方は現状 3 通り
// （下記 PATTERNS）で、そこだけを見る。新しい渡し方を足したらこの検査は素通りするので、
// 渡し方を増やすときはここへも足すこと。**通ったから安全、ではなく、落ちたら確実に壊れている**。
//
// 使い方: node ./scripts/assert-catalog-screen-ids.mjs [走査するファイル...]

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** e2e-web / e2e-mobile の tests を歩いて `ui-catalog…spec.ts` / `ui-catalog…test.ts` を集める */
function collectCatalogSpecs(dir, found = []) {
	for (const name of readdirSync(dir)) {
		const entry = join(dir, name);
		if (statSync(entry).isDirectory()) collectCatalogSpecs(entry, found);
		else if (/^ui-catalog.*\.(spec|test)\.ts$/.test(name)) found.push(entry);
	}
	return found;
}

const files = process.argv.slice(2).length
	? process.argv.slice(2)
	: [...collectCatalogSpecs("e2e-web/tests"), ...collectCatalogSpecs("e2e-mobile/tests")];

const registry = JSON.parse(readFileSync("catalog/screens.json", "utf8"));
const known = new Set(registry.screens.map((screen) => screen.id));

/** spec が画面 ID を渡す書き方（この 3 通りだけを見る。増やしたらここへ足す） */
const PATTERNS = [
	// 1. 直接渡す: captureScreen("id") / captureScreenIfReachable("id", …) / getScreen("id")
	/\b(?:captureScreen|captureScreenIfReachable|getScreen)\(\s*"([^"]+)"/g,
	// 2. タプルの配列: ["id", "step"]（チュートリアルの手順表）
	/\[\s*"([a-z][a-zA-Z0-9-]*)"\s*,\s*"[a-zA-Z0-9-]+"\s*\]/g,
	// 3. オブジェクトの配列: { id: "id", … }
	/\{\s*id:\s*"([^"]+)"/g,
];

const findings = [];
for (const file of files) {
	const source = readFileSync(file, "utf8");
	for (const pattern of PATTERNS) {
		for (const match of source.matchAll(pattern)) {
			const id = match[1];
			if (known.has(id)) continue;
			const line = source.slice(0, match.index).split("\n").length;
			findings.push({ file, line, id });
		}
	}
}

if (findings.length) {
	console.error("❌ catalog/screens.json に定義の無い画面 ID を spec が使っています。");
	console.error("   この ID に当たった時点で it 全体が落ち、それ以降の画面が 1 枚も撮れません。");
	for (const finding of findings) {
		console.error(`   ${finding.file}:${finding.line} — "${finding.id}"`);
	}
	process.exit(1);
}
console.log(`✅ UI カタログの画面 ID は ${files.length} ファイルとも catalog/screens.json と一致しています`);
