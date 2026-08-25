import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * #1469 色直書きゲートの実体は `scripts/assert-no-hardcoded-colors.mjs`
 * （`pnpm --filter app-expo assert:no-hardcoded-colors`）。
 *
 * 本来は pr-check.yml の専用 step として最速の位置で走らせたいが、ワーカーの
 * GitHub App には `workflows` 権限が無く `.github/workflows/` を push できない。
 * pr-check.yml が既に実行している jest 経由でも同じ検査が走るよう、ここで包む。
 * 専用 step が入った後もこのテストは残してよい（検査は数百 ms のファイル走査のみで、
 * 二重実行の害は無い。assert-remote-config-defaults と lint の関係と同じ二重防御になる）。
 */
describe("assert:no-hardcoded-colors", () => {
	it("画面ファイルに色の直書きが無い（詳細ログは assert スクリプトを直接実行して見る）", () => {
		const script = path.resolve(__dirname, "../scripts/assert-no-hardcoded-colors.mjs");
		try {
			execFileSync(process.execPath, [script], { encoding: "utf8", stdio: "pipe" });
		} catch (error) {
			const { stdout, stderr } = error as { stdout?: string; stderr?: string };
			throw new Error(`assert-no-hardcoded-colors が失敗:\n${stderr ?? ""}${stdout ?? ""}`);
		}
	});
});
