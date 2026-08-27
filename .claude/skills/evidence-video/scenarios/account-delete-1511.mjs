/*
#1511 ACC-01 アプリ内でアカウントを削除する

ライト / ダークの 2 セットで撮る。**目印の testID が実在することを確かめてから撮る**ので、
「画面は開いたが目的の UI が無い」状態の絵を掴まされない。

⚠️ 認証・API・地図はモック。映っているのは «画面» であって実データではない。
*/
import { record, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";
const TARGET = "settings-delete-account";

async function shootScheme(scheme) {
	return record({
		name: `acctdel1511-${scheme}`,
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

			/*
			#1583 でこの行の置き場所が変わった。旧設定画面 `profile/settings` は削除済みで、
			削除行はマイページ（`profile`）のログアウトの直下にある。
			古い URL のままだとこのシナリオは «画面が開かない» で落ちる。
			*/
			await page.goto(`${BASE}/ja-JP/profile`, { waitUntil: "domcontentloaded" });
			await page.waitForTimeout(3500);
			await shot("01-screen");

			const target = page.getByTestId(TARGET);
			await target.waitFor({ state: "attached", timeout: 15000 });
			await target.scrollIntoViewIfNeeded().catch(() => {});
			await page.waitForTimeout(700);
			await shot("02-target");

			await target.screenshot({ path: `${OUT}/acctdel1511-${scheme}-03-closeup.png` });

			/*
			ここからが ACC-01 の本体である。

			導線（メニューに «アカウントを削除» が並んでいる）だけを撮って納品してはいけない。
			この機能の受け入れ条件は「取り消せないことがユーザーに伝わったうえで削除できる」ことで、
			それを担っているのは 2 段階の確認ダイアログ
			（1 枚目 = 何が起きるかの説明 / 2 枚目 = 取り消せないことへの明示的な同意）である。
			マイページ（profile/index.tsx）の handleDeleteAccount がその 2 枚を順に出す。

			**最後まで押し切らない。** 2 枚目はキャンセルで閉じる。
			撮影用のモックとはいえ、削除を完了させる導線を毎回走らせる必要は無い。
			*/
			await target.click();
			await page.waitForTimeout(600);

			const explain = page.getByTestId("dialog-confirm-button");
			await explain.waitFor({ state: "visible", timeout: 10000 });
			await shot("04-confirm-explain");

			await explain.click();
			await page.waitForTimeout(600);

			const final = page.getByTestId("dialog-confirm-button");
			await final.waitFor({ state: "visible", timeout: 10000 });
			await shot("05-confirm-final");

			// 取り消せない同意の «キャンセル» 側で閉じる
			await page.getByTestId("dialog-cancel-button").click();
			await page.waitForTimeout(500);
			await shot("06-cancelled");

			console.log(`[${scheme}] ${TARGET} と確認ダイアログ 2 枚を撮った`);
		},
	});
}

const light = await shootScheme("light");
const dark = await shootScheme("dark");

await writeNote("acctdel1511", [
	"# #1511 ACC-01 アプリ内でアカウントを削除する",
	"",
	"- 01-screen … 画面を開いた直後",
	"- 02-target … 目的の UI（`settings-delete-account`）までスクロールした状態",
	"- 03-closeup … その UI だけを切り出した拡大",
	"- 04-confirm-explain … 1 枚目の確認（何が起きるかの説明）",
	"- 05-confirm-final … 2 枚目の確認（取り消せないことへの明示的な同意）",
	"- 06-cancelled … 2 枚目をキャンセルして閉じた状態（削除は実行していない）",
	"",
	"⚠️ 導線（メニューの行）だけでは受け入れ条件を満たさない。この機能の本体は",
	"「取り消せないことが伝わったうえで削除できる」ことなので、04 と 05 が本命である。",
	"",
	"⚠️ 認証・API・地図はモック。",
	"",
	...light.shots.map((p, i) => `- light: ${p}\n  dark : ${dark.shots[i]}`),
]);
console.log("OUT=", OUT);
