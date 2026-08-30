/*
#1504 SET-01 端末設定のハプティクス オン/オフ

ライト / ダークの 2 セットで撮る。**目印の testID が実在することを確かめてから撮る**ので、
「画面は開いたが目的の UI が無い」状態の絵を掴まされない。

⚠️ 認証・API・地図はモック。映っているのは «画面» であって実データではない。
*/
import { record, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";
const TARGET = "settings-haptics-toggle";

async function shootScheme(scheme) {
	return record({
		name: `haptics1504-${scheme}`,
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

			await page.goto(`${BASE}/ja-JP/profile/device-settings`, { waitUntil: "domcontentloaded" });
			await page.waitForTimeout(3500);
			await shot("01-screen");

			const target = page.getByTestId(TARGET);
			await target.waitFor({ state: "attached", timeout: 15000 });
			await target.scrollIntoViewIfNeeded().catch(() => {});
			await page.waitForTimeout(700);
			await shot("02-target");

			await target.screenshot({ path: `${OUT}/haptics1504-${scheme}-03-closeup.png` });
			console.log(`[${scheme}] ${TARGET} を撮った`);

		},
	});
}

const light = await shootScheme("light");
const dark = await shootScheme("dark");

await writeNote("haptics1504", [
	"# #1504 SET-01 端末設定のハプティクス オン/オフ",
	"",
	"- 01-screen … 画面を開いた直後",
	"- 02-target … 目的の UI（`settings-haptics-toggle`）までスクロールした状態",
	"- 03-closeup … その UI だけを切り出した拡大",
	"",
	"⚠️ 認証・API・地図はモック。",
	"",
	...light.shots.map((p, i) => `- light: ${p}\n  dark : ${dark.shots[i]}`),
]);
console.log("OUT=", OUT);
