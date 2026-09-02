/*
#1641 「アプリ内でリールが自動再生される」ことを **その場で見られる形** にするエビデンス撮影。

    node scripts/shoot-embed-autoplay-evidence.mjs <出力先> [shortcode...]

## モックではない

- 開く URL は `app-expo/features/dishMedia/embedUrl.ts` と同じ `/p/{code}/embed/`
- セルの寸法・切り取り位置は `app-expo/features/dishMedia/embedCrop.ts` と同じ計算
- 注入する JS は **`ExternalEmbedPlayer.tsx` の `AUTOPLAY_SCRIPT` をファイルから読み出したもの**
  （ここへ書き写さない。写すと本体と乖離しても気づけない）
- `window.ReactNativeWebView.postMessage` を差し替えて、アプリが受け取るはずの
  報告（playing / no_video）をそのまま拾う

## ⚠️ これは web（Chrome）であって、ネイティブの証明ではない

react-native-webview の実機挙動は Detox の録画でしか裏付けられない（CLAUDE.md）。
この撮影は «実装した注入スクリプトが、実際に映像を動かすか» を早く見るためのもの。
*/
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = process.argv[2] ?? ".";
const CODES = process.argv.slice(3);
const codes = CODES.length > 0 ? CODES : ["CDg3owdFa6W", "DZnIRziT70s"];

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../../app-expo/features/dishMedia/components/ExternalEmbedPlayer.tsx");

/** 本体から注入スクリプトを取り出す（書き写さない） */
function readAutoplayScript() {
	const src = fs.readFileSync(SRC, "utf8");
	const start = src.indexOf("const AUTOPLAY_SCRIPT = `");
	if (start < 0) throw new Error("AUTOPLAY_SCRIPT が見つかりません。本体の書き方が変わっています。");
	const bodyStart = src.indexOf("`", start) + 1;
	const end = src.indexOf("`;", bodyStart);
	if (end < 0) throw new Error("AUTOPLAY_SCRIPT の終端が見つかりません。");
	return src.slice(bodyStart, end);
}

// embedCrop.ts と同じ寸法（iPhone 14 相当のセル）
const CELL_W = 390, CELL_H = 844;
const EMBED_HEADER_RATIO = 17 / 320, EMBED_MEDIA_ASPECT = 1;
const EMBED_FRAME_HEIGHT_RATIO = EMBED_HEADER_RATIO + EMBED_MEDIA_ASPECT + 0.05;
const frameWidth = CELL_W;
const mediaTop = frameWidth * EMBED_HEADER_RATIO;
const mediaHeight = frameWidth * EMBED_MEDIA_ASPECT;
const frameHeight = frameWidth * EMBED_FRAME_HEIGHT_RATIO;

const AUTOPLAY_SCRIPT = readAutoplayScript();
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
	channel: "chrome",
	proxy,
	args: ["--no-sandbox", "--ssl-version-max=tls1.2", "--disable-features=EncryptedClientHello,DnsOverHttps"],
});

const results = [];
for (const code of codes) {
	const ctx = await browser.newContext({
		viewport: { width: CELL_W, height: CELL_H },
		deviceScaleFactor: 2,
		ignoreHTTPSErrors: true,
		recordVideo: { dir: path.join(OUT, `video_${code}`), size: { width: CELL_W, height: CELL_H } },
		userAgent:
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
	});
	const page = await ctx.newPage();

	// アプリが受け取るはずの報告を拾えるようにしてから注入する（WebView の onMessage 相当）
	await page.addInitScript(() => {
		window.__nbMsgs = [];
		window.ReactNativeWebView = { postMessage: (s) => window.__nbMsgs.push(s) };
	});

	// アプリと同じ URL 形（embedUrl.ts）
	await page.goto(`https://www.instagram.com/p/${code}/embed/`, { waitUntil: "domcontentloaded", timeout: 60000 });

	// アプリと同じ «写真だけを切り出してセル全面へ» の見せ方に寄せる（embedCrop.ts）
	await page.addStyleTag({
		content: `html,body{margin:0;background:#000;overflow:hidden}
		body{position:absolute;width:${frameWidth}px;height:${frameHeight}px;top:${(CELL_H - mediaHeight) / 2 - mediaTop}px;left:0}`,
	});

	// ここまで «タップを一切していない»。injectedJavaScript 相当を撃つだけ
	await page.waitForTimeout(2500);
	const before = await page.evaluate(() => {
		const v = document.querySelector("video");
		return { hasVideo: !!v, t: v ? +v.currentTime.toFixed(2) : null, paused: v ? v.paused : null };
	});
	await page.screenshot({ path: path.join(OUT, `${code}_0_before.png`) });

	await page.evaluate(AUTOPLAY_SCRIPT);

	// 1 秒ごとに «時間が進んでいるか» を測りながらコマを撮る
	const samples = [];
	for (let i = 1; i <= 6; i++) {
		await page.waitForTimeout(1000);
		samples.push(
			await page.evaluate(() => {
				const v = document.querySelector("video");
				return v ? { t: +v.currentTime.toFixed(2), paused: v.paused, muted: v.muted } : { t: null };
			}),
		);
		await page.screenshot({ path: path.join(OUT, `${code}_${i}_t${i}s.png`) });
	}
	const msgs = await page.evaluate(() => window.__nbMsgs || []);

	results.push({ code, before, samples, appMessages: msgs });
	console.log(`\n=== ${code} ===`);
	console.log("  注入前      :", JSON.stringify(before));
	console.log("  1秒ごとの位置:", samples.map((s) => s.t).join(" → "));
	console.log("  アプリへの報告:", msgs.join(" | ") || "(なし)");

	await page.close();
	await ctx.close();
}
fs.writeFileSync(path.join(OUT, "autoplay-evidence.json"), JSON.stringify(results, null, 2));
await browser.close();
