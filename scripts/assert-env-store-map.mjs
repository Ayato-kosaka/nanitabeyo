// #843 【設計】「この鍵はどこに登録するのか」を、コードから機械的に導いて 1 枚に固定する。
//
// 起きたこと（2026-09-04）: オーナーが Maps Embed のキーを **GitHub の Environment
// シークレット（development）へ登録**したのに、Cloud Run の API は 503 を返し続けた。
// 「なんで、api develop に登録したのにだめなの？？」
//
// 真因は設定ミスではなく**構造**である。この repo には値の置き場が 3 つあり、
// **GitHub 側と Cloud Run 側は名前空間が別**で、`api-deploy.yml` が橋渡ししているのは
// 45 個中 2 個（API_COMMIT_ID / API_NODE_ENV）だけ。残り 43 個は GCP コンソールで
// 手で入れる前提だが、**それを書いた場所がどこにも無かった**。だから
// «GitHub に入れたのに効かない» が沈黙する。
//
// ⚠️ **この表は «GCP の現在値» ではない。** ここから Cloud Run は読めないので、
//    書いてあるのは「コードが要求しているもの」と「誰が入れる約束か」であって、
//    実際に入っているかではない。実際に入っているかは動かして確かめる
//    （例: Maps Embed なら e2e-web/tests/authenticated/maps-embed.spec.ts）。
//
// ⚠️ **表を手で書かない。** 手で書けば必ず env.ts とずれる。この script が唯一の生成元で、
//    docs 側はその出力を貼っただけの器である。ずれたら CI が落ちる。
//
// 使い方:
//   node ./scripts/assert-env-store-map.mjs           # 検査（ずれていたら exit 1）
//   node ./scripts/assert-env-store-map.mjs --write   # docs を生成し直す

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DOC = "docs/runbooks/secrets-and-env.md";
const ENV_TS = "api/src/core/config/env.ts";
const WORKFLOW_DIR = ".github/workflows";
const BEGIN = "<!-- BEGIN generated: assert-env-store-map -->";
const END = "<!-- END generated: assert-env-store-map -->";

/**
 * 値が漏れると権限が渡るもの（= シークレット）。**ここだけが人間の判断**で、
 * 残りは全部コードから引いている。新しい鍵を足したらここへも足すこと。
 *
 * 判定基準は «その文字列だけで他人が API を叩けるか»。
 * ID や URL やバケット名は、知られても単体では何もできないので config 側に置く。
 */
const SECRET_VALUES = new Set([
	"DATABASE_URL",
	"SUPABASE_JWT_SECRET",
	"SUPABASE_SERVICE_ROLE_KEY",
	"GOOGLE_PLACE_API_KEY",
	"GOOGLE_MAPS_EMBED_API_KEY",
	"GOOGLE_API_KEY",
	"CLAUDE_API_KEY",
	"CDN_KEY_SECRET_B64",
	"GCS_DEV_SERVICE_ACCOUNT_BASE64",
	"GITHUB_TOKEN",
]);

/** env.ts の envSchema から、API が起動時に読む名前と «未設定でも起動するか» を引く */
function readRuntimeEnv() {
	const src = readFileSync(ENV_TS, "utf8");
	const out = [];
	// 2 スペース字下げの `NAME:` が envSchema の 1 キー。値の側は次の `\n  NAME:` まで。
	const re = /^ {2}([A-Z][A-Z0-9_]*):\s([\s\S]*?)(?=^ {2}[A-Z][A-Z0-9_]*:\s|^\}\);)/gm;
	for (const m of src.matchAll(re)) {
		const [, name, body] = m;
		out.push({
			name,
			// `.optional()` か `.default(...)` があれば、未設定でも API 全体は起動する
			lenient: /\.optional\(\)/.test(body) || /\.default\(/.test(body),
		});
	}
	if (out.length === 0) throw new Error(`${ENV_TS} からキーを 1 つも引けなかった。envSchema の書き方が変わっている`);
	return out;
}

/** `${{ secrets.X }}` を使っている workflow を名前ごとに集める */
function readGithubSecrets() {
	const map = new Map();
	for (const file of readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith(".yml"))) {
		const src = readFileSync(join(WORKFLOW_DIR, file), "utf8");
		for (const m of src.matchAll(/secrets\.([A-Z][A-Z0-9_]*)/g)) {
			if (!map.has(m[1])) map.set(m[1], new Set());
			map.get(m[1]).add(file);
		}
	}
	return map;
}

/**
 * `api-deploy.yml` が Cloud Run へ実際に書き込む env 名。
 * **ここに無い名前は、GitHub 側に何を登録しても Cloud Run には届かない。**
 */
function readBridgedEnv() {
	const src = readFileSync(join(WORKFLOW_DIR, "api-deploy.yml"), "utf8");
	const block = src.match(/env_vars:\s*\|\n([\s\S]*?)\n\n/);
	if (!block) throw new Error("api-deploy.yml の env_vars ブロックを見つけられなかった");
	return new Set([...block[1].matchAll(/^\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
}

function render() {
	const runtime = readRuntimeEnv();
	const ghSecrets = readGithubSecrets();
	const bridged = readBridgedEnv();

	const rows = runtime.map(({ name, lenient }) => {
		const store = bridged.has(name) ? "api-deploy.yml が自動で入れる" : "**Cloud Run（GCP コンソールで手入力）**";
		return {
			name,
			kind: SECRET_VALUES.has(name) ? "🔑 シークレット" : "設定値",
			store,
			missing: lenient ? "起動する（その機能だけ縮退）" : "**API が起動しない**",
		};
	});

	// GitHub にしか無いもの = CI 自身の資格情報。API のランタイムには一生届かない。
	const runtimeNames = new Set(runtime.map((r) => r.name));
	const ciOnly = [...ghSecrets.entries()]
		.filter(([name]) => !runtimeNames.has(name))
		.sort(([a], [b]) => a.localeCompare(b));

	const lines = [];
	lines.push(BEGIN);
	lines.push("");
	lines.push(
		`> 🤖 この節は \`node ./scripts/assert-env-store-map.mjs --write\` が生成する。**手で編集しない**（CI が落ちる）。`,
	);
	lines.push("");
	lines.push(`## ① API が起動時に読む ${rows.length} 個（\`${ENV_TS}\`）`);
	lines.push("");
	lines.push(`GitHub 側に登録しても、下の «置き場» が Cloud Run のものは **届かない**。`);
	lines.push(`\`api-deploy.yml\` が橋渡ししているのは ${bridged.size} 個だけである。`);
	lines.push("");
	lines.push("| 名前 | 種別 | 置き場（誰が入れるか） | 未設定だと |");
	lines.push("| --- | --- | --- | --- |");
	for (const r of rows) lines.push(`| \`${r.name}\` | ${r.kind} | ${r.store} | ${r.missing} |`);
	lines.push("");
	lines.push(`## ② GitHub Actions だけが使う ${ciOnly.length} 個（API は読まない）`);
	lines.push("");
	lines.push("CI 自身の資格情報である。**ここへ API の鍵を足しても、API には何も起きない。**");
	lines.push("");
	lines.push("| 名前 | 使っている workflow |");
	lines.push("| --- | --- |");
	for (const [name, files] of ciOnly) lines.push(`| \`${name}\` | ${[...files].sort().join(", ")} |`);
	lines.push("");
	lines.push(END);
	return lines.join("\n");
}

/**
 * 比較は **空白を潰してから**行う。`pnpm format`（prettier）が markdown の表の桁を
 * 揃え直すため、バイト一致で比べると «整形しただけ» で CI が赤くなる。
 * 中身（キーの増減・置き場の変化）が変われば潰しても差が残るので、検知力は落ちない。
 */
const normalize = (text) =>
	text
		.split("\n")
		// prettier は表の区切り行の `---` も桁数ぶん伸ばすので、ここも潰す
		.map((line) => line.replace(/-{3,}/g, "---").replace(/\s+/g, " ").trim())
		.join("\n");

const generated = render();
const current = readFileSync(DOC, "utf8");
const replaced = current.replace(new RegExp(`${BEGIN}[\\s\\S]*${END}`), () => generated);

if (process.argv.includes("--write")) {
	writeFileSync(DOC, replaced);
	console.log(`✅ ${DOC} を生成し直した`);
} else if (normalize(replaced) !== normalize(current)) {
	console.error(`❌ ${DOC} が ${ENV_TS} / ${WORKFLOW_DIR} とずれている。`);
	console.error(`   直し方: node ./scripts/assert-env-store-map.mjs --write`);
	process.exit(1);
} else {
	console.log(`✅ ${DOC} は最新（${ENV_TS} と一致）`);
}
