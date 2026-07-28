const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

// Find the project and workspace directories
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// #1030 【セキュリティ】E2E(Detox) 用のセッション注入フックを本番バンドルから物理的に排除する。
// 条件分岐 + minifier の dead code elimination に頼ると、Metro が minify 前に静的収集する
// import/require のせいで実装モジュール自体はバンドルに残ってしまう。
// そこで resolver 段で noop 実装へ差し替え、モジュールグラフに入る時点で実装を排除する（主ガード = 第 1 層）。
const E2E_AUTH_HOOK_ENABLED = process.env.EXPO_PUBLIC_E2E_AUTH_HOOK === "1";

// #1030 【セキュリティ】(レビュー Major-3) E2E ビルドはローカル prebuild + Gradle/xcodebuild 経路のみで、
// EAS Build / EAS Update を通らない。EAS 経路のバンドル時にフラグが立っているのは環境変数の設定事故
// （= 本番への混入の入口）であり、GitHub job 側の shell assert では EAS サーバ内の env を検査できない。
// バンドルが実行される場所（= この Metro 設定の評価時点）で確実に落とす。
// - EAS_BUILD: EAS Build サーバ上で常に設定される（クラウドビルド全経路をカバー）
// - EXPO_PUBLIC_NODE_ENV=production: eas update --environment production のローカルバンドルをカバー
if (E2E_AUTH_HOOK_ENABLED && (process.env.EAS_BUILD || process.env.EXPO_PUBLIC_NODE_ENV === "production")) {
	throw new Error(
		"EXPO_PUBLIC_E2E_AUTH_HOOK=1 のまま EAS ビルド/本番向けバンドルが実行されました（E2E フックの本番混入）。" +
			"環境変数の設定を確認してください（#1030）。",
	);
}
const E2E_INJECT_SESSION_IMPL = path.resolve(projectRoot, "lib/e2e/injectTestSession.ts");
const E2E_INJECT_SESSION_NOOP = path.resolve(projectRoot, "lib/e2e/injectTestSession.noop.ts");
const E2E_LAUNCH_ARGS_PACKAGE = "react-native-launch-arguments";

config.resolver.resolveRequest = (context, moduleName, platform) => {
	// #1030 【設計】web は E2E(Detox) の対象外で、react-native-launch-arguments のネイティブ実装も存在しない。
	// そのため EXPO_PUBLIC_E2E_AUTH_HOOK=1 のビルドでも web バンドルからは常に実装を排除する
	//（= e2e-web が対象にする web export には、E2E ビルドであっても注入フックが 1 行も入らない）。
	const excludeE2EHook = !E2E_AUTH_HOOK_ENABLED || platform === "web";

	if (excludeE2EHook) {
		// #1030 【セキュリティ】起動引数読み取り用のネイティブモジュールも本番バンドルの JS グラフから外す。
		// パッケージ名は specifier が一意（相対 import からは到達し得ない）ため、解決前に潰してよい
		if (moduleName === E2E_LAUNCH_ARGS_PACKAGE || moduleName.startsWith(`${E2E_LAUNCH_ARGS_PACKAGE}/`)) {
			return { type: "empty" };
		}
	}

	// #1030 【設計】Expo 公式の chaining パターン。ユーザー定義 resolver は Expo 独自 resolver チェーン
	//（tsconfig paths の `@/*` 解決を含む）の手前で呼ばれるため、まず既定の解決を通す。
	const resolution = context.resolveRequest(context, moduleName, platform);

	// #1030 【セキュリティ】(レビュー M-2) specifier 文字列（"@/lib/e2e/injectTestSession" 等）で判定すると
	// 相対 import（"./injectTestSession"）を取りこぼし、実装が本番グラフへ静かに復帰する（fail-open）。
	// 判定は必ず「解決後の実ファイルパス」で行い、import の書き方に依存しないようにする。
	if (excludeE2EHook && resolution && resolution.type === "sourceFile") {
		if (path.resolve(resolution.filePath) === E2E_INJECT_SESSION_IMPL) {
			return { type: "sourceFile", filePath: E2E_INJECT_SESSION_NOOP };
		}
	}

	return resolution;
};

config.resolver.extraNodeModules = {
	"@shared": path.resolve(monorepoRoot, "shared"),
	"@expo": path.resolve(monorepoRoot, "expo"),
};

// 1. Watch all files within the monorepo
config.watchFolders = [monorepoRoot];
// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
	path.resolve(projectRoot, "node_modules"),
	path.resolve(monorepoRoot, "node_modules"),
];

module.exports = config;
