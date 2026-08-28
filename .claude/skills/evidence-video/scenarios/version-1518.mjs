/*
#1495（PR #1518）バージョン表示のエビデンス。

## なぜ撮り直しているか

オーナー指摘（2026-08-23）を受けて実装が 2 回変わっている:

1. 描画先が `profile/settings.tsx` → **`profile/index.tsx`（マイページ本体）**
   （#1469 で独立した設定画面が廃止されたため）
2. 表示が「バージョン 1.14.0 / ランタイム 1.14・ビルド xxx」の 2 行 →
   **`1.14.0(短縮コミットID)` の 1 行**

PR 本文に貼ってあったエビデンスは **どちらの変更よりも前**のもので、
「撮り直しは今後の対応とする」と書かれたまま放置されていた。これはその撮り直し。

## この撮影が «見せている» こと

- マイページの最下部にバージョンが 1 行で出ていること（旧 2 行形式ではない）
- 形式が `数字.数字.数字(識別子)` であること。**形をコードで検査してから撮る**ので、
  絵と主張がズレない（旧形式のままなら撮影が例外で落ちる）
- ライト / ダークの両方
*/
import { record, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";

/** 新形式。旧形式（「バージョン 1.14.0」の 2 行）だとここで落ちる */
const NEW_FORMAT = /^\d+\.\d+\.\d+\([^)]+\)$/;

async function shootScheme(scheme) {
	return record({
		name: `version1518-${scheme}`,
		contextOptions: { colorScheme: scheme },
		flow: async (page, shot) => {
			await page.addInitScript((s) => {
				try { window.localStorage.setItem("theme_preference_v1", s); } catch {}
			}, scheme);

			await page.goto(`${BASE}/ja-JP/profile`, { waitUntil: "domcontentloaded" });
			await page.waitForTimeout(3000);
			await shot("01-profile-top");

			// バージョンは最下部にあるので、要素まで送ってから撮る
			const version = page.getByTestId("settings-version-section");
			await version.waitFor({ state: "attached", timeout: 15000 });
			await version.scrollIntoViewIfNeeded();
			await page.waitForTimeout(800);
			await shot("02-profile-bottom");

			const text = (await version.textContent())?.trim() ?? "";
			console.log(`[${scheme}] バージョン表示: ${JSON.stringify(text)}`);
			if (!NEW_FORMAT.test(text)) {
				throw new Error(
					`バージョン表示が新形式ではない: ${JSON.stringify(text)}\n` +
						`期待する形: 1.14.0(abc1234) / 1.14.0(dev)\n` +
						`旧形式（「バージョン 1.14.0」＋「ランタイム …・ビルド …」の 2 行）のままなら、` +
						`撮っても PR の主張と絵が食い違う。`,
				);
			}

			// 拡大版。1 行であること・括弧の中身が読めることを絵で確かめられるようにする
			await version.screenshot({ path: `${OUT}/version1518-${scheme}-03-version-closeup.png` });
			console.log(`saved closeup: ${OUT}/version1518-${scheme}-03-version-closeup.png`);
		},
	});
}

const light = await shootScheme("light");
const dark = await shootScheme("dark");

await writeNote("version1518", [
	"# #1495 バージョン表示（撮り直し）",
	"",
	"- 01-profile-top … マイページの最上部",
	"- 02-profile-bottom … バージョン行までスクロールした状態",
	"- 03-version-closeup … バージョン行だけを切り出した拡大",
	"",
	"撮影前に表示形式を正規表現で検査している（旧 2 行形式なら例外で落ちる）ので、",
	"この画像が存在すること自体が «新形式で出ている» ことの証拠になる。",
	"",
	"⚠️ 認証・API・地図はモック。コミット ID が注入されないローカル / CI では `(dev)` と出る。",
	"",
	...light.shots.map((p, i) => `- light: ${p}\n  dark : ${dark.shots[i]}`),
]);
console.log("OUT=", OUT);
