// scripts/gen-sitemap.mjs
import fs from "fs";
import path from "path";

const ROOT = path.resolve("app-expo/app");
const PUBLIC_OUT = path.resolve("app-expo/public");
const LOCALES_DIR = path.resolve("app-expo/locales");
let BASE_URL = process.env.WEB_BASE_URL;
if (!BASE_URL) {
	throw new Error("WEB_BASE_URL is required (e.g. https://food-scroll.web.app)");
}
BASE_URL = BASE_URL.replace(/\/+$/, ""); // 末尾スラッシュ除去

let locales = [];
if (fs.existsSync(LOCALES_DIR)) {
	locales = fs
		.readdirSync(LOCALES_DIR)
		.filter((f) => f.endsWith(".json"))
		.map((f) => f.replace(/\.json$/, ""));
}

// サブタグ (en-US → en) も追加
const expandedLocales = [...locales, ...locales.map((l) => l.split("-")[0])];

// 重複削除
const uniqueLocales = [...new Set(expandedLocales)];

// DYNAMIC_MAP に設定
const DYNAMIC_MAP = {
	locale: uniqueLocales,
};
const PAGE_EXTS = new Set([".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"]);
const IGNORE_BASENAMES = new Set(["+not-found", "_layout"]);
const isGroup = (n) => n.startsWith("(") && n.endsWith(")");

function list(dir) {
	return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

function* walk(dir) {
	for (const name of list(dir)) {
		const full = path.join(dir, name);
		const st = fs.statSync(full);
		if (st.isDirectory()) {
			// グループは飛ばすが配下は辿る
			yield* walk(full);
		} else {
			const ext = path.extname(name);
			const base = path.basename(name, ext);
			if (!PAGE_EXTS.has(ext)) continue;
			if (IGNORE_BASENAMES.has(base)) continue;
			yield full;
		}
	}
}

// ファイルパス -> URL セグメント配列
function segmentsFromFile(file) {
	const rel = path.relative(ROOT, file).replace(/\\/g, "/"); // posix
	const parts = rel.split("/");

	// 拡張子落としてファイル名に置換
	parts[parts.length - 1] = path.basename(parts.at(-1), path.extname(parts.at(-1)));

	// グループ (tabs) を除去
	const filtered = parts.filter((p) => !isGroup(p));

	// index はその階層のルートに
	if (filtered.at(-1) === "index") filtered.pop();

	return filtered;
}

function dynKey(seg) {
	const m = /^\[(.+)\]$/.exec(seg);
	return m?.[1] ?? null;
}

function expandDynamics(segments) {
	// 直積展開
	let variants = [[]];
	for (const seg of segments) {
		const k = dynKey(seg);
		if (!k) {
			variants = variants.map((v) => [...v, seg]);
			continue;
		}
		const values = DYNAMIC_MAP[k];
		if (!values) return []; // 未対応の動的セグメントは除外
		const next = [];
		for (const v of values) for (const cur of variants) next.push([...cur, v]);
		variants = next;
	}
	return variants.map((v) => "/" + v.filter(Boolean).join("/")).map((u) => u.replace(/\/+/g, "/"));
}

function uniq(a) {
	return [...new Set(a)];
}

function toXML(urls) {
	const items = urls
		.sort()
		.map((u) => `  <url>\n    <loc>${BASE_URL}${u}</loc>\n  </url>`)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>\n`;
}

function ensureDir(p) {
	if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function main() {
	const urls = [];
	for (const file of walk(ROOT)) {
		const segs = segmentsFromFile(file);
		const expanded = expandDynamics(segs);
		urls.push(...expanded);
	}

	// ルートは常に含める
	const out = uniq(["/", ...urls]).filter(Boolean);

	ensureDir(PUBLIC_OUT);
	fs.writeFileSync(path.join(PUBLIC_OUT, "sitemap.xml"), toXML(out), "utf8");
	fs.writeFileSync(
		path.join(PUBLIC_OUT, "robots.txt"),
		`User-agent: *\nAllow: /\n\nSitemap: ${BASE_URL}/sitemap.xml\n`,
		"utf8",
	);

	console.log("Generated URLs:\n" + out.map((u) => `${BASE_URL}${u}`).join("\n"));
}

main();
