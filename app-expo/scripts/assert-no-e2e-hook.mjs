import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 🛡️ 本番相当バンドルに E2E セッション注入フックが混入していないことを検証する CI ゲート（#1030）。
 *
 * 使い方（EXPO_PUBLIC_E2E_AUTH_HOOK を設定していない状態でバンドルしてから実行する）:
 *   pnpm --filter app-expo build:web              # web バンドル      -> app-expo/dist
 *   pnpm --filter app-expo build:e2e-check-native # native バンドル   -> app-expo/dist-e2e-check
 *   pnpm --filter app-expo assert:no-e2e-hook
 *
 * 検査対象は既定で上記 2 つ。引数でディレクトリを明示指定すると、そのディレクトリだけを検査する
 * （例: `node ./scripts/assert-no-e2e-hook.mjs dist`）。
 *
 * #1030 【セキュリティ】(レビュー M-1) web export だけを見ても守りたい成果物（EAS の native production ビルド）の
 * 保証にならない。metro の resolver 差し替えはプラットフォーム非依存だが、「fail-closed のゲート」と称する以上、
 * `expo export -p android -p ios` の native バンドル（Hermes 変換前の JS）も実際に検査する。
 *
 * metro.config.js の resolver 差し替えが Expo SDK 更新等で壊れた場合、ここで fail して気付ける。
 */

// #1030 / #1031 【セキュリティ】各 E2E フックの実装ファイルのみが持つ番号札。noop 実装側には存在しない。
// フックを増やしたら必ずここへ追加すること（追加を忘れると新しいフックだけゲートを素通りする）
const SENTINELS = [
	{ value: "__E2E_TEST_SESSION_HOOK__", label: "セッション注入フック（lib/e2e/injectTestSession.ts）" },
	{ value: "__E2E_MEDIA_SELECTION_HOOK__", label: "メディア選択差し替えフック（lib/e2e/selectMediaStub.ts）" },
	{ value: "__E2E_TUTORIAL_SEED_HOOK__", label: "チュートリアル視聴済みシードフック（lib/e2e/tutorialSeed.ts）" },
	{ value: "__E2E_PRELOAD_PROBE_HOOK__", label: "先読み画像ロード枚数プローブ（lib/e2e/preloadProbe.tsx）" },
	{ value: "__E2E_ROUTE_PARAMS_PROBE_HOOK__", label: "ルートパラメータプローブ（lib/e2e/routeParamsProbe.tsx）" },
	{
		value: "__E2E_VOTE_IMAGE_PRELOAD_PROBE_HOOK__",
		label: "友達投票の候補画像プリロードプローブ（lib/e2e/voteImagePreloadProbe.tsx）",
	},
];

// #1030 【設計】(レビュー m-6) `import.meta.dirname` は Node >= 20.11 依存。
// CI の node-version は "20"（マイナー未固定）なので、どのバージョンでも動く fileURLToPath を使う
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");

/** 検査対象ディレクトリと、それを生成するコマンド（不足時の案内に使う） */
const DEFAULT_TARGETS = [
	{ dir: "dist", how: "pnpm --filter app-expo build:web" },
	{ dir: "dist-e2e-check", how: "pnpm --filter app-expo build:e2e-check-native" },
];

const cliDirs = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const targets =
	cliDirs.length > 0 ? cliDirs.map((dir) => ({ dir, how: `${dir} を生成するコマンド` })) : DEFAULT_TARGETS;

/** ディレクトリ配下の .js / .hbc を再帰的に列挙する */
const collectBundles = (dir) =>
	readdirSync(dir).flatMap((entry) => {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) return collectBundles(full);
		return /\.(js|hbc)$/.test(entry) ? [full] : [];
	});

let missing = false;
let offenders = [];
let scannedCount = 0;

for (const { dir, how } of targets) {
	const absolute = path.isAbsolute(dir) ? dir : path.resolve(appRoot, dir);

	// #1030 【設計】(レビュー m-6) ディレクトリ不在は ENOENT で落とさず、何を実行すべきかを案内して fail する。
	// 「バンドルしていないので何も見つからなかった = pass」という偽の成功を出さないため fail-closed のまま維持する
	if (!existsSync(absolute)) {
		console.error(`❌ 検査対象ディレクトリがありません: ${absolute}\n   先に \`${how}\` を実行してください。`);
		missing = true;
		continue;
	}

	const bundles = collectBundles(absolute);
	scannedCount += bundles.length;
	if (bundles.length === 0) {
		console.error(`❌ ${absolute} に .js / .hbc が 1 つもありません（バンドルが生成されていない可能性）。`);
		missing = true;
		continue;
	}

	for (const file of bundles) {
		const contents = readFileSync(file, "latin1");
		for (const sentinel of SENTINELS) {
			if (contents.includes(sentinel.value)) {
				offenders.push({ file, sentinel });
			}
		}
	}
	console.log(`🔎 検査: ${path.relative(appRoot, absolute)}（${bundles.length} ファイル）`);
}

if (offenders.length > 0) {
	console.error(
		[
			"❌ 本番相当バンドルに E2E フックが混入しています。",
			"metro.config.js の resolveRequest による noop 差し替えが機能していない可能性があります。",
			"（EXPO_PUBLIC_E2E_AUTH_HOOK / EXPO_PUBLIC_E2E_MEDIA_HOOK / EXPO_PUBLIC_E2E_TUTORIAL_HOOK を" +
				"立てたまま検査していないかも確認してください）",
			...offenders.map(({ file, sentinel }) => `  - ${path.relative(appRoot, file)} … ${sentinel.label}`),
		].join("\n"),
	);
	process.exit(1);
}

if (missing) {
	process.exit(1);
}

console.log(
	`✅ 本番相当バンドルに E2E フック（${SENTINELS.length} 種）は含まれていません（検査ファイル数: ${scannedCount}）`,
);
