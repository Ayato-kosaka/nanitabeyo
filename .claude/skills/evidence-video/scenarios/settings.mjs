// 設定画面のエビデンス。SET-* 系（ハプティクス / ダークモード / 言語切替 / 通知設定）と
// バージョン表示のように「設定画面へ行が増える」課題は、これ 1 本で撮れる。
//
// 使い方:
//   EVIDENCE_TARGET_TESTID=settings-haptics-toggle \
//   EVIDENCE_TOGGLE=1 \
//   node .claude/skills/evidence-video/scenarios/settings.mjs
import { BASE, record, writeNote } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "settings";
// 注目したい行の testID。見つからなければその旨を出力に残す（黙って成功しない）
const TARGET = process.env.EVIDENCE_TARGET_TESTID || "";
// トグル行なら 1。押して状態が変わるところまで撮る
const IS_TOGGLE = process.env.EVIDENCE_TOGGLE === "1";

const notes = [];
await record({
	name: NAME,
	flow: async (page, shot) => {
		await page.goto(`${BASE}/ja-JP/profile/settings`, { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(6000);
		await shot("01-open");

		if (!TARGET) {
			notes.push("EVIDENCE_TARGET_TESTID が未指定のため、画面全体だけを撮影した。");
		} else {
			const el = page.getByTestId(TARGET);
			const n = await el.count();
			notes.push(`testID \`${TARGET}\` の一致数: ${n}`);
			if (n === 0) {
				// ここで例外にしない。「見つからなかった」ことも成果物として残す
				notes.push("⚠️ 対象が見つからなかった。ビルドしたブランチが正しいか確認すること。");
			} else {
				await el.scrollIntoViewIfNeeded();
				await page.waitForTimeout(1000);
				await shot("02-target");
				const text = await el.innerText().catch(() => "(テキスト取得不可)");
				notes.push("対象のテキスト: " + JSON.stringify(text));
				if (IS_TOGGLE) {
					await el.click();
					await page.waitForTimeout(1500);
					await shot("03-toggled");
					await el.click();
					await page.waitForTimeout(1500);
					await shot("04-toggled-back");
				}
			}
		}

		// 画面全体をゆっくりスクロールして全項目を映す
		await page.mouse.move(195, 500);
		for (let i = 0; i < 7; i++) {
			await page.mouse.wheel(0, 160);
			await page.waitForTimeout(450);
		}
		await page.waitForTimeout(900);
		await shot("05-scrolled");
	},
});
await writeNote(NAME, [`# ${NAME}`, "", ...notes]);
console.log(notes.join("\n"));
