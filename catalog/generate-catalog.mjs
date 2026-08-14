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
//   node ./catalog/generate-catalog.mjs --screenshots e2e-web/screenshots
//   node ./catalog/generate-catalog.mjs --platform mobile --screenshots e2e-mobile/screenshots
//   node ./catalog/generate-catalog.mjs --manifest ./manifest.json   # 公開 URL 列を追加
//
// オプション:
//   --platform <web|mobile>  対象プラットフォーム（既定: web）。mobile は android / ios の 2 列になる
//   --variants <a,b>     mobile で出力する OS を絞る（既定: android,ios）
//   --out <path>         Markdown の出力先（既定: <screenshots>/UI_CATALOG.md）
//   --json <path>        機械可読な JSON の出力先（既定: <screenshots>/ui-catalog.json）
//   --screenshots <dir>  スクリーンショットのディレクトリ（既定: ./screenshots）
//   --results <dir>      取得結果 JSON のディレクトリ（既定: <screenshots>/.results）
//   --manifest <path>    evidence-collect が生成した manifest.json（公開 URL 列を追加する）。
//                        複数指定可（mobile の android / ios など、run が分かれる場合に並べる）
//   --no-results         取得結果を読まず、定義だけの一覧を出力する

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * コマンドライン引数を `--key value` / `--flag` 形式で読む。
 * 同じキーが複数回現れた場合は配列にまとめる（--manifest を複数渡せるようにするため）。
 */
function parseArgs(argv) {
	/** @type {Record<string, string | boolean | string[]>} */
	const options = {};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token.startsWith("--")) continue;
		const key = token.slice(2);
		const next = argv[index + 1];
		const value = next && !next.startsWith("--") ? ((index += 1), next) : true;
		const existing = options[key];
		if (existing === undefined) {
			options[key] = value;
		} else if (Array.isArray(existing)) {
			existing.push(String(value));
		} else {
			options[key] = [String(existing), String(value)];
		}
	}
	return options;
}

const options = parseArgs(process.argv.slice(2));

/** 対象プラットフォーム。screens.json の platforms.<platform> を読む */
const platform = String(options.platform ?? "web");
if (platform !== "web" && platform !== "mobile") {
	throw new Error(`--platform は web か mobile を指定してください（受け取った値: ${platform}）`);
}

/**
 * 1 画面につき撮るファイル名の一覧。
 * web は 1 枚、mobile は OS ごとに見た目が違うため android / ios の 2 枚を撮る。
 *
 * CI は OS ごとに別ジョブで走り、そのジョブには自分の OS のスクリーンショットしか無い。
 * そのまま既定値で生成すると、もう片方の OS が全て「未取得」に見えてしまうため、
 * `--variants android` のように絞れるようにしてある。
 */
const VARIANTS = platform === "mobile" ? String(options.variants ?? "android,ios").split(",") : [""];

/** 画面 ID とバリアント（android / ios）からファイル名を組み立てる */
function fileNameOf(id, variant) {
	return variant ? `${id}-${variant}.png` : `${id}.png`;
}

const screenshotDir = path.resolve(String(options.screenshots ?? path.join(ROOT, "screenshots")));
const resultDir = path.resolve(String(options.results ?? path.join(screenshotDir, ".results")));
const markdownOut = path.resolve(String(options.out ?? path.join(screenshotDir, "UI_CATALOG.md")));
const jsonOut = path.resolve(String(options.json ?? path.join(screenshotDir, "ui-catalog.json")));
const useResults = options["no-results"] !== true;

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "catalog", "screens.json"), "utf-8"));

/**
 * 取得結果（screenshots/.results/*.json）を **ファイル名単位** で読み込む。
 * mobile は 1 画面につき android / ios の 2 枚を撮るため、画面 ID では一意にならない。
 */
function loadResults() {
	/** @type {Record<string, any>} */
	const results = {};
	if (!useResults || !fs.existsSync(resultDir)) return results;
	for (const entry of fs.readdirSync(resultDir)) {
		if (!entry.endsWith(".json")) continue;
		try {
			const result = JSON.parse(fs.readFileSync(path.join(resultDir, entry), "utf-8"));
			results[result.file ?? `${result.id}.png`] = result;
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
	const given =
		options.manifest === undefined ? [] : Array.isArray(options.manifest) ? options.manifest : [options.manifest];
	/** @type {Record<string, string>} */
	const urls = {};
	/** @type {any[]} */
	const manifests = [];
	for (const entry of given) {
		const manifestPath = path.resolve(String(entry));
		if (!fs.existsSync(manifestPath)) {
			console.warn(`⚠️  manifest が見つかりません: ${manifestPath}`);
			continue;
		}
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
		for (const image of manifest.images ?? []) {
			urls[path.basename(image.path)] = image.url;
		}
		manifests.push(manifest);
	}
	return { urls, manifests };
}

const results = loadResults();
const { urls: publicUrls, manifests: publishedManifests } = loadPublicUrls();

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

/** 対象プラットフォームの取得方針（auto / optional / mutation / manual） */
function captureLevelOf(screen) {
	return screen.platforms?.[platform]?.capture ?? "manual";
}

/**
 * スクリーンショットのファイル名（存在が確認できなければ null）。
 * 「取得結果 JSON」「ローカルの実ファイル」「公開 manifest」のいずれかで確認できればよい。
 */
function fileOf(screen, variant) {
	if (captureLevelOf(screen) === "manual") return null;
	const candidate = fileNameOf(screen.id, variant);
	const result = results[candidate] ?? results[screen.id];
	if (result?.captured && result.file === candidate) return candidate;
	if (publicUrls[candidate]) return candidate;
	if (fs.existsSync(path.join(screenshotDir, candidate))) return candidate;
	return null;
}

/** 画面 1 件（バリアント単位）の取得状況を人が読める文字列にする */
function statusOf(screen, variant) {
	const level = captureLevelOf(screen);
	if (level === "manual") return "対象外（手動）";
	const candidate = fileNameOf(screen.id, variant);
	if (publicUrls[candidate]) return "取得済み（公開済み）";
	if (fileOf(screen, variant)) return "取得済み";
	if (!useResults) return "—";
	const result = results[candidate] ?? results[screen.id];
	if (!result) return level === "mutation" ? "未実行（RUN_MUTATION=1 が必要）" : "未実行";
	return `失敗: ${cell(result.skipReason ?? "理由不明")}`;
}

const automated = catalog.screens.filter((screen) => captureLevelOf(screen) !== "manual");
const manual = catalog.screens.filter((screen) => captureLevelOf(screen) === "manual");
const capturedCount = automated.filter((screen) => VARIANTS.some((variant) => fileOf(screen, variant))).length;

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
const isMobile = platform === "mobile";

const lines = [];
lines.push(`# UI カタログ（${isMobile ? "モバイル / Android・iOS" : "Web"}）`);
lines.push("");
lines.push(
	isMobile
		? "`app-expo` のネイティブアプリを Detox（`e2e-mobile`）で巡回して取得したスクリーンショットと、" +
				"画面名 / ルート / 遷移関係の対応表です。端末サイズの縦長スクリーンショットです。"
		: "Expo Web（`app-expo`）の画面を Playwright（`e2e-web`）で巡回して取得したスクリーンショットと、" +
				"画面名 / URL / 遷移関係の対応表です。デスクトップブラウザの横長スクリーンショットです。",
);
lines.push("");
lines.push(`- 生成日時: ${generatedAt}`);
lines.push(`- 定義済み画面（UI 状態を含む）: ${catalog.screens.length} 件`);
lines.push(`- このプラットフォームの自動取得対象: ${automated.length} 件（うち取得済み ${capturedCount} 件）`);
lines.push(`- 自動取得の対象外: ${manual.length} 件`);
lines.push("");
lines.push("> 画面定義の唯一の情報源は `catalog/screens.json` です（Web / モバイルで共通）。");
lines.push(
	`> スクリーンショットのファイル名は必ず \`${isMobile ? "<画面 ID>-<android|ios>.png" : "<画面 ID>.png"}\` で、公開 URL だけを見ても画面が分かります。`,
);
lines.push("");
lines.push("<!-- このファイルは自動生成です。手で編集せず、定義とスクリプトを更新してください。 -->");
lines.push("");
lines.push("再生成:");
lines.push("");
lines.push("```bash");
if (isMobile) {
	lines.push("pnpm --filter e2e-mobile test:catalog:android   # 撮り直す（要 Detox ビルド + エミュレータ）");
	lines.push("pnpm catalog:doc:mobile                        # 画面一覧を生成する");
} else {
	lines.push("pnpm --filter e2e-web test:catalog   # 撮り直す（要 dev ビルド + 実 API）");
	lines.push("pnpm catalog:doc                    # 画面一覧を生成する");
}
lines.push("```");
lines.push("");
lines.push(
	isMobile
		? "GitHub Actions では `E2E Mobile Test` を `scope = catalog` で手動実行すると、Artifact " +
				"`ui-catalog-screenshots-android` / `-ios` が保存されます。"
		: "GitHub Actions では `E2E Web Test` を `capture_ui_catalog = true` で手動実行すると、Artifact " +
				"`ui-catalog-screenshots` が保存されます。",
);
lines.push(
	"その run を `Evidence Collect` に渡すと GCS へ公開され、写真付きの一覧ページ（index.html）と公開 URL が手に入ります。",
);
lines.push("");

for (const manifest of publishedManifests) {
	lines.push(`### 公開済みエビデンス（${manifest.artifactName}）`);
	lines.push("");
	lines.push(`- 📷 一覧（写真付き）: ${manifest.publicGalleryUrl ?? "（未生成）"}`);
	lines.push(`- 取得元 run: ${manifest.sourceRunUrl}`);
	lines.push(`- 対象 commit: \`${manifest.sourceCommitSha}\``);
	lines.push(`- manifest: ${manifest.publicManifestUrl}`);
	lines.push("");
}

lines.push("## 画面一覧（自動取得）");
lines.push("");
const header = ["画面名", "URL / Route", "説明", "遷移元", "主な遷移先", "同一 URL 内の UI 状態"];
for (const variant of VARIANTS) {
	const label = variant ? variant : "スクリーンショット";
	header.push(hasPublicUrls ? `${label}（公開 URL）` : label);
}
header.push("取得状況");
lines.push(`| ${header.join(" | ")} |`);
lines.push(`| ${header.map(() => "---").join(" | ")} |`);

for (const screen of automated) {
	const row = [
		cell(screen.name),
		`\`${cell(screen.url)}\`<br>\`${cell(screen.route)}\``,
		cell(screen.description),
		listCell(screen.from),
		listCell(screen.to),
		screen.state ? cell(screen.state) : "—",
	];
	for (const variant of VARIANTS) {
		const file = fileOf(screen, variant);
		const url = file ? publicUrls[file] : null;
		if (url) row.push(`[${file}](${url})`);
		else row.push(file ? `\`${file}\`` : "—");
	}
	row.push(VARIANTS.map((variant) => statusOf(screen, variant)).join(" / "));
	lines.push(`| ${row.join(" | ")} |`);
}
lines.push("");

lines.push("## 自動取得の対象外の画面");
lines.push("");
lines.push("実データの ID・外部 IdP・端末の仕様上の制約があり、このプラットフォームでは自動で到達できない画面です。");
lines.push("");
lines.push("| 画面名 | URL / Route | 説明 | 遷移元 | 主な遷移先 | 対象外の理由 |");
lines.push("| --- | --- | --- | --- | --- | --- |");
for (const screen of manual) {
	const reason = screen.platforms?.[platform]?.note ?? screen.note ?? "—";
	lines.push(
		`| ${cell(screen.name)} | \`${cell(screen.url)}\`<br>\`${cell(screen.route)}\` | ${cell(screen.description)} | ${listCell(
			screen.from,
		)} | ${listCell(screen.to)} | ${cell(reason)} |`,
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
	for (const variant of VARIANTS) {
		const file = fileOf(screen, variant);
		const name = file ?? `(未取得) ${fileNameOf(screen.id, variant)}`;
		lines.push(`${name.padEnd(56)} ${screen.url}  —  ${screen.name}`);
	}
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
			platform,
			screens: catalog.screens.map((screen) => ({
				...screen,
				captureLevel: captureLevelOf(screen),
				// バリアント（web は 1 枚 / mobile は android・ios）ごとの取得結果
				shots: VARIANTS.map((variant) => {
					const file = fileNameOf(screen.id, variant);
					return {
						variant: variant || platform,
						file: captureLevelOf(screen) === "manual" ? null : file,
						captured: fileOf(screen, variant) !== null,
						publicUrl: publicUrls[file] ?? null,
						result: results[file] ?? null,
					};
				}),
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
console.log(`   [${platform}] 自動取得 ${capturedCount}/${automated.length} 件 / 対象外 ${manual.length} 件`);

const missing = automated.flatMap((screen) =>
	VARIANTS.filter((variant) => fileOf(screen, variant) === null).map((variant) => ({ screen, variant })),
);
if (useResults && missing.length > 0) {
	// 理由まで出す（Artifact を落とさずに CI ログだけで原因を追えるようにする）
	console.log("⚠️  未取得:");
	for (const { screen, variant } of missing) {
		const file = fileNameOf(screen.id, variant);
		console.log(`   - ${file}: ${results[file]?.skipReason ?? "実行されていません"}`);
	}
}
