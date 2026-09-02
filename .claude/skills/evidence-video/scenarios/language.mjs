// #1508 / PR #1527 アプリ内言語切替のエビデンス。
// 選択肢には 简体中文 / 한국어 / हिन्दी が並ぶので、CJK・デーヴァナーガリーの
// フォントが無い環境で撮ると豆腐になる。harness の assertFontsFor がそれを先に落とす。
import { BASE, OUT, record, writeNote } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "set06-language";

// 切り替えて回る言語。ar-SA は RTL 未対応のため選択肢に出ない（オーナー承認済み）
const STEPS = [
	{ key: "en-US", label: "English" },
	{ key: "zh-CN", label: "简体中文" },
	{ key: "ko-KR", label: "한국어" },
	{ key: "hi-IN", label: "हिन्दी" },
	{ key: "ja-JP", label: "日本語" },
];

const notes = [];

await record({
	name: NAME,
	langs: ["ja", "zh", "ko", "hi"],
	flow: async (page, shot) => {
		await page.goto(`${BASE}/ja-JP/profile/settings`, { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(8000);
		await shot("01-settings");
		notes.push("1. 設定画面。「言語」の行がある。");

		const entry = page.getByTestId("settings-language");
		if (!(await entry.count())) {
			notes.push("⚠️ settings-language が見つからなかった。以降は撮れていない。");
			return;
		}
		await entry.scrollIntoViewIfNeeded();
		await entry.click();
		await page.waitForTimeout(2500);
		await shot("02-language-list");

		// 選択肢に何が並んでいるかを数字で残す（見た目の主張と突き合わせるため）
		const shown = [];
		for (const s of [...STEPS, { key: "ar-SA", label: "العربية" }, { key: "fr-FR", label: "Français" }, { key: "es-ES", label: "Español" }]) {
			const n = await page.getByTestId(`language-option-${s.key}`).count();
			shown.push(`${s.key}=${n}`);
		}
		notes.push(`2. 言語一覧。選択肢の有無: ${shown.join(", ")}`);
		notes.push("   ar-SA=0 は RTL 未対応のため意図的に選択肢から外している（オーナー承認済み）。");

		let i = 3;
		for (const s of STEPS) {
			const opt = page.getByTestId(`language-option-${s.key}`);
			if (!(await opt.count())) {
				notes.push(`⚠️ ${s.key} の選択肢が無く、切り替えを撮れなかった。`);
				continue;
			}
			await opt.scrollIntoViewIfNeeded();
			await opt.click();
			await page.waitForTimeout(3500);
			await shot(`${String(i).padStart(2, "0")}-after-${s.key}`);
			notes.push(`${i - 1}. ${s.label} (${s.key}) を選んだ直後の画面。`);
			i += 1;

			// 一覧へ戻る（切り替え後は設定画面に居ることがある）
			if (!(await page.getByTestId("language-header").count())) {
				const back = page.getByTestId("settings-language");
				if (await back.count()) {
					await back.click();
					await page.waitForTimeout(2500);
				}
			}
		}
	},
});

await writeNote(NAME, notes);
console.log(notes.join("\n"));
