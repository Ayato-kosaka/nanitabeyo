/*
#1577 確認ダイアログのダークモード追従

**この撮影の目的は «ライトとダークで別物になっていること» を示すことである。**
修正前は DialogProvider が色を直書きしていたため、暗い画面の上に白いダイアログが浮いていた。
light と dark のコマが md5 まで一致するなら、修正は効いていない。

ダイアログの入口はマイページの「ログアウト」（testID: settings-logout）。
**最後まで押し切らない**（キャンセルで閉じる）。ログアウトさせる必要は無い。

⚠️ 認証・API・地図はモック。映っているのは «画面» であって実データではない。
*/
import { record, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";
const TRIGGER = "settings-logout";
const CONFIRM = "dialog-confirm-button";
const CANCEL = "dialog-cancel-button";

async function shootScheme(scheme) {
	return record({
		name: `dialog1577-${scheme}`,
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

			await page.goto(`${BASE}/ja-JP/profile`, { waitUntil: "domcontentloaded" });
			await page.waitForTimeout(3500);
			await shot("01-screen");

			const trigger = page.getByTestId(TRIGGER);
			await trigger.waitFor({ state: "attached", timeout: 15000 });
			await trigger.scrollIntoViewIfNeeded().catch(() => {});
			await page.waitForTimeout(600);
			await shot("02-trigger");

			// ダイアログを開く。開かなければ撮る意味が無いので落とす
			await trigger.click();
			const confirm = page.getByTestId(CONFIRM);
			await confirm.waitFor({ state: "visible", timeout: 10000 });
			await page.waitForTimeout(500);
			await shot("03-dialog");

			// 押し切らずキャンセルで閉じる
			await page.getByTestId(CANCEL).click();
			await page.waitForTimeout(500);
			await shot("04-cancelled");

			console.log(`[${scheme}] 確認ダイアログを撮った`);
		},
	});
}

const light = await shootScheme("light");
const dark = await shootScheme("dark");

await writeNote("dialog1577", [
	"# #1577 確認ダイアログのダークモード追従",
	"",
	"- 01-screen … マイページを開いた直後",
	"- 02-trigger … ログアウト行までスクロールした状態",
	"- 03-dialog … 確認ダイアログが開いた状態（**本命**）",
	"- 04-cancelled … キャンセルで閉じた状態（ログアウトはしていない）",
	"",
	"⚠️ 03 の light と dark が md5 まで一致するなら、テーマ未追従のままである。",
	"",
	"⚠️ 認証・API・地図はモック。",
	"",
	...light.shots.map((p, i) => `- light: ${p}\n  dark : ${dark.shots[i]}`),
]);
console.log("OUT=", OUT);
