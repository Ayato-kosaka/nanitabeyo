import fs from "node:fs";
import path from "node:path";

/**
 * #1779 【設計】**アプリは `restaurants.image_url` を «使わない» だけでなく «語らない»。**
 *
 * `image_url` は非空 2,423 行のうち 2,321 行が Google の写真 URI で、Places ToS 3.2.3 に
 * より保持できない。列ごと落とすのが #1779 で、表示は `imageUrls`（`image_path` 由来の
 * 64/256px 派生）へ移した（#1680 / #1902）。
 *
 * ⚠️ **コードは移ったのに、コメントが 6 箇所そのまま残っていた**（2026-09-24 に発見）。
 * 「categoryImageUrl → restaurant.image_url の順で落とす」と書いてあるので、読んだ人は
 * **列を落とすとカレンダーとリストの絵が消えると信じる**。#1779 の判断がその記述を
 * 一次情報として読むと必ず間違う（CLAUDE.md §3-2）。
 *
 * コード・コメントのどちらで復活しても落とす。`thumbnail.ts` の «使わない» という
 * 注意書きだけを例外として許す。
 */

const APP_EXPO = path.join(__dirname, "..");

/** 走査対象。ビルド成果物と依存は見ない */
const SKIP_DIRS = new Set([
	"node_modules",
	".expo",
	"android",
	"ios",
	"dist",
	"build",
	"coverage",
	"__tests__",
]);

/**
 * 例外。**«なぜ許すのか» を必ず書くこと**（書かないと次に読む人が同じ調査をやり直す）。
 */
const ALLOWED: Record<string, string> = {
	"features/myDishes/thumbnail.ts":
		"「`restaurant.image_url` は使わない」という注意書き本体。ここが唯一の正で、" +
		"消すと «なぜ imageUrls なのか» が追えなくなる",
	"data/searchMockData.ts":
		"モックデータ。Google の写真 URI を含む古い固定値で、表示経路ではない（#1779 で列と一緒に外す）",
};

function walk(dir: string, acc: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			walk(path.join(dir, entry.name), acc);
		} else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
			// ⚠️ テストは «禁じたものの名前» を書かないと何を禁じたか読めないので対象外。
			//    ただし «使う» と書いてある古い記述は 2 件見つけたのでその場で直した。
			acc.push(path.join(dir, entry.name));
		}
	}
	return acc;
}

/** `restaurant.image_url` / `restaurant?.image_url` / `restaurant!.image_url` */
const REFERENCE = /restaurant[?!]?\.image_url\b/;

describe("#1779 restaurants.image_url への参照（コメントを含む）", () => {
	const hits = walk(APP_EXPO)
		.map((file) => ({
			relative: path.relative(APP_EXPO, file).split(path.sep).join("/"),
			lines: fs
				.readFileSync(file, "utf8")
				.split("\n")
				.map((text, index) => ({ number: index + 1, text }))
				.filter(({ text }) => REFERENCE.test(text)),
		}))
		.filter(({ lines }) => lines.length > 0);

	it("例外として許している 1 件が実際に見つかる（探し方が壊れていないこと）", () => {
		// ⚠️ ここが 0 件だと «何も読めていないのに緑» になる。
		expect(hits.map((h) => h.relative)).toContain("features/myDishes/thumbnail.ts");
	});

	it("例外以外に restaurant.image_url が現れない", () => {
		const offenders = hits
			.filter(({ relative }) => !(relative in ALLOWED))
			.flatMap(({ relative, lines }) => lines.map((l) => `${relative}:${l.number} ${l.text.trim()}`));
		expect(offenders).toEqual([]);
	});
});
