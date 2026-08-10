#!/usr/bin/env node
// @ts-check
//
// 📋 UI カタログ（画面一覧）ドキュメント生成スクリプト
//
// catalog/screens.json（画面定義）と screenshots/.results/*.json（実際の取得結果）を
// 突き合わせて、Markdown の画面一覧・画面遷移図・機械可読な JSON を出力する。
//
// 依存ゼロ（Node 標準のみ）。取得結果が無い場合は「定義だけの一覧」を出力するため、
// スクリーンショットを撮らずにドキュメントだけ更新することもできる。
//
// 使い方:
//   node ./scripts/generate-catalog.mjs                          # screenshots/UI_CATALOG.md を生成
//   node ./scripts/generate-catalog.mjs --out ../docs/ui-catalog.md
//   node ./scripts/generate-catalog.mjs --manifest ./manifest.json  # 公開 URL 列を追加
//
// オプション:
//   --out <path>         Markdown の出力先（既定: <screenshots>/UI_CATALOG.md）
//   --json <path>        機械可読な JSON の出力先（既定: <screenshots>/ui-catalog.json）
//   --screenshots <dir>  スクリーンショットのディレクトリ（既定: ./screenshots）
//   --results <dir>      取得結果 JSON のディレクトリ（既定: <screenshots>/.results）
//   --manifest <path>    evidence-collect が生成した manifest.json（公開 URL 列を追加する）
//   --no-results         取得結果を読まず、定義だけの一覧を出力する

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** コマンドライン引数を `--key value` / `--flag` 形式で読む */
function parseArgs(argv) {
	/** @type {Record<string, string | boolean>} */
	const options = {};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token.startsWith("--")) continue;
		const key = token.slice(2);
		const next = argv[index + 1];
		if (next && !next.startsWith("--")) {
			options[key] = next;
			index += 1;
		} else {
			options[key] = true;
		}
	}
	return options;
}

const options = parseArgs(process.argv.slice(2));

const screenshotDir = path.resolve(String(options.screenshots ?? path.join(ROOT, "screenshots")));
const resultDir = path.resolve(String(options.results ?? path.join(screenshotDir, ".results")));
const markdownOut = path.resolve(String(options.out ?? path.join(screenshotDir, "UI_CATALOG.md")));
const jsonOut = path.resolve(String(options.json ?? path.join(screenshotDir, "ui-catalog.json")));
const useResults = options["no-results"] !== true;

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "catalog", "screens.json"), "utf-8"));

/** 取得結果（screenshots/.results/*.json）を id 単位で読み込む */
function loadResults() {
	/** @type {Record<string, any>} */
	const results = {};
	if (!useResults || !fs.existsSync(resultDir)) return results;
	for (const entry of fs.readdirSync(resultDir)) {
		if (!entry.endsWith(".json")) continue;
		try {
			const result = JSON.parse(fs.readFileSync(path.join(resultDir, entry), "utf-8"));
			results[result.id] = result;
		} catch (error) {
			console.warn(`⚠️  取得結果を読めませんでした: ${entry} (${error instanceof Error ? error.message : error})`);
		}
	}
	return results;
}

/**
 * evidence-collect の manifest.json から「公開ファイル名 → 公開 URL」の対応を作る。
 * manifest の path は Artifact 内の相対パスなので、basename で突き合わせる。
 */
function loadPublicUrls() {
	const manifestPath = options.manifest ? path.resolve(String(options.manifest)) : null;
	/** @type {Record<string, string>} */
	const urls = {};
	if (!manifestPath || !fs.existsSync(manifestPath)) return urls;
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
	for (const image of manifest.images ?? []) {
		urls[path.basename(image.path)] = image.url;
	}
	return urls;
}

const results = loadResults();
const publicUrls = loadPublicUrls();

/** Markdown のテーブルセルを壊さないようにエスケープする */
function cell(text) {
	return String(text ?? "")
		.replace(/\|/g, "\\|")
		.replace(/\r?\n/g, "<br>");
}

/** 箇条書き（配列）を 1 セルに収める */
function listCell(items) {
	if (!items || items.length === 0) return "—";
	return cell(items.join(" / "));
}

/** 画面 1 件の取得状況を人が読める文字列にする */
function statusOf(screen) {
	const result = results[screen.id];
	if (screen.capture === "manual") return "対象外（手動）";
	if (!useResults) return "未取得";
	if (!result) return "未実行";
	if (result.captured) return "取得済み";
	return `失敗: ${cell(result.skipReason ?? "理由不明")}`;
}

/** スクリーンショットのファイル名（実ファイルが無ければ null） */
function fileOf(screen) {
	const result = results[screen.id];
	if (result?.captured && result.file) return result.file;
	const candidate = `${screen.id}.png`;
	if (fs.existsSync(path.join(screenshotDir, candidate))) return candidate;
	return null;
}

const automated = catalog.screens.filter((screen) => screen.capture !== "manual");
const manual = catalog.screens.filter((screen) => screen.capture === "manual");
const capturedCount = automated.filter((screen) => fileOf(screen) !== null).length;

// ── Mermaid の画面遷移図 ───────────────────────────────────────────
/** Mermaid のノード id として安全な文字列にする */
function nodeId(id) {
	return `n_${String(id).replace(/[^A-Za-z0-9_]/g, "_")}`;
}

/**
 * Mermaid のラベルとして安全な文字列にする。
 * - `<param>` は HTML として解釈されうるため `:param` に置き換える
 * - 引用符・角括弧・パイプ・残った不等号はノード定義の構文を壊すので除去する
 */
function nodeLabel(text) {
	return String(text)
		.replace(/<([^>]*)>/g, ":$1")
		.replace(/["\[\]|<>]/g, " ");
}

function buildMermaid() {
	const screenById = new Map(catalog.screens.map((screen) => [screen.id, screen]));
	const pseudo = catalog.pseudoNodes ?? {};
	const used = new Set();
	const lines = ["flowchart TD"];

	for (const edge of catalog.flow ?? []) {
		used.add(edge.from);
		used.add(edge.to);
	}

	for (const id of used) {
		const screen = screenById.get(id);
		// 画面ノードは「画面名 + URL」の 2 行。<br/> は Mermaid の改行なので nodeLabel の後に足す
		const label = screen ? `${nodeLabel(screen.name)}<br/>${nodeLabel(screen.url)}` : nodeLabel(pseudo[id] ?? id);
		lines.push(`\t${nodeId(id)}["${label}"]`);
	}

	for (const edge of catalog.flow ?? []) {
		const label = edge.label ? `|${nodeLabel(edge.label)}|` : "";
		lines.push(`\t${nodeId(edge.from)} -->${label} ${nodeId(edge.to)}`);
	}

	return lines.join("\n");
}

// ── Markdown の組み立て ────────────────────────────────────────────
const hasPublicUrls = Object.keys(publicUrls).length > 0;
const generatedAt = new Date().toISOString();

const lines = [];
lines.push("# UI カタログ（画面一覧とスクリーンショット対応表）");
lines.push("");
lines.push(
	"Expo Web（`app-expo`）の画面を Playwright（`e2e-web`）で巡回して取得したスクリーンショットと、" +
		"画面名 / URL / 遷移関係の対応表です。",
);
lines.push("");
lines.push(`- 生成日時: ${generatedAt}`);
lines.push(`- 定義済み画面（UI 状態を含む）: ${catalog.screens.length} 件`);
lines.push(`- 自動取得の対象: ${automated.length} 件（うち取得済み ${capturedCount} 件）`);
lines.push(`- 自動取得の対象外（実データ ID や外部 IdP が必要）: ${manual.length} 件`);
lines.push("");
lines.push("> 画面定義の唯一の情報源は `e2e-web/catalog/screens.json` です。");
lines.push("> スクリーンショットのファイル名は必ず `<画面 ID>.png` で、公開 URL だけを見ても画面が分かります。");
lines.push("");
lines.push("<!-- このファイルは自動生成です。手で編集せず、定義とスクリプトを更新してください。 -->");
lines.push("");
lines.push("再生成:");
lines.push("");
lines.push("```bash");
lines.push("pnpm --filter e2e-web test:catalog   # スクリーンショットを撮り直す（要 dev ビルド + 実 API）");
lines.push("pnpm --filter e2e-web catalog:doc    # 画面一覧を生成する（screenshots/UI_CATALOG.md）");
lines.push("```");
lines.push("");
lines.push(
	"GitHub Actions では `E2E Web Test` を `capture_ui_catalog = true` で手動実行すると、" +
		"スクリーンショット一式が Artifact `ui-catalog-screenshots` として保存されます。" +
		"その run を `Evidence Collect` に渡すと GCS へ公開され、画面名がそのまま入った公開 URL が manifest に出ます。",
);
lines.push("");

lines.push("## 画面一覧（自動取得）");
lines.push("");
const header = [
	"画面名",
	"URL / Route",
	"スクリーンショット",
	"説明",
	"遷移元",
	"主な遷移先",
	"同一 URL 内の UI 状態",
	"取得状況",
];
if (hasPublicUrls) header.splice(3, 0, "公開 URL");
lines.push(`| ${header.join(" | ")} |`);
lines.push(`| ${header.map(() => "---").join(" | ")} |`);

for (const screen of automated) {
	const file = fileOf(screen);
	const row = [
		cell(screen.name),
		`\`${cell(screen.url)}\`<br>\`${cell(screen.route)}\``,
		file ? `\`${file}\`` : "—",
		cell(screen.description),
		listCell(screen.from),
		listCell(screen.to),
		screen.state ? cell(screen.state) : "—",
		statusOf(screen),
	];
	if (hasPublicUrls) {
		const url = file ? publicUrls[file] : null;
		row.splice(3, 0, url ? `[画像](${url})` : "—");
	}
	lines.push(`| ${row.join(" | ")} |`);
}
lines.push("");

lines.push("## 自動取得の対象外の画面");
lines.push("");
lines.push("実データの ID・外部 IdP・DB への書き込みが必要で、E2E から安全に到達できない画面です。");
lines.push("");
lines.push("| 画面名 | URL / Route | 説明 | 遷移元 | 主な遷移先 | 対象外の理由 |");
lines.push("| --- | --- | --- | --- | --- | --- |");
for (const screen of manual) {
	lines.push(
		`| ${cell(screen.name)} | \`${cell(screen.url)}\`<br>\`${cell(screen.route)}\` | ${cell(screen.description)} | ${listCell(
			screen.from,
		)} | ${listCell(screen.to)} | ${cell(screen.note ?? "—")} |`,
	);
}
lines.push("");

lines.push("## 画面遷移図");
lines.push("");
lines.push("```mermaid");
lines.push(buildMermaid());
lines.push("```");
lines.push("");

lines.push("## スクリーンショット一覧（ファイル名 → 画面）");
lines.push("");
lines.push("```text");
for (const screen of automated) {
	const file = fileOf(screen);
	lines.push(`${(file ?? `(未取得) ${screen.id}.png`).padEnd(52)} ${screen.url}  —  ${screen.name}`);
}
lines.push("```");
lines.push("");

fs.mkdirSync(path.dirname(markdownOut), { recursive: true });
fs.writeFileSync(markdownOut, `${lines.join("\n")}\n`, "utf-8");

fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
fs.writeFileSync(
	jsonOut,
	`${JSON.stringify(
		{
			schemaVersion: catalog.schemaVersion,
			generatedAt,
			summary: {
				total: catalog.screens.length,
				automated: automated.length,
				captured: capturedCount,
				manual: manual.length,
			},
			screens: catalog.screens.map((screen) => ({
				...screen,
				file: screen.capture === "manual" ? null : `${screen.id}.png`,
				captured: fileOf(screen) !== null,
				publicUrl: publicUrls[`${screen.id}.png`] ?? null,
				result: results[screen.id] ?? null,
			})),
			flow: catalog.flow ?? [],
		},
		null,
		2,
	)}\n`,
	"utf-8",
);

console.log(`✅ ${path.relative(process.cwd(), markdownOut)} を生成しました`);
console.log(`✅ ${path.relative(process.cwd(), jsonOut)} を生成しました`);
console.log(`   自動取得 ${capturedCount}/${automated.length} 件 / 対象外 ${manual.length} 件`);

const missing = automated.filter((screen) => fileOf(screen) === null);
if (useResults && missing.length > 0) {
	console.log(`⚠️  未取得: ${missing.map((screen) => screen.id).join(", ")}`);
}
