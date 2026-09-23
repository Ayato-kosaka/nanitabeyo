/**
 * #1947 «ユーザーが再生できなかった» を error-triage へ届かせる。
 *
 * error-triage は本番ログを `error_level = 'error'` でしか拾わない
 * (`.claude/skills/error-triage/FORENSICS.md`)。ExternalEmbedPlayer の失敗イベントは
 * 10 種すべて `warn` で出ていたため、**ユーザーが投稿を再生できなくても Issue が
 * 1 件も立たない**状態だった（2026-09-23 に本番ログで確認。直近 7 日で
 * `external_embed_*` は 0 件＝まだ本番へ出ていないので実害は未発生）。
 *
 * ⚠️ **全部を error にしない。** 劣化（slow_start）や正常な操作（paused）まで上げると
 * 失敗との区別が消え、error-triage が読まれなくなる。上げるのは **終端の失敗** だけ:
 *
 * - `external_embed_unplayable` … 畳んで «Instagram で見る» に落ちた＝再生できなかった
 * - `external_embed_render_process_gone` … WebView のレンダラが死んだ
 *
 * `external_embed_open_browser_failed` は **元から `error`** だった（外部ブラウザすら
 * 開けず、ユーザーに残る手段が無い）。ここで下げない。
 *
 * `external_embed_load_error` は直後に `retryLoad()` するので **終端ではない**。
 * 再試行しても駄目なら `unplayable` として出るので、そちらで拾える。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE = readFileSync(
	path.join(__dirname, "components", "ExternalEmbedPlayer.tsx"),
	"utf8",
);

/** `event_name: "x"` の直後に書かれている error_level を全部拾う。 */
function levelsOf(eventName: string): string[] {
	const re = new RegExp(
		`event_name: "${eventName}",\\s*\\n\\s*error_level: "(\\w+)"`,
		"g",
	);
	return [...SOURCE.matchAll(re)].map((m) => m[1]);
}

describe("外部埋め込みの失敗が error-triage に届くこと", () => {
	it.each(["external_embed_unplayable", "external_embed_render_process_gone"])(
		"%s は error（ユーザーが再生できなかった終端状態）",
		(name) => {
			const levels = levelsOf(name);
			expect(levels.length).toBeGreaterThan(0);
			expect(levels.every((l) => l === "error")).toBe(true);
		},
	);

	it("load_error は warn のまま（直後に retryLoad するので終端ではない）", () => {
		const levels = levelsOf("external_embed_load_error");
		expect(levels.length).toBeGreaterThan(0);
		expect(levels.every((l) => l === "warn")).toBe(true);
	});

	it.each([
		"external_embed_slow_start",
		"external_embed_load_retry",
		"external_embed_paused",
		"external_embed_deactivated_while_playing",
	])("%s は warn のまま（劣化・正常な操作であって失敗ではない）", (name) => {
		const levels = levelsOf(name);
		expect(levels.length).toBeGreaterThan(0);
		expect(levels.every((l) => l === "warn")).toBe(true);
	});

	it("error は終端の失敗だけ（全部上げると劣化と失敗の区別が消える）", () => {
		const errors = [
			...SOURCE.matchAll(
				/event_name: "(external_embed_\w+)",\s*\n\s*error_level: "error"/g,
			),
		].map((m) => m[1]);
		expect(new Set(errors)).toEqual(
			new Set([
				"external_embed_unplayable",
				"external_embed_render_process_gone",
				// #1947 これは元から error だった。«Instagram で見る» の外部ブラウザすら
				// 開けなかった＝ユーザーに残る手段が無い、正真正銘の終端である。
				"external_embed_open_browser_failed",
			]),
		);
	});
});
