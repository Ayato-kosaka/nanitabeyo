import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import ts from "typescript";

/**
 * 🗺️ `app-expo/public/sitemap.xml` を生成するスクリプト（#281）。
 *
 * 使い方:
 *   pnpm --filter app-expo generate:sitemap            # public/sitemap.xml を書き出す
 *   pnpm --filter app-expo generate:sitemap -- --stdout # 書き出さず標準出力へ（内容確認用）
 *   pnpm --filter app-expo generate:sitemap -- --check  # 書き出さず、コミット済みの内容との差分を検査
 *
 * `build:web` の前段に入れてあるので、web バンドルを作れば必ず最新版が dist へ入る
 * （`public/` の中身は `expo export --platform web` が dist へコピーする。favicon.ico や
 *  manifest.json が本番で配信できているのと同じ経路）。
 *
 * ## なぜ手書きの静的ファイルにしないのか
 * ページやロケールが増えたときに、手書きの sitemap.xml を直す人はいない。
 * 「古い URL しか載っていない sitemap」は無いより悪い（クロール予算を捨てる）ので、
 * URL の集合はコード（`lib/seo/sitemap.ts` の `SITEMAP_ROUTES` × `PUBLIC_LOCALES`）から作る。
 *
 * ## なぜ TypeScript を vm で読むのか
 * 生成ロジックとロケール一覧は app 側の TS（`lib/seo/sitemap.ts` / `constants/seoLocales.ts`）が
 * 正であり、jest のユニットテストもそちらを直接読んでいる。Node からは import できないので、
 * `scripts/assert-remote-config-defaults.mjs` と同じ流儀で `typescript` パッケージを使って読む。
 * ここで値を複製すると「スクリプトとアプリで別のロケール一覧を持つ」状態になり、
 * テストが緑のまま sitemap だけ古くなる。
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");

const args = process.argv.slice(2);
const toStdout = args.includes("--stdout");
const checkOnly = args.includes("--check");

const outputPath = path.join(appRoot, "public", "sitemap.xml");

/**
 * 本番の配信元。`app.config.ts` が `EXPO_PUBLIC_WEB_BASE_URL` を `extra` へ渡しており、
 * canonical（`SeoHeadRenderer.web.tsx`）もその値を使う。env が無い環境では
 * `lib/seo/sitemap.ts` の既定値（本番ドメイン）にフォールバックする。
 */
// #281 `WEB_BASE_URL` も見る理由:
// 旧生成器 `scripts/gen-sitemap.mjs` は Repository variable の `WEB_BASE_URL` を使っており、
// firebase-hosting-deploy.yml もその変数を渡していた。生成器を1本へ統一したあとも
// その設定が生き続けるよう、両方の env を受ける。
const baseUrl = process.env.EXPO_PUBLIC_WEB_BASE_URL?.trim() || process.env.WEB_BASE_URL?.trim() || undefined;

// ── TypeScript モジュールを Node から読むための最小ローダ ────────────────────

/**
 * app 側の TS を読むときに、実体の代わりに差し込む値。
 *
 * `constants/Env.ts` は expo-constants を import するため Node では評価できない。
 * `constants/seoLocales.ts` が読むのは `Env.WEB_BASE_URL`（OG 画像の URL 組み立て）だけで、
 * sitemap が使う `PUBLIC_LOCALES` には影響しないので、ダミーを渡して先へ進める。
 */
const STUB_MODULES = new Map([["@/constants/Env", { Env: { WEB_BASE_URL: "" } }]]);

/** 読み込み済み TS モジュールの exports。循環 import と二重評価を避ける */
const moduleCache = new Map();

/**
 * import 指定子を実ファイルへ解決する。
 *
 * `@/` エイリアス（tsconfig の paths）と相対パスだけを解決し、それ以外（node_modules）は
 * **必ず throw する**。黙って空オブジェクトを返すと、その import に依存した値が undefined のまま
 * 生成が続き、「URL が 1 件も無い sitemap」が静かに出来上がる。
 *
 * @param specifier import 指定子
 * @param fromFile import 元のファイルの絶対パス
 * @returns 解決した絶対パス
 */
const resolveSpecifier = (specifier, fromFile) => {
	let base;
	if (specifier.startsWith("@/")) base = path.join(appRoot, specifier.slice(2));
	// #721 `@shared/` は monorepo の `shared/` パッケージ（tsconfig の paths と同じ対応）。
	// `PUBLIC_LOCALES` を api からも参照できるよう shared へ移したため、
	// `constants/seoLocales.ts` からこの specifier が現れる。**dist ではなくソースの .ts を読む**
	// （dist は build しないと古いままで、「テストは緑なのに sitemap だけ古い」を作る）
	else if (specifier.startsWith("@shared/")) base = path.resolve(appRoot, "..", "shared", specifier.slice("@shared/".length));
	else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
	else
		throw new Error(
			`generate-sitemap: "${specifier}"（${path.relative(appRoot, fromFile)} から）を解決できません。` +
				"node_modules への依存を足したなら、このスクリプトのローダか STUB_MODULES を追従させてください。",
		);

	for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
		if (existsSync(candidate)) return candidate;
	}
	throw new Error(`generate-sitemap: "${specifier}" に対応する .ts が見つかりません（探索起点: ${base}）。`);
};

/**
 * TS ファイルを CommonJS へトランスパイルし、vm 上で評価して exports を返す。
 *
 * 型は落ちるだけなので、値の意味は tsc / jest 側で担保される（このスクリプトは実行するだけ）。
 *
 * @param absolutePath 対象ファイルの絶対パス
 * @returns そのモジュールの exports
 */
const loadTsModule = (absolutePath) => {
	const cached = moduleCache.get(absolutePath);
	if (cached) return cached;

	const transpiled = ts.transpileModule(readFileSync(absolutePath, "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
		fileName: absolutePath,
	}).outputText;

	const moduleObject = { exports: {} };
	moduleCache.set(absolutePath, moduleObject.exports);

	const requireFromModule = (specifier) => {
		if (STUB_MODULES.has(specifier)) return STUB_MODULES.get(specifier);
		return loadTsModule(resolveSpecifier(specifier, absolutePath));
	};

	vm.runInNewContext(
		transpiled,
		{ module: moduleObject, exports: moduleObject.exports, require: requireFromModule, console },
		{ filename: absolutePath, timeout: 5000 },
	);

	// `exports` へ再代入する書き方（`module.exports = ...`）にも追従できるよう、評価後の実体で上書きする
	moduleCache.set(absolutePath, moduleObject.exports);
	return moduleObject.exports;
};

// ── 生成 ─────────────────────────────────────────────────────────────────────

try {
	const { buildSitemapXml, SITEMAP_ROUTES } = loadTsModule(path.join(appRoot, "lib", "seo", "sitemap.ts"));
	const { PUBLIC_LOCALES } = loadTsModule(path.join(appRoot, "constants", "seoLocales.ts"));

	if (typeof buildSitemapXml !== "function") {
		throw new Error("lib/seo/sitemap.ts から buildSitemapXml を取り出せませんでした。");
	}
	if (!Array.isArray(PUBLIC_LOCALES) || PUBLIC_LOCALES.length === 0) {
		throw new Error("constants/seoLocales.ts から PUBLIC_LOCALES を取り出せませんでした（0 件で生成しません）。");
	}

	// locales / routes は既定値（= app 側の定義そのもの）に任せる。baseUrl だけ env で上書きしうる
	const xml = buildSitemapXml(baseUrl ? { baseUrl } : {});
	const urlCount = (xml.match(/<loc>/g) ?? []).length;
	if (urlCount !== PUBLIC_LOCALES.length * SITEMAP_ROUTES.length) {
		throw new Error(
			`生成した URL 数（${urlCount}）が ロケール${PUBLIC_LOCALES.length} × ルート${SITEMAP_ROUTES.length} と一致しません。`,
		);
	}

	if (toStdout) {
		process.stdout.write(xml);
		process.exit(0);
	}

	if (checkOnly) {
		// ⚠️ 差分があっても勝手に直さない。「コミット済みの sitemap.xml が古い」ことを赤で伝える
		const current = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : null;
		if (current === xml) {
			console.log(`✅ ${path.relative(appRoot, outputPath)} は最新です（URL 数: ${urlCount}）`);
			process.exit(0);
		}
		console.error(
			[
				`❌ ${path.relative(appRoot, outputPath)} が生成結果と一致しません。`,
				"   `pnpm --filter app-expo generate:sitemap` を実行してコミットしてください。",
				current === null ? "   （ファイルが存在しません）" : "",
			]
				.filter(Boolean)
				.join("\n"),
		);
		process.exit(1);
	}

	writeFileSync(outputPath, xml, "utf8");
	console.log(
		[
			`✅ ${path.relative(appRoot, outputPath)} を生成しました`,
			`   URL 数: ${urlCount}（ロケール ${PUBLIC_LOCALES.length} × ルート ${SITEMAP_ROUTES.length}）`,
			`   baseUrl: ${baseUrl ?? "既定値（EXPO_PUBLIC_WEB_BASE_URL 未設定）"}`,
		].join("\n"),
	);
} catch (error) {
	console.error(`❌ sitemap.xml の生成に失敗しました。\n   ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
