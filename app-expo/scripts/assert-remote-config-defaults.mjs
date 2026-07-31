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
 * ## なぜ config.json 全体ではなく「schema との交差」を見るのか（#1110）
 * 当初この検査は config.json のキー**全件**を対象にしており、「config.json に在って
 * `DEFAULT_REMOTE_CONFIG` に無いキー」を無条件に失敗としていた。その結果、development の
 * config テーブルに残っていた **`remoteConfigSchema` に存在しないキー 7 件**で nightly の
 * E2E Web Test が常時失敗し、Playwright が 1 件も実行されない状態になった（#1110）。
 *
 * config.json は Supabase の `config` テーブルを GCS へ出力した静的マスタで、
 * **このリポジトリのコードではなく DB の中身**が入力になる。運用や別プロダクトが行を足せば、
 * アプリの契約と無関係に増える。一方で `remoteConfigSchema` に無いキーは
 * - api: `remoteConfigSchema.safeParse()` が strict でない `z.object` なので **破棄する**
 * - app-expo: Zod を通さず `RemoteConfigValues` へキャストするだけなので **型に無く参照できない**
 * ため、そもそもアプリから読めない。**既定値の乖離という概念が成立しないキー**である。
 * よって突き合わせの対象は「アプリの契約（`remoteConfigSchema`）と config.json の交差」に絞る。
 *
 * ## 意図的に落としている検知と、その代替（#1110）
 * 落としているのは「**config.json に、schema がまだ知らないキーが増えた**」ことを CI の
 * 赤で知る能力だけ。赤にしない理由は、その赤をこのリポジトリの変更で解消できないため
 * （allowlist へ足して黙らせるのが定例作業になり、「黙って緑」に最も近づく）。代替は 2 つ。
 * 1. **常時ログへ出す。**照合対象外にしたキーは、成功時も必ずキー名と件数を出力する。
 *    nightly のログを見れば未知キーが増えたことは分かる。
 * 2. **より実害のあるドリフトを新しく赤にする。**「`remoteConfigSchema` のキー集合 ≡
 *    `DEFAULT_REMOTE_CONFIG` のキー集合」という不変条件を 4-1 で検査する。これは本来
 *    `DEFAULT_REMOTE_CONFIG: RemoteConfigValues` の型注釈が守るものだが、app-expo の
 *    `typecheck` / `jest` はどの workflow でも実行されていない。schema へキーを足したのに
 *    既定値へ足し忘れた PR は、config.json へ反映される前の段階でここが赤にする。
 * 差し引きでは検知力が増える。
 *
 * ## 出力の約束
 * - ホスト名や URL、`.env` の中身は **出力しない**（差分はキー名と値だけ）
 * - 環境変数が無い環境（ローカル開発など）は skip して成功扱いにする。
 *   ただし **skip したことは必ず出力する**（黙って緑になるのが一番悪い）
 * - 照合対象外にしたキーは、**成功時も**キー名と件数を必ず出力する（上記の代替 1）
 *
 * ## 既知の限界
 * このゲートが突き合わせるのは、同じ job の E2E が叩くのと同じ **development** の config.json。
 * 一方 `DEFAULT_REMOTE_CONFIG` の値の根拠は本番 config.json である（`lib/remoteConfig.ts` 参照）。
 * dev と prod の値がずれると「本番の既定値は正しいのに CI が落ちる」偽陽性が起こりうる。
 * それでも development を見るのは、この job で守りたいのが「E2E が実際に読む値」との一致だから。
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appRoot, "..");

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

/**
 * `shared/remoteConfig/remoteConfig.schema.ts` の `z.object({...})` から
 * アプリが知っているキー名を取り出す。= アプリの契約そのもの（#1110）。
 *
 * `shared/dist/remoteConfig/remoteConfig.schema.js` を import して
 * `Object.keys(remoteConfigSchema.shape)` を読む手もあるが、schema が `$Enums`（prisma client）を
 * import しているため `shared` の build 順と prisma generate に依存してしまう。
 * `readEmbeddedDefaults()` と流儀を揃え、依存を増やさない AST 方式を採る。
 *
 * ⚠️ 取り出せない・0 件・`PropertyAssignment` 以外が混ざる場合は **必ず throw する**。
 *    ここを握り潰すと「照合対象 0 件でゲートが緑」になる。このゲートで一番避けたい壊れ方。
 *    `z.object({...})` を `.extend()` / `.merge()` へ書き換えると抽出は壊れるが、
 *    そのときも黙って 0 件照合にはならず、この throw で赤くなる。
 *
 * @returns schema が宣言しているキー名の配列（宣言順）
 */
const readSchemaKeys = () => {
	const sourcePath = path.join(repoRoot, "shared", "remoteConfig", "remoteConfig.schema.ts");
	const sourceFile = ts.createSourceFile(
		sourcePath,
		readFileSync(sourcePath, "utf8"),
		ts.ScriptTarget.Latest,
		/* setParentNodes */ true,
	);

	/** `export const remoteConfigSchema = z.object({ <ここ> })` の中身 */
	let objectLiteral;
	for (const statement of sourceFile.statements) {
		if (!ts.isVariableStatement(statement)) continue;
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "remoteConfigSchema") continue;
			const initializer = declaration.initializer;
			if (!initializer || !ts.isCallExpression(initializer)) continue;
			const callee = initializer.expression;
			// `z.object(...)` 以外（`.extend()` / `.merge()` など）は拾わない → 後段で throw する
			if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "object") continue;
			const [argument] = initializer.arguments;
			if (argument && ts.isObjectLiteralExpression(argument)) objectLiteral = argument;
		}
	}

	if (!objectLiteral) {
		throw new Error(
			"shared/remoteConfig/remoteConfig.schema.ts から remoteConfigSchema = z.object({...}) を取り出せませんでした。" +
				"（schema の書き方が変わった可能性があります。このスクリプトの readSchemaKeys() を追従させてください）",
		);
	}

	const keys = [];
	for (const property of objectLiteral.properties) {
		// spread / computed key / shorthand / method が混ざると「一部のキーだけ照合する」静かな穴になる
		if (!ts.isPropertyAssignment(property)) {
			throw new Error(
				`remoteConfigSchema に PropertyAssignment 以外の要素があります（${ts.SyntaxKind[property.kind]}）。` +
					"キー名を漏れなく取り出せないため中断します。readSchemaKeys() を追従させてください。",
			);
		}
		const name = property.name;
		if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
			keys.push(name.text);
			continue;
		}
		throw new Error(
			`remoteConfigSchema に想定外のキー表現があります（${ts.SyntaxKind[name.kind]}）。readSchemaKeys() を追従させてください。`,
		);
	}

	if (keys.length === 0) {
		throw new Error(
			"remoteConfigSchema からキーを 1 件も取り出せませんでした。照合対象 0 件で緑にしないため中断します。",
		);
	}
	return keys;
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

const schemaKeys = readSchemaKeys();
/** アプリが読めるキー（= `remoteConfigSchema` が宣言しているキー） */
const known = new Set(schemaKeys);
const embedded = readEmbeddedDefaults();
const actual = await fetchCdnConfig();

// ── 4-1. config.json を見ずに成立する不変条件（#1110）──────────────────────
// 本来 `DEFAULT_REMOTE_CONFIG: RemoteConfigValues` の型注釈が守っているが、app-expo の
// typecheck / jest はどの workflow でも実行されていない。config.json の状態と無関係に
// 成立すべき条件なので、CDN との突き合わせ（4-2）より前に独立して検査する。

/** DEFAULT_REMOTE_CONFIG にあるのに schema に無いキー（アプリから読めない既定値） */
const embeddedNotInSchema = Object.keys(embedded).filter((key) => !known.has(key));
/**
 * schema にあるのに DEFAULT_REMOTE_CONFIG に無いキー（CDN 未到達端末が undefined を掴む）。
 *
 * `.optional().default(...)` のキーは `z.infer` の**出力**型では必須になるため、
 * ここで誤検知しない（実例: `v1_bulk_import_preflight_enabled` は既定値側にも在る）。
 * 逆に default を持たない素の `.optional()` を schema へ足すと誤検知しうるが、
 * schema 側がそれを禁じている（`remoteConfig.schema.ts` の ⚠️ 参照）ので許容しない。
 */
const schemaNotInEmbedded = schemaKeys.filter((key) => !(key in embedded));

// ── 4-2. schema 既知キーだけを config.json と突き合わせる（#1110）──────────

/** 値が違うキー */
const mismatched = [];
/** config.json にあるのに DEFAULT_REMOTE_CONFIG に無いキー */
const missingFromEmbedded = [];
/** DEFAULT_REMOTE_CONFIG にあるのに config.json に無いキー（allowlist を除く） */
const missingFromCdn = [];
/** schema 外＝アプリが読めないため照合対象外にしたキー。失敗にはしないが必ずログへ出す */
const ignoredFromCdn = [];

for (const [key, value] of Object.entries(actual)) {
	if (!known.has(key)) {
		ignoredFromCdn.push(key);
		continue;
	}
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
/** 実際に値を突き合わせたキー数（schema と config.json の交差） */
const comparedCount = Object.keys(actual).filter((key) => known.has(key)).length;

const failureCount =
	mismatched.length +
	missingFromEmbedded.length +
	missingFromCdn.length +
	embeddedNotInSchema.length +
	schemaNotInEmbedded.length;

if (failureCount === 0) {
	console.log(
		`✅ DEFAULT_REMOTE_CONFIG は config.json と同値です（照合キー数: ${comparedCount} / schema キー数: ${schemaKeys.length}）`,
	);
	if (allowlisted.length > 0) {
		console.log(`   ℹ️ config.json に無いことを許容したキー（schema の default 由来）: ${allowlisted.join(", ")}`);
	}
	// ⚠️ 0 件でも必ず出す。「schema 外のキー: 0 件」という行があって初めて、
	//    config テーブルがアプリの契約と一致していることをログから読み取れる（#1110）
	if (ignoredFromCdn.length > 0) {
		console.log(
			[
				`   ℹ️ schema 外のため照合対象外にしたキー（${ignoredFromCdn.length}件）: ${ignoredFromCdn.join(", ")}`,
				"      （remoteConfigSchema に無いキーはアプリから読めない。api は safeParse で破棄し、",
				"        フロントは RemoteConfigValues の型に無いので参照できない ⇒ 既定値の乖離が起こりえない）",
			].join("\n"),
		);
	} else {
		console.log("   ℹ️ schema 外のため照合対象外にしたキー: 0件（config.json は remoteConfigSchema の契約と一致）");
	}
	process.exit(0);
}

console.error(
	[
		`❌ DEFAULT_REMOTE_CONFIG が Remote Config の契約から乖離しています（${failureCount}件）。`,
		"   app-expo/lib/remoteConfig.ts の DEFAULT_REMOTE_CONFIG と",
		"   app-expo/__tests__/remoteConfigDefaults.test.ts の EXPECTED_DEFAULTS を実際の値へ合わせてください。",
		"",
		...(schemaNotInEmbedded.length > 0
			? [
					"● schema にあるのに DEFAULT_REMOTE_CONFIG へ入れていないキー（CDN 未到達端末が undefined を掴みます）:",
					...schemaNotInEmbedded.map((key) => `  - ${key}`),
				]
			: []),
		...(embeddedNotInSchema.length > 0
			? [
					"● DEFAULT_REMOTE_CONFIG にあるのに remoteConfigSchema に無いキー（アプリからは読めない既定値です）:",
					...embeddedNotInSchema.map((key) => `  - ${key}: 埋め込み="${embedded[key]}"`),
				]
			: []),
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
		"",
		// 失敗時も内訳を残す。原因調査で「照合対象がどこまでだったか」を後から読めるようにするため
		`ℹ️ 照合キー数: ${comparedCount} / schema キー数: ${schemaKeys.length}`,
		`ℹ️ schema 外のため照合対象外にしたキー（${ignoredFromCdn.length}件）: ${ignoredFromCdn.join(", ") || "なし"}`,
	].join("\n"),
);
process.exit(1);
