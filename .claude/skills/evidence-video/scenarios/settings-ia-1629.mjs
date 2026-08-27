/*
#1629 マイページと設定の情報設計を作り直した結果のエビデンス（オーナー指示）。

  1. マイページ 1 ブロック目 … いいねした投稿 / 保存した料理カテゴリー / グループ投票の履歴 / ブロック済み
  2. マイページ 2 ブロック目 … なに食べよについて / 端末設定 / 通知設定 / あなたの報告履歴 / アカウント管理
  3. 端末設定 ……………… 言語 / 触覚フィードバック / 表示テーマ（テーマは 1 階層深いページへ）
  4. 表示テーマ …………… 3 択だけの専用ページ（**新設**）
  5. 通知設定 ……………… #1583 の再編で描画されなくなっていたカードを戻した（**新設**）
  6. アカウント管理 ……… ログアウト / アカウント削除を隔離した（**新設**）
  7. なに食べよについて … 応援する / ご意見・不具合

⚠️ «なに食べよ を応援する» は web では出ない（ストアが無いため `Platform.OS !== "web"`）。
   ここで «無い» のは正しい挙動。その行は Detox 側で撮る。

⚠️ 認証・API・地図はモック。映っているのは «画面» であって実データではない。
*/
import { record, writeNote, OUT } from "./harness.mjs";

const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";

/** マイページ 2 ブロック目の並びを «描画順» で確かめる（testID の有無だけでは順番を見られない） */
const EXPECTED_BLOCK2 = [
	"settings-about",
	"settings-device-settings",
	"settings-notifications",
	"settings-content-reports",
	"settings-account",
];

async function shootScheme(scheme) {
	return record({
		name: `settings1629-${scheme}`,
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
			await page.getByTestId("settings-about").waitFor({ state: "visible", timeout: 20000 });

			// «移した» のであって «両方に置いた» のではないことを、撮る前に機械的に確かめる
			for (const gone of ["settings-logout", "settings-delete-account", "settings-feedback", "settings-language"]) {
				if ((await page.getByTestId(gone).count()) > 0) {
					throw new Error(`マイページに «${gone}» が残っている。#1629 は移設であって複製ではない`);
				}
			}

			// 2 ブロック目の並びを描画順で検証する
			const order = [];
			for (const testId of EXPECTED_BLOCK2) {
				const box = await page.getByTestId(testId).first().boundingBox();
				if (!box) throw new Error(`マイページに «${testId}» が無い`);
				order.push({ testId, y: box.y });
			}
			const sorted = [...order].sort((a, b) => a.y - b.y).map((o) => o.testId);
			if (sorted.join(",") !== EXPECTED_BLOCK2.join(",")) {
				throw new Error(`2 ブロック目の並びが指示と違う: ${sorted.join(" → ")}`);
			}

			await page.waitForTimeout(1000);
			await shot("01-profile");

			// ── 2. 端末設定 → 3. 表示テーマ ──
			await page.getByTestId("settings-device-settings").click();
			await page.getByTestId("settings-theme").waitFor({ state: "visible", timeout: 10000 });
			await page.getByTestId("settings-language").waitFor({ state: "visible", timeout: 10000 });
			await page.getByTestId("settings-haptics-toggle").waitFor({ state: "visible", timeout: 10000 });
			// 3 択ラジオはここには無い（1 階層深いページへ移した）
			if ((await page.getByTestId("settings-theme-selector").count()) > 0) {
				throw new Error("端末設定に 3 択ラジオが残っている。#1629 はテーマを専用ページへ移した");
			}
			await page.waitForTimeout(1000);
			await shot("02-device-settings");

			await page.getByTestId("settings-theme").click();
			await page.getByTestId("settings-theme-selector").waitFor({ state: "visible", timeout: 10000 });
			await page.waitForTimeout(1000);
			await shot("03-theme");

			// ── 4. 通知設定（#1583 の再編で落ちていた画面）──
			await page.goto(`${BASE}/ja-JP/profile`, { waitUntil: "domcontentloaded" });
			await page.getByTestId("settings-notifications").waitFor({ state: "visible", timeout: 20000 });
			await page.getByTestId("settings-notifications").click();
			await page.waitForTimeout(1500);
			await shot("04-notifications");

			// ── 5. アカウント管理 ──
			await page.goto(`${BASE}/ja-JP/profile`, { waitUntil: "domcontentloaded" });
			await page.getByTestId("settings-account").waitFor({ state: "visible", timeout: 20000 });
			await page.getByTestId("settings-account").click();
			await page.getByTestId("settings-logout").waitFor({ state: "visible", timeout: 10000 });
			await page.getByTestId("settings-delete-account").waitFor({ state: "visible", timeout: 10000 });
			await page.waitForTimeout(1000);
			await shot("05-account");

			// 行き止まりを作っていないこと
			await page.getByTestId("account-settings-screen-back").click();
			await page.getByTestId("settings-account").waitFor({ state: "visible", timeout: 10000 });

			// ── 6. なに食べよについて ──
			await page.getByTestId("settings-about").click();
			await page.getByTestId("settings-feedback").waitFor({ state: "visible", timeout: 10000 });
			await page.getByTestId("settings-terms").waitFor({ state: "visible", timeout: 10000 });
			await page.waitForTimeout(1000);
			await shot("06-about");
		},
	});
}

const light = await shootScheme("light");
const dark = await shootScheme("dark");

await writeNote("settings1629", [
	"# #1629 マイページと設定の情報設計（オーナー指示の並び）",
	"",
	"- 01-profile … 1 ブロック目 4 行 / 2 ブロック目 5 行。**並びを描画順で機械検証している**",
	"- 02-device-settings … 言語 / 触覚 / 表示テーマ（3 択ラジオはここには無い）",
	"- 03-theme … 表示テーマの専用ページ（**新設**）",
	"- 04-notifications … 通知設定（#1583 の再編で描画されなくなっていたのを戻した。**新設**）",
	"- 05-account … アカウント管理（ログアウト / 削除を隔離。**新設**）",
	"- 06-about … なに食べよについて（ご意見・不具合をここへ移した）",
	"",
	"⚠️ «なに食べよ を応援する» は web では出ない（ストアが無い）。その行は Detox 側で撮る。",
	"⚠️ 認証・API・地図はモック。映っているのは «画面» であって実データではない。",
	"",
	...light.shots.map((p, i) => `- light: ${p}\n  dark : ${dark.shots[i]}`),
]);
console.log("OUT=", OUT);
