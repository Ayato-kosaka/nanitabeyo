/**
 * #1273 «キャプション → 料理カテゴリ» の取りこぼしを before/after で実測するハーネス（解析専用）。
 *
 * **本番のコードをそのまま呼ぶ**（`matchDishCategories` / 辞書合成の実体）。判定ロジックは
 * 1 行も写経しない。写経すると本番だけ直ったときにハーネスが緑のまま古い挙動を守ってしまう。
 *
 * 使い方（`api/` から。api の tsconfig の paths と env バリデータに依存するため）:
 *   NODE_PATH=<repo>/api/node_modules TS_NODE_PROJECT=<repo>/api/tsconfig.json \
 *   node -r ts-node/register/transpile-only -r tsconfig-paths/register \
 *     ../scripts/20260808T0000_restaurant/1273_instagram_seed_poc/dish_category_recall_probe.ts \
 *     <corpus.jsonl> <out-dir> [--no-venue]
 *
 * - corpus.jsonl: 1 行 1 投稿の JSON。`cap`（キャプション）と任意の `h`（アカウント）を読む
 * - `--no-venue`: 業態語の複合表記（`DISH_CATEGORY_JA_VENUE_COMPOUNDS`）を辞書へ足さない ＝ 修正前の辞書
 *
 * 辞書は **KPI 134 カテゴリぶんだけ**を合成する（本番の `dish_category_variants` 全 93,735 行は
 * BigQuery からしか読めないため）。KPI 以外のカテゴリが 1 位を取る可能性は再現できないので、
 * その分は BigQuery 側（辞書全件 × 実キャプション）の測定で見ること。
 */
import * as fs from "node:fs";
import * as path from "node:path";

import {
	DISH_CATEGORY_JA_LABEL_SYNONYMS,
	DISH_CATEGORY_JA_VENUE_COMPOUNDS,
} from "../../../api/src/v1/dish-media-imports/dish-category-variant-dictionary.service";
import {
	matchDishCategories,
	type DishCategoryVariantEntry,
} from "../../../shared/utils/dishCategoryMatch";
import type { ExtractedText } from "../../../shared/utils/textNormalize";

/** KPI 134 カテゴリの QID→日本語ラベル。`KPI_JSON_PATH` で差し替えられる */
const KPI_JSON = process.env.KPI_JSON_PATH ?? path.resolve(__dirname, "../kpi_dish_categories.json");

function buildKpiDictionary(withVenue: boolean): {
	entries: DishCategoryVariantEntry[];
	labelOf: Map<string, string>;
} {
	const kpi = JSON.parse(fs.readFileSync(KPI_JSON, "utf8")) as {
		kpi_qids: Record<string, string>;
	};

	// 同じ日本語ラベルに複数 QID がぶら下がる（`かき氷`）。本番の surface_form は
	// グローバル UNIQUE なので、ラベルごとに 1 つへ寄せる（QID の昇順で決定的に）。
	const idOfLabel = new Map<string, string>();
	for (const [qid, label] of Object.entries(kpi.kpi_qids).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
		if (!idOfLabel.has(label)) idOfLabel.set(label, qid);
	}

	const entries: DishCategoryVariantEntry[] = [];
	const labelOf = new Map<string, string>();
	const seen = new Set<string>();
	for (const [label, id] of Array.from(idOfLabel.entries())) {
		labelOf.set(id, label);
		const surfaces = [
			label,
			...(DISH_CATEGORY_JA_LABEL_SYNONYMS[label] ?? []),
			...(withVenue ? DISH_CATEGORY_JA_VENUE_COMPOUNDS[label] ?? [] : []),
		];
		for (const surfaceForm of surfaces) {
			if (seen.has(surfaceForm)) continue;
			seen.add(surfaceForm);
			entries.push({ dishCategoryId: id, surfaceForm, source: "wikidata-label" });
		}
	}
	return { entries, labelOf };
}

/** 一致した表記を含む «カタカナの並び全体»。誤爆かどうかを人が見て判定するための手掛かり */
function katakanaWordAround(text: string, surface: string): string {
	const at = text.indexOf(surface);
	if (at === -1) return "";
	let from = at;
	while (from > 0 && /[ァ-ヶー]/.test(text[from - 1])) from -= 1;
	let to = at + surface.length;
	while (to < text.length && /[ァ-ヶー]/.test(text[to])) to += 1;
	const word = text.slice(from, to);
	return word === surface ? "" : word;
}

function window(text: string, surface: string, radius = 45): string {
	const at = text.indexOf(surface);
	const from = Math.max(0, at - radius);
	const to = Math.min(text.length, at + surface.length + radius);
	return (from > 0 ? "…" : "") + text.slice(from, to).replace(/\s+/g, " ") + (to < text.length ? "…" : "");
}

function main(): void {
	const [corpusPath, outDir, ...flags] = process.argv.slice(2);
	if (!corpusPath || !outDir) throw new Error("usage: probe <corpus.jsonl> <out-dir> [--no-venue]");
	const withVenue = !flags.includes("--no-venue");
	const tag = flags.includes("--tag") ? flags[flags.indexOf("--tag") + 1] : withVenue ? "after" : "before";

	const { entries, labelOf } = buildKpiDictionary(withVenue);

	const rows: Record<string, unknown>[] = [];
	let total = 0;
	let withCategory = 0;

	for (const line of fs.readFileSync(corpusPath, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		const post = JSON.parse(trimmed) as { h?: string; cap?: string; id?: string };
		const caption = typeof post.cap === "string" ? post.cap : "";
		if (caption.length === 0) continue;

		total += 1;
		const texts: ExtractedText[] = [{ field: "caption", text: caption }];
		const result = matchDishCategories(texts, entries);
		const top = result.candidates[0];
		if (top) withCategory += 1;

		const normalized = result.normalizedTexts[0]?.text ?? "";
		const surface = top?.evidence[0]?.surfaceForm ?? "";
		rows.push({
			id: post.id ?? post.h ?? String(rows.length),
			category: top ? (labelOf.get(top.dishCategoryId) ?? top.dishCategoryId) : "",
			categoryId: top?.dishCategoryId ?? "",
			confidence: top?.confidence ?? 0,
			kind: top?.evidence[0]?.kind ?? "",
			surface,
			katakanaWord: surface ? katakanaWordAround(normalized, surface) : "",
			snippet: surface ? window(normalized, surface) : normalized.slice(0, 90),
		});
	}

	fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(
		path.join(outDir, `probe_${tag}.json`),
		JSON.stringify({ tag, withVenue, total, withCategory, rows }, null, 0),
		"utf8",
	);
	process.stdout.write(
		`[${tag}] captions=${total} withCategory=${withCategory} (${((withCategory / total) * 100).toFixed(1)}%) dict=${entries.length}\n`,
	);
}

main();
