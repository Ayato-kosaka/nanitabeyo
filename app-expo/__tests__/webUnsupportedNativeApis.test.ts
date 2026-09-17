import fs from "fs";
import path from "path";

/**
 * #1808 **react-native-web で throw する native 専用 API を、素で呼ばないこと。**
 *
 * `findNodeHandle` は RN Web では null を返さず例外を投げる
 * （"findNodeHandle is not supported on web. Use the ref property on the component instead."）。
 * SpotlightTutorial はこれを `setTimeout` の中で呼んでおり、**例外を拾う者が居ないので
 * 未捕捉エラーとして web アプリごと落ちていた**（本番 2026-09-13〜15 に 14 人 / isFatal: true）。
 *
 * ⚠️ 個別のファイルではなく «この形» を縛る。呼び出し箇所が別ファイルへ増えたときに
 * 同じ事故を繰り返さないため。呼ぶ側のファイルは、呼ぶ前に web を除外していること。
 */
const SOURCE_ROOTS = ["app", "features", "components", "hooks", "lib", "contexts"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

const collectSourceFiles = (dir: string): string[] => {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return collectSourceFiles(full);
		if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) return [];
		if (entry.name.includes(".test.")) return [];
		return [full];
	});
};

const root = path.resolve(__dirname, "..");
const sourceFiles = SOURCE_ROOTS.flatMap((dirName) => collectSourceFiles(path.join(root, dirName)));

/** `findNodeHandle(` の呼び出し（import 行は含まない）を持つファイル */
const callers = sourceFiles.filter((file) => /findNodeHandle\s*\(/.test(fs.readFileSync(file, "utf8")));

describe("#1808 web で throw する native 専用 API", () => {
	// 0 件でも緑になる検査は «緑» の意味を持たない。呼び出し箇所が消えたらこのテストごと消すこと。
	it("findNodeHandle の呼び出し箇所を実際に拾えている", () => {
		expect(callers.length).toBeGreaterThan(0);
	});

	it.each(callers.map((file) => [path.relative(root, file), file]))(
		"%s は findNodeHandle を呼ぶ前に web を除外している",
		(_label, file) => {
			const source = fs.readFileSync(file as string, "utf8");
			const callIndex = source.search(/findNodeHandle\s*\(/);
			const guardIndex = source.search(/Platform\.OS\s*===\s*"web"/);

			expect(guardIndex).toBeGreaterThanOrEqual(0);
			expect(guardIndex).toBeLessThan(callIndex);
		},
	);
});
