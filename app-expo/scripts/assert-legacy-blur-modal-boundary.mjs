import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 🛡️ BlurModal の境界を守る CI ゲート。3 つを検査する。
 *
 * 1. `features/contributionTasks/legacyBlurModal`（#1363 で新設した凍結コピー）が
 *    社内タスク画面の外から import されていないこと（#1363 PR レビュー）
 * 2. #1350 P6 で撤去した `features/blurModal` が復活していないこと（再出現と import の両方を見る）
 * 3. `react-native-paper` の `Portal` を import してよいのが許可リストの中だけであること
 *
 * ## なぜ 3 が要るのか（jest のガードでは足りない）
 * 各画面には「この画面は Portal を 1 つも描かない」という jest のガードが 9 件ある
 * （`__tests__/loginEntryPoints.test.tsx` ほか）。だがあれが見ているのは **描かれたかどうか** で、
 * オーバーレイの定番の書き方である `{visible && <Portal>…</Portal>}` は
 * 閉じている限り描かれない。#1389 のレビューで実測され、`{false && <Portal/>}` を
 * 設定画面へ足しても 21 件すべて緑のままだった。
 *
 * import は «閉じていても» 書いてある。だから «描画» ではなく «import» を静的に見る。
 * これで「BlurModal を別名で作り直す」経路も塞がる — どんな実装であれ全画面レイヤを
 * 出すには `Portal` が要るためである。
 *
 * 使い方:
 *   pnpm --filter app-expo assert:legacy-blur-modal-boundary
 *
 * ## なぜ必要か（ESLint の `no-restricted-imports` だけでは足りない理由）
 * このスクリプトを書いた時点（#1363）では `.eslintrc.js` の `no-restricted-imports` に同じ境界が
 * ありながら、**その lint が CI で一度も実行されていなかった**（`pnpm --filter app-expo lint` は
 * どの workflow にも無く、そのうえ既存 48 errors で落ちる状態だった）。
 * #1366 で既存違反を解消し、`pnpm --filter app-expo lint` を pr-check.yml へ載せたので、
 * この前提は変わっている。**lint も CI で評価される**。
 *
 * それでもこのスクリプトを残すのは、検査している範囲が ESLint と重ならないためである。
 * - 2（`features/blurModal` が復活していないこと）と 3（`Portal` の import 許可リスト）は
 *   `.eslintrc.js` に対応するルールが無く、ここにしか無い。
 * - 1 は ESLint と重複するが、二重防御として残す。ESLint 側の許可範囲はグロブで書かれており
 *   （`[locale]` の角括弧の件は `.eslintrc.js` のコメント参照）、書き方ひとつで許可範囲が
 *   意図せず広がりうる。こちらは解決後の絶対パスで見るため、同じ間違いをしない。
 *
 * 凍結の価値は「利用者が社内タスク画面だけに閉じていること」に全面的に依存しており、
 * 1 箇所でも外から import された時点で、共有部品が全画面を人質に取る元の状態（#1350 §7）へ
 * 逆戻りする。
 *
 * ## 役割分担
 * - **ESLint**: エディタ上で書いた瞬間に赤くする。#1366 以降は CI でも評価される
 * - **このスクリプト**: CI の最後の砦。ESLint が見ていない 2・3 も含めて機械的に落とす
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
 * `react-native-paper` の `Portal` を import してよいファイル（appRoot 相対 posix パス）。
 *
 * - `app/**​/_layout.tsx` … `Portal.Host` を 1 つだけ置く場所。これがアプリの portal 層そのもの
 * - `contexts/DialogProvider.tsx` … `confirm()` / `showDialog()` の実体。移行先の 1 つ（#1350 §8）
 * - `features/contributionTasks/legacyBlurModal/**` … 社内タスク専用の凍結コピー（#1363）
 *
 * ⚠️ ここへ足すのは «アプリ全体で 1 つだけ持つべき層» を実装するときだけにすること。
 * 画面から足したくなったら、それは #1350 で全廃したオーバーレイを作り直そうとしている。
 */
const PORTAL_ALLOWED = [
	/^app\/(.+\/)?_layout\.tsx$/,
	/^contexts\/DialogProvider\.tsx$/,
	/^features\/contributionTasks\/legacyBlurModal\/.+/,
];

/** `import { A, B } from "react-native-paper"` の名前付き束縛を拾う */
const PAPER_NAMED_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']react-native-paper["']/g;

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

/** 解決後の絶対パスが «撤去済みの» モジュール自身、またはその配下かどうか（拡張子は問わない） */
const removedModuleAbsolute = path.resolve(appRoot, REMOVED_DIR);
const isRemovedModule = (absolute) =>
	absolute === removedModuleAbsolute || absolute.startsWith(removedModuleAbsolute + path.sep);

/** ファイル（appRoot 相対 posix パス）が `Portal` を import してよい範囲にあるか */
const isPortalAllowed = (relativePosix) => PORTAL_ALLOWED.some((pattern) => pattern.test(relativePosix));

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
// ⚠️ 「存在しないこと」の検査は、対象を書き間違えても «常に緑» になる（#1389 のレビュー）。
//    せめて親ディレクトリの実在は確かめて、REMOVED_DIR が丸ごと空振りする事故を落とす。
//    ディレクトリではなくファイル（features/blurModal.tsx）での復活は下の走査が拾い、
//    «別名で作り直す» 経路は Portal の import 検査（3）が受け持つ。
const removedParentAbsolute = path.resolve(appRoot, path.dirname(REMOVED_DIR));
if (!existsSync(removedParentAbsolute)) {
	console.error(
		[
			`❌ REMOVED_DIR の親が見つかりません: ${path.dirname(REMOVED_DIR)}`,
			"   綴りが誤っていると «存在しないこと» の検査は永久に緑になります。",
			"   ディレクトリを移動したのなら REMOVED_DIR を追従させてください。",
		].join("\n"),
	);
	process.exit(1);
}

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
			"   docs/decisions/20260819-blur-modal-teardown.md に理由を残してください。",
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
/** 撤去済みモジュールへの import（違反）。features/blurModal.tsx のような «ファイルでの復活» は
 *  ディレクトリ存在検査では拾えないので、指定子の解決結果でも見る */
const removedImporters = [];
/** 許可リスト外からの `Portal` import（違反） */
const portalOffenders = [];
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
			if (!resolved) continue;

			const frozen = isFrozenModule(resolved);
			const removed = isRemovedModule(resolved);
			if (!frozen && !removed) continue;

			const line = contents.slice(0, match.index).split("\n").length;
			const lineText = contents.split("\n")[line - 1] ?? "";
			// コメント行での言及は違反にしない（ドキュメントとして経路名を書くことはある）
			const trimmed = lineText.trim();
			if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

			const entry = { file: relativePosix, line, specifier };
			if (removed) removedImporters.push(entry);
			else if (isAllowedImporter(relativePosix)) allowed.push(entry);
			else offenders.push(entry);
		}
	}

	// `import { Portal } from "react-native-paper"` を静的に見る。
	// 描画ではなく import を見るので、`{visible && <Portal>…}` のように «閉じている» 実装も捕まる
	PAPER_NAMED_IMPORT.lastIndex = 0;
	let paperMatch;
	while ((paperMatch = PAPER_NAMED_IMPORT.exec(contents)) !== null) {
		const bindings = paperMatch[1]
			.split(",")
			// `Portal as X` は «元の名前» で判定する
			.map((part) => part.trim().split(/\s+as\s+/)[0].trim())
			.filter(Boolean);
		if (!bindings.includes("Portal")) continue;
		if (isPortalAllowed(relativePosix)) continue;

		const line = contents.slice(0, paperMatch.index).split("\n").length;
		portalOffenders.push({ file: relativePosix, line });
	}
}

// ── 3. 判定 ──────────────────────────────────────────────────────────────────

if (removedImporters.length > 0) {
	removedImporters.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
	console.error(
		[
			`❌ 撤去済みの ${REMOVED_DIR} を import しています（${removedImporters.length}件）。`,
			"",
			...removedImporters.map(({ file, line, specifier }) => `  - ${file}:${line} … ${specifier}`),
			"",
			"   ディレクトリではなくファイル（features/blurModal.tsx）で作り直した場合も、ここで落ちます。",
		].join("\n"),
	);
	process.exit(1);
}

if (portalOffenders.length > 0) {
	portalOffenders.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
	console.error(
		[
			`❌ 許可されていない場所から react-native-paper の Portal を import しています（${portalOffenders.length}件）。`,
			"",
			...portalOffenders.map(({ file, line }) => `  - ${file}:${line}`),
			"",
			"   Portal はアプリ全体で 1 つだけ持つ層のための道具です（app/**/_layout.tsx の Portal.Host）。",
			"   画面から使うと #1350 で全廃したオーバーレイを作り直すことになります。行き先は 3 つです:",
			"     - 画面を分ける   … expo-router のルート（app/**）",
			"     - 問い合わせる … DialogProvider の confirm() / showDialog()",
			"     - 同じ画面に出す … インライン描画（#1358 の友達投票が例）",
			"",
			"   ⚠️ jest 側の «Portal を 1 つも描かない» ガード 9 件では、`{visible && <Portal>}` のように",
			"      閉じたまま置かれた Portal は捕まりません（#1389 のレビューで実測）。この検査が最後の砦です。",
		].join("\n"),
	);
	process.exit(1);
}

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
		`✅ BlurModal の境界は保たれています（走査 ${sources.length} ファイル）`,
		`   ・撤去済み ${REMOVED_DIR} … 再出現なし / import 0 件`,
		`   ・react-native-paper の Portal … 許可リスト外からの import 0 件`,
		`   ・legacyBlurModal … 社内タスク画面に閉じている（正当な import ${allowed.length} 件）`,
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
