// #1629【28】言語を切り替えたあと «戻る» がどこへ行くかを実測する。
//
// オーナー実機報告:
//   日本語 → 英語にすると英語の端末設定画面になるが、そこで戻ると検索画面へ飛ぶ。
//   もう一度プロフィールへ行くと言語選択画面に入り、そこから戻るとまた探すタブへ行くので
//   **プロフィールへ二度と戻れない**。
//
// ⚠️ 一度 `unstable_settings.initialRouteName` を足して «直した» と報告したが、
//    実機で直っていなかった。**憶測で直さず、ここで実際に押して URL を記録する。**
//
// 使い方（e2e-web から）:
//   node ../.claude/skills/evidence-video/scenarios/language-back-1629.mjs
import { record, ok } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "language-back-1629";

/** その時点の URL を «ロケール以降» だけ短く表す */
const routeOf = (page) => {
	const u = new URL(page.url());
	return u.pathname + (u.search || "");
};

const files = await record({
	name: NAME,
	langs: ["ja", "en"],
	mock: (url) => {
		// 言語の保存（POST /v1/users/me）は成功で返す
		if (url.includes("/v1/users/me")) return { body: ok({}) };
		return null;
	},
	flow: async (page, shot) => {
		const trail = [];
		const mark = async (label) => {
			const route = routeOf(page);
			trail.push(`${label}: ${route}`);
			console.log(`  ${label} → ${route}`);
			await shot(label);
		};

		await page.goto("http://localhost:8788/ja-JP/profile", { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(2500);
		await mark("01-profile");

		await page.getByTestId("settings-device-settings").click();
		await page.waitForTimeout(1200);
		await mark("02-device-settings");

		await page.getByTestId("settings-language").click();
		await page.waitForTimeout(1200);
		await mark("03-language");

		// 英語へ切り替える
		await page.getByTestId("language-option-en-US").click();
		await page.waitForTimeout(3000);
		await mark("04-after-switch");

		/*
		ここからが本題。**行き止まりになっていないこと**を確かめる。

		旧実装は `/en-US/profile/language` へ replace していたため、
		戻る → 検索タブ、プロフィールを開き直す → 言語画面、また戻る → 検索タブ、で
		**プロフィールへ二度と戻れなかった**（このシナリオの初回実行で再現済み）。

		新実装はタブの根（`/en-US/profile`）へ着地する。確認するのは 2 点:
		  (1) 切替直後にプロフィールの根に居ること
		  (2) そこから普通に潜って戻れること（行き止まりでないこと）
		*/
		await page.getByTestId("settings-device-settings").click();
		await page.waitForTimeout(1500);
		await mark("05-into-device-settings-again");

		await page.getByTestId("device-settings-header-back").click().catch(async () => {
			await page.getByRole("button").first().click();
		});
		await page.waitForTimeout(1500);
		await mark("06-back-to-profile");

		console.log("\n=== 遷移の記録 ===");
		for (const line of trail) console.log(line);

		const landed = trail.find((l) => l.startsWith("04-after-switch")) ?? "";
		const backTo = trail.find((l) => l.startsWith("06-back-to-profile")) ?? "";
		const landedOnProfileRoot = /:\s*\/[a-z]{2}-[A-Z]{2}\/profile$/.test(landed);
		const canReturn = /\/profile$/.test(backTo);
		console.log(`\n判定 (1) 切替直後にプロフィールの根: ${landedOnProfileRoot ? "✅" : "❌"}`);
		console.log(`判定 (2) 潜って戻れる（行き止まりでない）: ${canReturn ? "✅" : "❌"}`);
	},
});

console.log(files);
