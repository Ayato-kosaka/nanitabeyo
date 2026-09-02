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
// - EAS_BUILD: EAS Build サーバ上で常に設定される（クラウドビルド全経路をカバー。主条件）
// - EXPO_PUBLIC_NODE_ENV=production: eas update --environment production のローカルバンドル向けの
//   防御的な追加条件（EAS production 環境の実値は未確認のため、この条件単体には依存しない。レビュー m-1）
// #1031 B6 【セキュリティ】メディア選択を固定画像へ差し替える E2E フックも、
// セッション注入フックとまったく同じ方式（resolver 差し替え + sentinel ゲート）で本番から排除する。
// フラグを分けているのは「認証だけ E2E 化したい」「投稿フローも E2E 化したい」を別々に選べるようにするため
const E2E_MEDIA_HOOK_ENABLED = process.env.EXPO_PUBLIC_E2E_MEDIA_HOOK === "1";

// #1027 【セキュリティ】検索チュートリアルの視聴済みフラグを起動引数で固定する E2E フックも同一方式で排除する。
// これも「認証だけ」「投稿フローだけ」と同様に独立して選べるようフラグを分けている
const E2E_TUTORIAL_HOOK_ENABLED = process.env.EXPO_PUBLIC_E2E_TUTORIAL_HOOK === "1";

// #1030 【セキュリティ】(レビュー Major-3) E2E ビルドはローカル prebuild + Gradle/xcodebuild 経路のみで、
// EAS Build / EAS Update を通らない。EAS 経路でフラグが立っているのは環境変数の設定事故（= 本番混入の入口）。
const IS_PRODUCTION_BUNDLE = process.env.EAS_BUILD || process.env.EXPO_PUBLIC_NODE_ENV === "production";
if ((E2E_AUTH_HOOK_ENABLED || E2E_MEDIA_HOOK_ENABLED || E2E_TUTORIAL_HOOK_ENABLED) && IS_PRODUCTION_BUNDLE) {
	throw new Error(
		"EXPO_PUBLIC_E2E_AUTH_HOOK / EXPO_PUBLIC_E2E_MEDIA_HOOK / EXPO_PUBLIC_E2E_TUTORIAL_HOOK が立ったまま " +
			"EAS ビルド/本番向けバンドルが実行されました（E2E フックの本番混入）。" +
			"環境変数の設定を確認してください（#1027 / #1030 / #1031）。",
	);
}

// #1127 【診断】E2E フックが有効なビルドは、認証・メディア選択・チュートリアルの挙動が
// 通常ビルドと変わる（例: メディア選択はフォトピッカーを開かず固定画像を返す）。
// これが黙って差し替わっていると「実機で動かない」の切り分けに時間が溶けるため、
// どのフックが有効なのかを名前付きで必ず目立たせる。
const ENABLED_E2E_HOOKS = [
	E2E_AUTH_HOOK_ENABLED && "EXPO_PUBLIC_E2E_AUTH_HOOK（セッション注入 / #1030）",
	E2E_MEDIA_HOOK_ENABLED && "EXPO_PUBLIC_E2E_MEDIA_HOOK（メディア選択を固定画像へ差し替え / #1031 B6）",
	E2E_TUTORIAL_HOOK_ENABLED && "EXPO_PUBLIC_E2E_TUTORIAL_HOOK（チュートリアル視聴済みフラグの固定 / #1027）",
].filter(Boolean);
if (ENABLED_E2E_HOOKS.length > 0) {
	console.warn(
		"\n⚠️⚠️⚠️  E2E フックが有効な状態でバンドルしています（通常ビルドとは挙動が異なります）  ⚠️⚠️⚠️\n" +
			ENABLED_E2E_HOOKS.map((hook) => `  - ${hook}`).join("\n") +
			"\n  通常の開発・動作確認では、これらの環境変数を外して Metro を起動し直してください。\n",
	);
}

const E2E_INJECT_SESSION_IMPL = path.resolve(projectRoot, "lib/e2e/injectTestSession.ts");
const E2E_INJECT_SESSION_NOOP = path.resolve(projectRoot, "lib/e2e/injectTestSession.noop.ts");
const E2E_SELECT_MEDIA_IMPL = path.resolve(projectRoot, "lib/e2e/selectMediaStub.ts");
const E2E_SELECT_MEDIA_NOOP = path.resolve(projectRoot, "lib/e2e/selectMediaStub.noop.ts");
const E2E_TUTORIAL_SEED_IMPL = path.resolve(projectRoot, "lib/e2e/tutorialSeed.ts");
const E2E_TUTORIAL_SEED_NOOP = path.resolve(projectRoot, "lib/e2e/tutorialSeed.noop.ts");
// #1087 先読み画像のロード枚数プローブ。対象が検索チュートリアルの画像なので、
// 新しいフラグを増やさず EXPO_PUBLIC_E2E_TUTORIAL_HOOK に相乗りする（判定は上の E2E_TUTORIAL_HOOK_ENABLED）
const E2E_PRELOAD_PROBE_IMPL = path.resolve(projectRoot, "lib/e2e/preloadProbe.tsx");
const E2E_PRELOAD_PROBE_NOOP = path.resolve(projectRoot, "lib/e2e/preloadProbe.noop.tsx");
// #1272 ルートパラメータのプローブも同じく EXPO_PUBLIC_E2E_TUTORIAL_HOOK に相乗りする
const E2E_ROUTE_PARAMS_PROBE_IMPL = path.resolve(projectRoot, "lib/e2e/routeParamsProbe.tsx");
const E2E_ROUTE_PARAMS_PROBE_NOOP = path.resolve(projectRoot, "lib/e2e/routeParamsProbe.noop.tsx");
// #1213 友達投票の候補画像プリロードのプローブも同じく EXPO_PUBLIC_E2E_TUTORIAL_HOOK に相乗りする
const E2E_VOTE_IMAGE_PRELOAD_PROBE_IMPL = path.resolve(projectRoot, "lib/e2e/voteImagePreloadProbe.tsx");
const E2E_VOTE_IMAGE_PRELOAD_PROBE_NOOP = path.resolve(projectRoot, "lib/e2e/voteImagePreloadProbe.noop.tsx");
const E2E_LAUNCH_ARGS_PACKAGE = "react-native-launch-arguments";

config.resolver.resolveRequest = (context, moduleName, platform) => {
	// #1030 【設計】web は E2E(Detox) の対象外で、react-native-launch-arguments のネイティブ実装も存在しない。
	// そのため EXPO_PUBLIC_E2E_AUTH_HOOK=1 のビルドでも web バンドルからは常に実装を排除する
	//（= e2e-web が対象にする web export には、E2E ビルドであっても注入フックが 1 行も入らない）。
	const excludeE2EHook = !E2E_AUTH_HOOK_ENABLED || platform === "web";
	// #1031 B6 判定はフックごとに独立させる（片方だけ有効なビルドを許すため）
	const excludeE2EMediaHook = !E2E_MEDIA_HOOK_ENABLED || platform === "web";
	// #1027 チュートリアル視聴済みフラグのシードも同様に独立判定する
	const excludeE2ETutorialHook = !E2E_TUTORIAL_HOOK_ENABLED || platform === "web";

	// #1030 【セキュリティ】起動引数読み取り用のネイティブモジュールも本番バンドルの JS グラフから外す。
	// パッケージ名は specifier が一意（相対 import からは到達し得ない）ため、解決前に潰してよい。
	// ⚠️ 起動引数を読むフックは複数あるため、**すべて無効なときだけ**潰すこと。
	// 片方だけを見て潰すと「チュートリアルフックだけ有効なビルド」で実装が空モジュールを参照して壊れる
	if (excludeE2EHook && excludeE2ETutorialHook) {
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
	if (resolution && resolution.type === "sourceFile") {
		const resolvedPath = path.resolve(resolution.filePath);

		if (excludeE2EHook && resolvedPath === E2E_INJECT_SESSION_IMPL) {
			return { type: "sourceFile", filePath: E2E_INJECT_SESSION_NOOP };
		}

		// #1031 B6 メディア選択の差し替えフックも同じ「解決後の実ファイルパス」で判定する
		if (excludeE2EMediaHook && resolvedPath === E2E_SELECT_MEDIA_IMPL) {
			return { type: "sourceFile", filePath: E2E_SELECT_MEDIA_NOOP };
		}

		// #1027 チュートリアル視聴済みフラグのシードフックも同じ「解決後の実ファイルパス」で判定する
		if (excludeE2ETutorialHook && resolvedPath === E2E_TUTORIAL_SEED_IMPL) {
			return { type: "sourceFile", filePath: E2E_TUTORIAL_SEED_NOOP };
		}

		// #1087 先読み画像のロード枚数プローブも同じ「解決後の実ファイルパス」で判定する
		if (excludeE2ETutorialHook && resolvedPath === E2E_PRELOAD_PROBE_IMPL) {
			return { type: "sourceFile", filePath: E2E_PRELOAD_PROBE_NOOP };
		}

		// #1272 ルートパラメータのプローブも同じ「解決後の実ファイルパス」で判定する
		if (excludeE2ETutorialHook && resolvedPath === E2E_ROUTE_PARAMS_PROBE_IMPL) {
			return { type: "sourceFile", filePath: E2E_ROUTE_PARAMS_PROBE_NOOP };
		}

		// #1213 候補画像プリロードのプローブも同じ「解決後の実ファイルパス」で判定する
		if (excludeE2ETutorialHook && resolvedPath === E2E_VOTE_IMAGE_PRELOAD_PROBE_IMPL) {
			return { type: "sourceFile", filePath: E2E_VOTE_IMAGE_PRELOAD_PROBE_NOOP };
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
