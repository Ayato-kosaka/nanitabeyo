import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 🛡️ #1469 画面ファイルの «色の直書き» を落とす CI ゲート。
 *
 * ## なぜ必要か
 * #1509 でセマンティックパレット（constants/Palette.ts）とテーマ API
 * （contexts/ThemeProvider.tsx の useThemedStyles / useAppTheme）を整備したのに、
 * その後の #1469 で追加された画面 55 ファイルが色を直書きし、ダークモードで
 * 「ヘッダーだけ黒く本体は真っ白」という画面が量産された（オーナー実測）。
 * lint にも jest にも «色の直書き» を見る仕組みが無かったため、誰も気づかずに
 * マージまで通ってしまった。このスクリプトが最後の砦になる。
 *
 * ## 何を検査するか
 * 画面・コンポーネントの .tsx にある **引用符内の色リテラル**
 * （`"#RRGGBB"` 等の hex と `"white"` / `"black"`）を違反として数える。
 * - 引用符の中だけを見るのは、コメントの Issue 参照（`// #1375 【設計】…`）を
 *   色と誤認しないため。3〜4 桁の hex（#644 等）と Issue 番号は正規表現では
 *   区別できないが、色は必ず引用符の中に書かれる
 * - `rgba(...)` は対象外。半透明のオーバーレイ（メディア上のスクリム等）は
 *   テーマに依らないものが大半で、機械的に落とすと誤検知が理由の除外が増える
 *
 * ## 色をどう書くべきか（違反したときの行き先）
 * - テーマで変わる色 … `constants/Palette.ts` のトークンを
 *   `useThemedStyles(createStyles)` / `useAppTheme().colors` 経由で使う
 *   （作法は contexts/ThemeProvider.tsx の JSDoc）
 * - テーマに依らず固定でよい色（写真・動画の上の白文字等）… `FixedColors` を使い、
 *   なぜ固定でよいのかをコメントに書く
 * - どちらにも無い色 … Palette へトークンを追加する（light / dark 両方の値と根拠
 *   コメント必須。dark は constants/MaterialColor.ts の schemes.dark に合わせる）
 *
 * ## 除外リスト（EXCLUSIONS）の思想
 * #1509 時点でトークン化が済んでいないレガシー画面は、ここで «理由付きで» 凍結する
 * （__tests__/publicRoutes.test.ts の DEEP_LINK_SMOKE_EXCLUSIONS と同じ思想）。
 * - 理由の無い除外はこのスクリプト自身が落とす
 * - 除外したファイルから直書きが消えたら «リストから消せ» と落とす（ラチェット。
 *   リストは減る方向にしか動けず、「除外に入れたまま放置」を許さない）
 * - 除外したファイルが消えた・改名されたときも落とす（対象を書き間違えた除外は
 *   永久に緑になるため。assert-legacy-blur-modal-boundary.mjs の fail-closed と同じ）
 *
 * 使い方:
 *   pnpm --filter app-expo assert:no-hardcoded-colors
 */

// #1030 と同じ理由で `import.meta.dirname`（Node >= 20.11）は使わない
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");

/** 走査するディレクトリ（appRoot 相対）。画面・コンポーネントの .tsx が居る場所すべて */
const SCAN_DIRS = ["app", "features", "components", "contexts", "hooks", "lib"];

/** 走査しないディレクトリ名。ビルド成果物・依存・テストは対象外 */
const SKIP_DIRS = new Set(["node_modules", ".git", ".expo", "dist", "dist-e2e-check", "__tests__", "__mocks__"]);

/**
 * 引用符内の色リテラル。
 * - hex: `"#fff"` 〜 `"#RRGGBBAA"`（3〜8 桁）。引用符直後の `#` だけを見るので、
 *   コメントや文字列中の Issue 参照（`#1375`）は拾わない
 * - 名前色: `"white"` / `"black"` のみ。他の名前色（"orange" 等）は現状の実装に
 *   数件しか無く、まず hex と white/black を塞ぐ（増やすときはこの正規表現へ足す）
 */
const COLOR_LITERAL = /["'`]#[0-9a-fA-F]{3,8}\b|["'`](?:white|black)["'`]/g;

/**
 * トークン化が済んでいないレガシー画面の凍結リスト（appRoot 相対 posix パス → 理由）。
 *
 * ⚠️ ここへ新しい画面を足してはいけない。新規・改修する画面は Palette / FixedColors を
 *    使うこと。足してよいのは「main 側に既に在る直書きを、別 Issue で追従する」場合だけで、
 *    そのときも理由に Issue 番号を書くこと。
 * ⚠️ 直書きを解消したら、その行を消すこと（残すとこのスクリプトが落ちる）。
 */
const EXCLUSIONS = {
	"app/[locale]/contribution-tasks/dish-category-image-optimizer.tsx":
		"社内タスク画面（#1363 で公開アプリから隔離済み）。main 由来の直書きで、公開画面のテーマ追従（#1469）のスコープ外",
	"app/[locale]/contribution-tasks/dish-category-image-review.tsx":
		"社内タスク画面（#1363 で公開アプリから隔離済み）。main 由来の直書きで、公開画面のテーマ追従（#1469）のスコープ外",
	"app/[locale]/contribution-tasks/dish-category-manual-image-supply.tsx":
		"社内タスク画面（#1363 で公開アプリから隔離済み）。main 由来の直書きで、公開画面のテーマ追従（#1469）のスコープ外",
	"app/[locale]/contribution-tasks/dish-category-manual-text-supply.tsx":
		"社内タスク画面（#1363 で公開アプリから隔離済み）。main 由来の直書きで、公開画面のテーマ追従（#1469）のスコープ外",
	"app/[locale]/contribution-tasks/dish-copy-survey.tsx":
		"社内タスク画面（#1363 で公開アプリから隔離済み）。main 由来の直書きで、公開画面のテーマ追従（#1469）のスコープ外",
	"app/[locale]/contribution-tasks/dish-ranking-summary.tsx":
		"社内タスク画面（#1363 で公開アプリから隔離済み）。main 由来の直書きで、公開画面のテーマ追従（#1469）のスコープ外",
	"features/contributionTasks/legacyBlurModal/useLegacyBlurModal.tsx":
		"社内タスク画面（#1363 で公開アプリから隔離済み）。main 由来の直書きで、公開画面のテーマ追従（#1469）のスコープ外",
};

/** 除外理由の最低文字数。「TODO」や空文字で通り抜けられないようにする */
const MIN_REASON_LENGTH = 20;

/** OS 差を消して比較するため、パス区切りを posix に寄せる */
const toPosix = (value) => value.split(path.sep).join("/");

/** dir 配下の .tsx を再帰的に列挙する（テストファイルは除外） */
const collectSources = (dir) => {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) return [];
			return collectSources(path.join(dir, entry.name));
		}
		if (!entry.name.endsWith(".tsx")) return [];
		if (entry.name.endsWith(".test.tsx")) return [];
		return [path.join(dir, entry.name)];
	});
};

/**
 * 1 ファイル分の違反（引用符内の色リテラル）を数える。
 * コメント行（`//` / `*` / `{/*` 始まり）は除外する。コード行の末尾コメントに
 * 引用符付きで色を書けば拾ってしまうが、そう書く動機が無いので許容する。
 */
const findViolations = (contents) => {
	const violations = [];
	const lines = contents.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("{/*")) continue;
		COLOR_LITERAL.lastIndex = 0;
		let match;
		while ((match = COLOR_LITERAL.exec(lines[i])) !== null) {
			violations.push({ line: i + 1, literal: match[0] });
		}
	}
	return violations;
};

// ── 1. 除外リスト自体の検査（fail-closed）────────────────────────────────────

const exclusionErrors = [];
for (const [relative, reason] of Object.entries(EXCLUSIONS)) {
	if (typeof reason !== "string" || reason.trim().length < MIN_REASON_LENGTH) {
		exclusionErrors.push(
			`  - ${relative} … 理由が短すぎます（${MIN_REASON_LENGTH} 文字以上で、なぜ残っているかを書く）`,
		);
	}
	if (!existsSync(path.resolve(appRoot, relative))) {
		exclusionErrors.push(`  - ${relative} … ファイルが存在しません（消した・改名したのならこの行も消す）`);
	}
}
if (exclusionErrors.length > 0) {
	console.error(["❌ EXCLUSIONS（除外リスト）が壊れています。", "", ...exclusionErrors].join("\n"));
	process.exit(1);
}

// ── 2. 走査 ──────────────────────────────────────────────────────────────────

const sources = SCAN_DIRS.flatMap((dir) => collectSources(path.resolve(appRoot, dir)));

// ⚠️ 走査対象 0 件は「何も検査せず緑」なので落とす
if (sources.length === 0) {
	console.error(`❌ ${SCAN_DIRS.join(", ")} 配下に .tsx が 1 つもありません（走査条件が壊れている可能性）。`);
	process.exit(1);
}

/** 除外リストに載っていないファイルの違反（本命） */
const offenders = [];
/** 除外リストに載っているのに違反が 0 件になったファイル（ラチェット） */
const staleExclusions = [];

for (const file of sources) {
	const relativePosix = toPosix(path.relative(appRoot, file));
	const violations = findViolations(readFileSync(file, "utf8"));
	const excluded = Object.prototype.hasOwnProperty.call(EXCLUSIONS, relativePosix);
	if (excluded && violations.length === 0) staleExclusions.push(relativePosix);
	if (!excluded && violations.length > 0) offenders.push({ file: relativePosix, violations });
}

// ── 3. 判定 ──────────────────────────────────────────────────────────────────

if (staleExclusions.length > 0) {
	console.error(
		[
			`❌ 除外リストのファイルから直書きが消えています（${staleExclusions.length}件）。EXCLUSIONS から行を消してください。`,
			"   （リストは減る方向にしか動かさない。残すと「除外に入れたまま新しい直書きを足す」事故を許す）",
			"",
			...staleExclusions.map((file) => `  - ${file}`),
		].join("\n"),
	);
	process.exit(1);
}

if (offenders.length > 0) {
	offenders.sort((a, b) => a.file.localeCompare(b.file));
	const total = offenders.reduce((sum, o) => sum + o.violations.length, 0);
	console.error(
		[
			`❌ 画面ファイルに色の直書きがあります（${offenders.length} ファイル / ${total} 箇所）。`,
			"",
			...offenders.flatMap(({ file, violations }) => [
				`  ${file}`,
				...violations.slice(0, 5).map(({ line, literal }) => `    - L${line} … ${literal}`),
				...(violations.length > 5 ? [`    - …ほか ${violations.length - 5} 箇所`] : []),
			]),
			"",
			"   色は constants/Palette.ts のトークンを useThemedStyles / useAppTheme 経由で使ってください",
			"   （作法は contexts/ThemeProvider.tsx の JSDoc）。テーマに依らず固定でよい色は",
			"   FixedColors を使い、なぜ固定でよいのかをコメントに書きます。どちらにも無い色は",
			"   Palette へトークンを追加します（light / dark 両方の値と根拠コメント必須）。",
			"   #1469 のように直書きのままマージすると、ダークモードで «ヘッダーだけ黒く本体は白い»",
			"   画面になります。除外リスト（EXCLUSIONS）へ足すのは main 由来のレガシーだけです。",
		].join("\n"),
	);
	process.exit(1);
}

console.log(
	[
		`✅ 画面ファイルに色の直書きはありません（走査 ${sources.length} ファイル）`,
		`   ・理由付きで凍結中のレガシー … ${Object.keys(EXCLUSIONS).length} ファイル（減る方向にのみ動く）`,
	].join("\n"),
);
