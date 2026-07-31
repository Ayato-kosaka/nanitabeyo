import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import dotenv from "dotenv";
import ts from "typescript";

/**
 * 🛡️ `DEFAULT_REMOTE_CONFIG`（#1092 PR2 でアプリへ埋め込んだ Remote Config の既定値）が
 * 実際の config.json から乖離していないことを検証する CI ゲート（#1092 PR3 / PR2 レビュー Minor-1）。
 *
 * 使い方:
 *   pnpm --filter app-expo assert:remote-config-defaults
 *
 * ## なぜ必要か
 * PR2 で「CDN へ到達できない端末はアプリ内の既定値で動き続ける」経路を新設した。
 * その既定値は手書きなので、サーバ側で config.json を変えても誰も気付かない。
 * `__tests__/remoteConfigDefaults.test.ts` の期待値も同じ手書き値の複製でしかなく、
 * **実装と期待値が同時に間違っていても緑になる**。だから CI で実物と突き合わせる。
 *
 * ## 出力の約束
 * - ホスト名や URL、`.env` の中身は **出力しない**（差分はキー名と値だけ）
 * - 環境変数が無い環境（ローカル開発など）は skip して成功扱いにする。
 *   ただし **skip したことは必ず出力する**（黙って緑になるのが一番悪い）
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");

/** CDN の取得に掛ける上限時間(ms)。CI を無言でぶら下げないため */
const FETCH_TIMEOUT_MS = 15000;

/**
 * config.json に存在しないことが分かっているキー。
 *
 * `shared/remoteConfig/remoteConfig.schema.ts` で `.optional().default("true")` を持つため、
 * config.json 側には無くてよい（無いことが正常）。ここへ足すときは必ず schema の default と
 * 同じ値になっていることを確認すること。
 */
const EXPECTED_ABSENT_FROM_CDN = new Set(["v1_bulk_import_preflight_enabled"]);

// ── 1. 環境変数（無ければ skip）────────────────────────────────────────────────

// CI は `eas-cli env:pull <env> --path .env` で app-expo/.env へ書き出す運用なので、
// process.env に無ければ .env も見る。既存の process.env は上書きしない（dotenv の既定動作）
const dotenvPath = path.join(appRoot, ".env");
if (existsSync(dotenvPath)) {
	dotenv.config({ path: dotenvPath, quiet: true });
}

const cdnHost = process.env.EXPO_PUBLIC_CDN_PUBLIC_HOST;
const staticMasterDir = process.env.EXPO_PUBLIC_GCS_STATIC_MASTER_DIR_PATH;

const missingEnvNames = [
	["EXPO_PUBLIC_CDN_PUBLIC_HOST", cdnHost],
	["EXPO_PUBLIC_GCS_STATIC_MASTER_DIR_PATH", staticMasterDir],
]
	.filter(([, value]) => !value)
	.map(([name]) => name);

if (missingEnvNames.length > 0) {
	// ⚠️ ここを静かに exit(0) しないこと。「設定漏れで実質何も検査していない CI」を
	//    緑のチェックマークで隠すのが、このゲートで一番避けたい失敗の仕方
	console.log(
		[
			"⏭️  SKIP: Remote Config 既定値のドリフト検査を実行しませんでした。",
			`   未設定の環境変数: ${missingEnvNames.join(", ")}`,
			"   （ローカル開発では正常です。CI では `eas-cli env:pull <env> --path app-expo/.env` の後に実行してください）",
		].join("\n"),
	);
	process.exit(0);
}

// ── 2. アプリに埋め込まれた既定値を読む ──────────────────────────────────────

/**
 * `lib/remoteConfig.ts` から `DEFAULT_REMOTE_CONFIG` のオブジェクトリテラルを取り出す。
 *
 * この module は expo-constants / AsyncStorage を import するので Node から直接 require できない。
 * 正規表現ではなく TypeScript の parser で AST から初期化子を取り出し、
 * その **文字列リテラルだけで構成された式**を vm で評価する。
 *
 * @returns 既定値の辞書
 */
const readEmbeddedDefaults = () => {
	const sourcePath = path.join(appRoot, "lib", "remoteConfig.ts");
	const sourceFile = ts.createSourceFile(
		sourcePath,
		readFileSync(sourcePath, "utf8"),
		ts.ScriptTarget.Latest,
		/* setParentNodes */ true,
	);

	let initializerText;
	for (const statement of sourceFile.statements) {
		if (!ts.isVariableStatement(statement)) continue;
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "DEFAULT_REMOTE_CONFIG") continue;
			if (!declaration.initializer) continue;
			// `Object.freeze({...})` でも素のオブジェクトリテラルでも拾えるようにする
			initializerText = ts.isCallExpression(declaration.initializer)
				? declaration.initializer.arguments[0]?.getText(sourceFile)
				: declaration.initializer.getText(sourceFile);
		}
	}

	if (!initializerText) {
		throw new Error("lib/remoteConfig.ts から DEFAULT_REMOTE_CONFIG のオブジェクトリテラルを取り出せませんでした。");
	}

	const values = vm.runInNewContext(`(${initializerText})`, Object.create(null), { timeout: 1000 });
	if (typeof values !== "object" || values === null || Array.isArray(values)) {
		throw new Error("DEFAULT_REMOTE_CONFIG がオブジェクトではありません。");
	}
	return values;
};

// ── 3. 実際の config.json を取る ─────────────────────────────────────────────

/**
 * CDN の config.json を取得して `{ key: value }` に均す。
 * URL の組み立ては `lib/remoteConfig.ts` の `fetchStaticMasterFromCDN` と同じ。
 *
 * @returns config.json のキーと値
 */
const fetchCdnConfig = async () => {
	const cdnUrl = `https://${cdnHost}/${staticMasterDir}config.json`;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	let res;
	try {
		res = await fetch(cdnUrl, { signal: controller.signal });
	} catch (err) {
		// ⚠️ err.message には URL（= ホスト名）が入りうるので、そのまま出さない
		throw new Error(
			`config.json の取得に失敗しました（${err?.name ?? "Error"}）。CDN へ到達できるか確認してください。`,
		);
	} finally {
		clearTimeout(timeoutId);
	}

	if (!res.ok) throw new Error(`config.json の取得に失敗しました（HTTP ${res.status}）。`);

	const json = await res.json();
	if (!json || !Array.isArray(json.data))
		throw new Error("config.json の形が想定と違います（data 配列がありません）。");

	return Object.fromEntries(json.data.map(({ key, value }) => [key, value]));
};

// ── 4. 突き合わせ ────────────────────────────────────────────────────────────

const embedded = readEmbeddedDefaults();
const actual = await fetchCdnConfig();

/** 値が違うキー */
const mismatched = [];
/** config.json にあるのに DEFAULT_REMOTE_CONFIG に無いキー */
const missingFromEmbedded = [];
/** DEFAULT_REMOTE_CONFIG にあるのに config.json に無いキー（allowlist を除く） */
const missingFromCdn = [];

for (const [key, value] of Object.entries(actual)) {
	if (!(key in embedded)) {
		missingFromEmbedded.push({ key, actual: value });
		continue;
	}
	if (embedded[key] !== value) mismatched.push({ key, embedded: embedded[key], actual: value });
}

for (const key of Object.keys(embedded)) {
	if (key in actual) continue;
	if (EXPECTED_ABSENT_FROM_CDN.has(key)) continue;
	missingFromCdn.push({ key, embedded: embedded[key] });
}

const allowlisted = [...EXPECTED_ABSENT_FROM_CDN].filter((key) => key in embedded && !(key in actual));

if (mismatched.length === 0 && missingFromEmbedded.length === 0 && missingFromCdn.length === 0) {
	console.log(`✅ DEFAULT_REMOTE_CONFIG は config.json と同値です（照合キー数: ${Object.keys(actual).length}）`);
	if (allowlisted.length > 0) {
		console.log(`   ℹ️ config.json に無いことを許容したキー（schema の default 由来）: ${allowlisted.join(", ")}`);
	}
	process.exit(0);
}

console.error(
	[
		"❌ DEFAULT_REMOTE_CONFIG が config.json から乖離しています。",
		"   app-expo/lib/remoteConfig.ts の DEFAULT_REMOTE_CONFIG と",
		"   app-expo/__tests__/remoteConfigDefaults.test.ts の EXPECTED_DEFAULTS を実際の値へ合わせてください。",
		"",
		...(mismatched.length > 0
			? [
					"● 値が違うキー:",
					...mismatched.map(({ key, embedded: e, actual: a }) => `  - ${key}: 埋め込み="${e}" / config.json="${a}"`),
				]
			: []),
		...(missingFromEmbedded.length > 0
			? [
					"● config.json にあるのに埋め込まれていないキー（DEFAULT_REMOTE_CONFIG へ追加してください）:",
					...missingFromEmbedded.map(({ key, actual: a }) => `  - ${key}: config.json="${a}"`),
				]
			: []),
		...(missingFromCdn.length > 0
			? [
					"● 埋め込まれているのに config.json に無いキー（削除されたか、キー名を間違えています）:",
					...missingFromCdn.map(({ key, embedded: e }) => `  - ${key}: 埋め込み="${e}"`),
				]
			: []),
	].join("\n"),
);
process.exit(1);
