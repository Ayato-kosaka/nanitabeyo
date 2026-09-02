/*
#1641 「埋め込みの中で映像が実際に動き出すか」を機械で判定する。

    node scripts/measure-embed-autoplay.mjs <出力先> <shortcode>...

判定は «paused が false» ではなく **`currentTime` が実際に進んだか** で行う。
止まったまま paused=false になる状態を «再生できた» と誤判定しないため。

## ⚠️ Playwright 同梱の Chromium で判定してはいけない

同梱 Chromium は **H.264/AAC のデコーダが無く**
`MEDIA_ERR_SRC_NOT_SUPPORTED` になる（MP4 の取得自体は 206 で成功しているのに再生できない）。
**Instagram の挙動ではなく道具の欠陥**であり、実際にこれで «再生できない» と誤結論した。
必ず以下の 2 エンジンで測ること。

- chrome : 実 Google Chrome（proprietary codec あり）= Android WebView 相当
- webkit : Playwright の WebKit = iOS の WKWebView 相当

文脈も 2 つに分ける。
- TOP   : 埋め込みページをトップレベルで開く = react-native-webview
          同一オリジンなので injectJavaScript 相当の JS が効く
- FRAME : ローカル HTML に iframe で埋める = web。クロスオリジンで中は触れない
*/
import { chromium, webkit } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const OUT = process.argv[2];
const CODES = process.argv.slice(3);
const CELL_W = 390, CELL_H = 844;
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
const embedUrl = (c) => `https://www.instagram.com/reel/${c}/embed/captioned/`;
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
	const code = req.url.slice(1);
	res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	res.end(`<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#000}
	.cell{position:relative;width:${CELL_W}px;height:${CELL_H}px;overflow:hidden;background:#000}
	iframe{position:absolute;border:0;left:0;top:${(CELL_H - CELL_W * 1.103) / 2}px;width:${CELL_W}px;height:${CELL_W * 1.103}px}
	</style><div class=cell><iframe src="${embedUrl(code)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// ページ文脈で «実際に時間が進んでいるか» を測る。paused だけでは «止まったまま» を見逃す
const measure = async () => {
	const v = document.querySelector("video");
	if (!v) return { hasVideo: false };
	const t0 = v.currentTime;
	await new Promise((r) => setTimeout(r, 2500));
	return {
		hasVideo: true, paused: v.paused, muted: v.muted, readyState: v.readyState,
		networkState: v.networkState, t0: +t0.toFixed(2), t1: +v.currentTime.toFixed(2),
		advanced: +(v.currentTime - t0).toFixed(2), duration: v.duration,
		error: v.error ? v.error.code : null,
	};
};

const results = [];
for (const [engineName, engine, launchOpts] of [
	["chrome", chromium, { channel: "chrome" }],
	["webkit", webkit, {}],
]) {
	let browser;
	try {
		// ⚠️ このサンドボックスのプロキシは TLS 1.3 で切る。chromium 系は必ずこの 3 つが要る
		const args = engineName === "chrome"
			? ["--no-sandbox", "--ssl-version-max=tls1.2", "--disable-features=EncryptedClientHello,DnsOverHttps"]
			: undefined;
		browser = await engine.launch({ proxy, args, ...launchOpts });
	} catch (e) { console.log(`⚠️ ${engineName} 起動失敗: ${String(e).slice(0, 160)}`); continue; }

	for (const code of CODES) {
		const dir = path.join(OUT, `${engineName}_${code}`);
		const ctx = await browser.newContext({
			viewport: { width: CELL_W, height: CELL_H }, deviceScaleFactor: 2, ignoreHTTPSErrors: true,
			recordVideo: { dir, size: { width: CELL_W, height: CELL_H } },
			userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
		});
		const row = { engine: engineName, code };

		// --- TOP（WebView 相当）---
		const top = await ctx.newPage();
		await top.goto(embedUrl(code), { waitUntil: "domcontentloaded", timeout: 60000 });
		await top.waitForTimeout(9000);
		row.untouched = await top.evaluate(measure);                      // 触らずに勝手に動くか
		await top.screenshot({ path: path.join(OUT, `${engineName}_${code}_TOP_1_untouched.png`) });

		// injectJavaScript 相当（ユーザー操作なしで muted 再生を要求）
		row.inject = await top.evaluate(async () => {
			const v = document.querySelector("video");
			if (!v) return { ok: false, reason: "no video" };
			v.muted = true; v.loop = true; v.playsInline = true;
			try { await v.play(); return { ok: true }; } catch (e) { return { ok: false, err: String(e).slice(0, 120) }; }
		});
		row.afterInject = await top.evaluate(measure);
		await top.screenshot({ path: path.join(OUT, `${engineName}_${code}_TOP_2_afterInject.png`) });
		await top.waitForTimeout(4000);
		row.afterInject5s = await top.evaluate(measure);
		await top.screenshot({ path: path.join(OUT, `${engineName}_${code}_TOP_3_playing.png`) });
		await top.close();

		// --- FRAME（web の iframe 相当。中は触れない。目で見るだけ）---
		const fr = await ctx.newPage();
		await fr.goto(`${base}/${code}`, { waitUntil: "domcontentloaded", timeout: 60000 });
		await fr.waitForTimeout(10000);
		await fr.screenshot({ path: path.join(OUT, `${engineName}_${code}_FRAME_1.png`) });
		await fr.waitForTimeout(4000);
		await fr.screenshot({ path: path.join(OUT, `${engineName}_${code}_FRAME_2.png`) });
		await fr.close();

		await ctx.close();
		results.push(row);
		console.log(JSON.stringify(row));
	}
	await browser.close();
}
fs.writeFileSync(path.join(OUT, "autoplay2.json"), JSON.stringify(results, null, 2));
server.close();
