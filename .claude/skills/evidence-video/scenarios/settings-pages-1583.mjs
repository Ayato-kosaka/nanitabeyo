/*
#1583 設定の構成をゼロベースで見直した結果のエビデンス。

オーナー指摘（2026-08-25）:
> 設定画面の構成をゼロベースで見直して欲しい。例えば、
> ・なに食べよについて ・なに食べよ を応援する ・利用規約、、、 ・バージョン番号
> ライトモードダークモードも、端末設定ページにグルーピングするべきなきもする
> （追記）セクションタイトルをつけて欲しいんじゃなくて、ページ遷移をするように

したがって撮るのは **3 画面と、その間の遷移**である。1 画面に見出しを付けた絵ではない。

  1. マイページ ………………… ページへ送る 2 行があり、移した行が残っていないこと
  2. 端末設定 ………………… 表示テーマがここへ移ったこと（**本命**）
  3. なに食べよについて … 規約とバージョンがここに揃ったこと（**本命**）

⚠️ «なに食べよ を応援する» は web では出ない（ストアが無いため `Platform.OS !== "web"`）。
   その行のエビデンスは e2e-mobile（Detox）側で撮る。ここで «無い» のは正しい挙動。

⚠️ 認証・API・地図はモック。映っているのは «画面» であって実データではない。
*/
import { record, ok, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";

async function shootScheme(scheme) {
	return record({
		name: `settings1583-${scheme}`,
		contextOptions: { colorScheme: scheme },
		flow: async (page, shot) => {
			await page.addInitScript((s) => {
				try { window.localStorage.setItem("theme_preference_v1", s); } catch {}
				for (const k of [
					"search_tutorial_seen_v1",
					"topics_spotlight_tutorial_seen_v1",
					"my_dishes_spotlight_tutorial_seen_v1",
				]) {
					try { window.localStorage.setItem(k, "true"); } catch {}
				}
			}, scheme);

			// ── 1. マイページ ──
			await page.goto(`${BASE}/ja-JP/profile`, { waitUntil: "domcontentloaded" });
			await page.getByTestId("settings-device-settings").waitFor({ state: "visible", timeout: 20000 });
			await page.getByTestId("settings-about").waitFor({ state: "visible", timeout: 10000 });

			/*
			«移した» のであって «両方に置いた» のではないことを、撮る前に機械的に確かめる。
			マイページに規約やテーマが残っていると、割ったのに導線が二重化した状態になる。
			*/
			for (const gone of ["settings-terms", "settings-privacy", "settings-theme-selector", "settings-version-section"]) {
				if ((await page.getByTestId(gone).count()) > 0) {
					throw new Error(`マイページに «${gone}» が残っている。#1583 は移設であって複製ではない`);
				}
			}

			await page.getByTestId("settings-about").scrollIntoViewIfNeeded().catch(() => {});
			await page.waitForTimeout(1200);
			await shot("01-profile");

			// ── 2. 端末設定（行をタップして遷移する。URL 直打ちでは «導線» の証拠にならない）──
			await page.getByTestId("settings-device-settings").click();
			await page.getByTestId("settings-theme-selector").waitFor({ state: "visible", timeout: 10000 });
			if (!page.url().includes("/profile/device-settings")) {
				throw new Error(`端末設定へ遷移していない: ${page.url()}`);
			}
			// #1504 のハプティクスと同居していること（テーマだけの画面にすり替えていない）
			await page.getByTestId("settings-haptics-toggle").waitFor({ state: "visible", timeout: 10000 });
			await page.waitForTimeout(1200);
			await shot("02-device-settings");

			// ── 3. なに食べよについて ──
			await page.goto(`${BASE}/ja-JP/profile`, { waitUntil: "domcontentloaded" });
			await page.getByTestId("settings-about").waitFor({ state: "visible", timeout: 20000 });
			await page.getByTestId("settings-about").click();
			await page.getByTestId("settings-terms").waitFor({ state: "visible", timeout: 10000 });
			if (!page.url().includes("/profile/about")) {
				throw new Error(`なに食べよについてへ遷移していない: ${page.url()}`);
			}

			const version = page.getByTestId("settings-version-section");
			await version.waitFor({ state: "visible", timeout: 10000 });
			const versionText = (await version.innerText()).replace(/\s+/g, " ").trim();
			if (!/^\d+\.\d+\.\d+\([^)]+\)$/.test(versionText)) {
				throw new Error(`バージョン行の形が違う: ${JSON.stringify(versionText)}`);
			}
			await page.waitForTimeout(1200);
			await shot("03-about");

			// ── 4. 戻る（行き止まりを作っていないこと）──
			// 1 画面を 3 画面へ割った以上、**帰ってこられること**まで撮らないと通し確認にならない。
			// ScreenHeader は素の testID ではなく `${testID}-back` を出す。
			await page.getByTestId("about-screen-back").click();
			await page.getByTestId("settings-about").waitFor({ state: "visible", timeout: 10000 });
			const backPath = new URL(page.url()).pathname.replace(/\/$/, "");
			if (!backPath.endsWith("/ja-JP/profile")) {
				throw new Error(`«なに食べよについて» の戻るでマイページへ帰っていない: ${page.url()}`);
			}
			await page.waitForTimeout(800);
			await shot("04-back-to-profile");
		},
	});
}

const light = await shootScheme("light");
const dark = await shootScheme("dark");

await writeNote("settings1583", [
	"# #1583 設定の構成をゼロベースで見直す（ページ遷移にする）",
	"",
	"マイページ → 端末設定 / なに食べよについて の **ページ遷移**にした（オーナー指示）。",
	"",
	"- 01-profile … マイページ。ページへ送る 2 行があり、移した行は残っていない",
	"- 02-device-settings … 端末設定。表示テーマがここへ移った（#1504 のハプティクスと同居。**本命**）",
	"- 03-about … なに食べよについて。規約 4 行とバージョン（**本命**）",
	"- 04-back-to-profile … «なに食べよについて» の戻るでマイページへ帰れること（行き止まりでない）",
	"",
	"⚠️ «なに食べよ を応援する» は web では出ない（ストアが無い）。その行は Detox 側で撮る。",
	"",
	"⚠️ 認証・API・地図はモック。映っているのは «画面» であって実データではない。",
	"",
	...light.shots.map((p, i) => `- light: ${p}\n  dark : ${dark.shots[i]}`),
]);
console.log("OUT=", OUT);
