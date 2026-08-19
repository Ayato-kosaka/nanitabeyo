import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 🛡️ BlurModal の境界を守る CI ゲート。2 つを検査する。
 *
 * 1. `features/contributionTasks/legacyBlurModal`（#1363 で新設した凍結コピー）が
 *    社内タスク画面の外から import されていないこと（#1363 PR レビュー）
 * 2. #1350 P6 で撤去した `features/blurModal` が復活していないこと
 *
 * 使い方:
 *   pnpm --filter app-expo assert:legacy-blur-modal-boundary
 *
 * ## なぜ必要か（ESLint の `no-restricted-imports` だけでは足りない理由）
 * 同じ境界は `.eslintrc.js` の `no-restricted-imports` でも張っているが、**その lint は CI で
 * 一度も実行されていない**。
 * - `.github/workflows/pr-check.yml` が回すのは remoteConfig キー検査 / error-triage jest /
 *   app-expo typecheck / app-expo jest の 4 つだけで、`pnpm --filter app-expo lint` は含まれない。
 *   他の workflow にも無い。
 * - そのうえ `pnpm --filter app-expo lint` は現状 **48 errors で落ちる**
 *   （`react-hooks/rules-of-hooks` 45 / `no-undef` 3。いずれも #1363 以前からの既存違反で、
 *   `no-restricted-imports` 由来は 0 件）。既存違反の解消は別 Issue なので、
 *   **lint 全体を今すぐ CI に載せることはできない**。
 *
 * つまり lint に任せたままだと、公開アプリから `legacyBlurModal` を import しても CI では誰も
 * 気付かない。凍結の価値は「利用者が社内タスク画面だけに閉じていること」に全面的に依存しており、
 * 1 箇所でも外から import された時点で、共有部品が全画面を人質に取る元の状態（#1350 §7）へ
 * 逆戻りする。この検査は**既存 48 errors とは独立に単体で走る**ので、今日から CI で強制できる。
 *
 * ## 役割分担
 * - **ESLint**: エディタ上で書いた瞬間に赤くする（速いが CI では評価されない）
 * - **このスクリプト**: CI の最後の砦。lint が回っていなくても機械的に落とす
 *
 * ## 検出方法
 * import 指定子の文字列そのものではなく、**解決後の絶対パス**が凍結ディレクトリ配下かどうかで
 * 判定する。`@/` エイリアス経由と相対パス経由の両方を同じ土俵に乗せるためで、
 * `@/features/contributionTasks/legacyBlurModal/...` も
 * `../../features/contributionTasks/legacyBlurModal/...` も等しく捕まえる
 * （片方だけを文字列一致で見ると、もう片方で迂回できてしまう）。
 *
 * ## 既知の限界
 * - 変数に入れた指定子（`import(SOME_PATH)`）は追えない。静的な文字列リテラルだけを見る
 * - 行頭が `//` / `*` の行は「コメント中の言及」として除外する。逆に言えば、コード行の末尾に
 *   書いた行コメント内の記述は違反として拾う（実害は無いが誤検知しうる）
 */

// #1030 と同じ理由で `import.meta.dirname`（Node >= 20.11）は使わない。CI の node-version は
// マイナー未固定の "20" なので、どのバージョンでも動く fileURLToPath を使う
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");

/** 凍結コピーの位置（appRoot からの相対 posix パス） */
const FROZEN_DIR = "features/contributionTasks/legacyBlurModal";

/**
 * #1350 P6 で撤去した公開アプリ側の BlurModal。**復活していないこと**を検査する。
 *
 * 撤去できたのは 31 箇所すべてをルート / DialogProvider / インラインへ移し切ったからで、
 * 1 箇所でも「とりあえず戻す」が入ると、共有オーバーレイが全画面を人質に取る元の状態
 * （#1350 §6 の構造的欠陥）へ逆戻りする。ディレクトリの再出現をここで落とす。
 */
const REMOVED_DIR = "features/blurModal";

/**
 * `legacyBlurModal` を import してよい範囲。`.eslintrc.js` の overrides.files と同じ意味を持たせる。
 *
 * ロケール階層は `[locale]` と直書きしない。app 配下の任意の深さにある contribution-tasks 配下、
 * という条件を正規表現で表し、途中のディレクトリ名（`[locale]` など）に依存しないようにする。
 * `features/contributionTasks/**` を許可しているのは、凍結モジュール自身の内部 import と、
 * 社内タスク用のロジックからの利用を塞がないため。
 */
const ALLOWED_PATTERNS = [/^app\/(.+\/)?contribution-tasks\/.+/, /^features\/contributionTasks\/.+/];

/** 走査しないディレクトリ名。ビルド成果物と依存は対象外 */
const SKIP_DIRS = new Set(["node_modules", ".git", ".expo", "dist", "dist-e2e-check"]);

/**
 * 静的な module 指定子を拾う正規表現。
 * `from "x"` だけだと副作用 import / 動的 import / require / jest.mock を取りこぼす。
 */
const SPECIFIER_PATTERNS = [
	/\bfrom\s*["']([^"']+)["']/g, // import ... from "x" / export ... from "x"
	/\bimport\s*\(\s*["']([^"']+)["']/g, // 動的 import("x")
	/\bimport\s+["']([^"']+)["']/g, // 副作用 import "x"
	/\brequire\s*\(\s*["']([^"']+)["']/g, // require("x")
	/\bjest\.mock\s*\(\s*["']([^"']+)["']/g, // jest.mock("x")
];

/** OS 差を消して比較するため、パス区切りを posix に寄せる */
const toPosix = (value) => value.split(path.sep).join("/");

/** appRoot 配下の .ts / .tsx を再帰的に列挙する */
const collectSources = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) return [];
			return collectSources(path.join(dir, entry.name));
		}
		return /\.tsx?$/.test(entry.name) ? [path.join(dir, entry.name)] : [];
	});

/**
 * import 指定子を絶対パスへ解決する。
 *
 * @param {string} specifier `@/...` / `./...` / `../...` / bare package 名
 * @param {string} fromFile 指定子を書いているファイルの絶対パス
 * @returns {string | undefined} 解決後の絶対パス。解決対象外（bare package）なら undefined
 */
const resolveSpecifier = (specifier, fromFile) => {
	// `@/` は tsconfig の paths エイリアス（app-expo ルート）
	if (specifier.startsWith("@/")) return path.resolve(appRoot, specifier.slice(2));
	if (specifier.startsWith("./") || specifier.startsWith("../")) return path.resolve(path.dirname(fromFile), specifier);
	return undefined;
};

/** 解決後の絶対パスが凍結ディレクトリ自身、またはその配下かどうか */
const frozenDirAbsolute = path.resolve(appRoot, FROZEN_DIR);
const isFrozenModule = (absolute) =>
	absolute === frozenDirAbsolute || absolute.startsWith(frozenDirAbsolute + path.sep);

/** ファイル（appRoot 相対 posix パス）が import を許された範囲にあるか */
const isAllowedImporter = (relativePosix) => ALLOWED_PATTERNS.some((pattern) => pattern.test(relativePosix));

// ── 1. 凍結コピーの存在を確認する（fail-closed）──────────────────────────────
// ⚠️ ここを黙って skip しないこと。ディレクトリが移動・改名されると解決が 1 件も一致せず、
//    「違反 0 件」で緑になる ＝ 何も検査していない CI を緑のチェックマークで隠すことになる。
if (!existsSync(frozenDirAbsolute) || !statSync(frozenDirAbsolute).isDirectory()) {
	console.error(
		[
			`❌ 凍結コピーが見つかりません: ${FROZEN_DIR}`,
			"   移動・改名したのなら、このスクリプトの FROZEN_DIR と .eslintrc.js の",
			"   no-restricted-imports のパターンを追従させてください。",
			"   #1350 P6 で凍結コピーごと撤去したのなら、この検査と package.json の",
			"   assert:legacy-blur-modal-boundary も併せて削除してください。",
		].join("\n"),
	);
	process.exit(1);
}

// ── 1-b. 撤去済みディレクトリが復活していないことを確認する ──────────────────
const removedDirAbsolute = path.resolve(appRoot, REMOVED_DIR);
if (existsSync(removedDirAbsolute)) {
	console.error(
		[
			`❌ 撤去済みの ${REMOVED_DIR} が復活しています。`,
			"   公開アプリのオーバーレイは #1350 で全廃しました。行き先は次の 3 つです:",
			"     - 画面を分ける   … expo-router のルート（app/**）",
			"     - 問い合わせる … DialogProvider の confirm() / showDialog()",
			"     - 同じ画面に出す … インライン描画（#1358 の友達投票が例）",
			"   意図して復活させるのなら、この検査の REMOVED_DIR を外し、",
			"   docs/ux/blur-modal-teardown.md に理由を残してください。",
		].join("\n"),
	);
	process.exit(1);
}

// ── 2. 走査 ──────────────────────────────────────────────────────────────────

const sources = collectSources(appRoot);

// ⚠️ 走査対象 0 件も「何も検査せず緑」なので落とす
if (sources.length === 0) {
	console.error(`❌ ${appRoot} 配下に .ts / .tsx が 1 つもありません（走査条件が壊れている可能性）。`);
	process.exit(1);
}

/** 圏外からの import（違反） */
const offenders = [];
/** 許可範囲からの import（ログ用。件数が 0 に落ちたら凍結コピーが未使用になったということ） */
const allowed = [];

for (const file of sources) {
	const relativePosix = toPosix(path.relative(appRoot, file));
	const contents = readFileSync(file, "utf8");

	// 凍結モジュール自身の import まで拾っても意味が無いが、`features/contributionTasks/**` は
	// 許可範囲なので allowed 側に入るだけで害は無い。特別扱いはしない
	for (const pattern of SPECIFIER_PATTERNS) {
		// 正規表現リテラルは module 内で共有されるので、lastIndex を明示的に戻してから使う
		pattern.lastIndex = 0;
		let match;
		while ((match = pattern.exec(contents)) !== null) {
			const specifier = match[1];
			const resolved = resolveSpecifier(specifier, file);
			if (!resolved || !isFrozenModule(resolved)) continue;

			const line = contents.slice(0, match.index).split("\n").length;
			const lineText = contents.split("\n")[line - 1] ?? "";
			// コメント行での言及は違反にしない（ドキュメントとして経路名を書くことはある）
			const trimmed = lineText.trim();
			if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

			const entry = { file: relativePosix, line, specifier };
			if (isAllowedImporter(relativePosix)) allowed.push(entry);
			else offenders.push(entry);
		}
	}
}

// ── 3. 判定 ──────────────────────────────────────────────────────────────────

if (offenders.length > 0) {
	// 同じ import を複数の正規表現が拾うことはないが、行番号順に並べて読みやすくする
	offenders.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
	console.error(
		[
			`❌ 社内タスク画面の外から legacyBlurModal を import しています（${offenders.length}件）。`,
			"",
			...offenders.map(({ file, line, specifier }) => `  - ${file}:${line} … ${specifier}`),
			"",
			"   legacyBlurModal は社内タスク画面専用の凍結コピーです（#1363）。公開アプリ側の",
			"   features/blurModal は #1350 P6 で撤去済みで、代替はルート / DialogProvider /",
			"   インライン描画です。import してよいのは次の範囲だけです:",
			"     - app/**/contribution-tasks/**",
			"     - features/contributionTasks/**",
		].join("\n"),
	);
	process.exit(1);
}

console.log(
	[
		`✅ legacyBlurModal の import は社内タスク画面に閉じています（走査 ${sources.length} ファイル / 正当な import ${allowed.length} 件）`,
		// 0 件でも必ず出す。「正当な import: 0 件」という行があって初めて、
		// 凍結コピーが誰からも使われなくなったこと（= 撤去できる状態）をログから読み取れる
		...(allowed.length > 0
			? allowed
					.slice()
					.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
					.map(({ file, line }) => `   ・${file}:${line}`)
			: [
					"   ℹ️ 正当な import が 0 件です。凍結コピーが未使用になった可能性があります",
					"      （#1350 P6 で撤去できる状態かどうか確認してください）",
				]),
	].join("\n"),
);
