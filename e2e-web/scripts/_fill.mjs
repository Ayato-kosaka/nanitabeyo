/* #1641 «埋め込みの video をセル全面へ» を、WebView を拡大せずページ内の CSS で成立させられるか実測する。 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const OUT = process.argv[2], code = process.argv[3] ?? "CDg3owdFa6W";
const CELL_W = 390, CELL_H = 844;
fs.mkdirSync(OUT, { recursive: true });
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
const browser = await chromium.launch({ channel: "chrome", proxy,
  args: ["--no-sandbox", "--ssl-version-max=tls1.2", "--disable-features=EncryptedClientHello,DnsOverHttps"] });

for (const fit of ["cover", "contain"]) {
  const ctx = await browser.newContext({ viewport: { width: CELL_W, height: CELL_H }, deviceScaleFactor: 2, ignoreHTTPSErrors: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });
  const page = await ctx.newPage();
  await page.goto(`https://www.instagram.com/p/${code}/embed/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);

  // 素の状態（いまの実装が外から切り取っている元）
  if (fit === "cover") {
    const geom = await page.evaluate(() => {
      const v = document.querySelector("video"); if (!v) return null;
      const r = v.getBoundingClientRect();
      return { videoRect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
               natural: { w: v.videoWidth, h: v.videoHeight }, viewport: { w: innerWidth, h: innerHeight } };
    });
    console.log("素の埋め込みでの video の位置と寸法:", JSON.stringify(geom));
    await page.screenshot({ path: path.join(OUT, "raw.png") });
  }

  /*
   * クラス名に一切依存しない «全面化»。
   * video 要素そのものを viewport いっぱいの固定配置にし、背後を黒で塗る。
   * Instagram の DOM 構造が変わっても «video タグが 1 つある» ことしか前提にしていない。
   */
  await page.evaluate((objectFit) => {
    const v = document.querySelector("video"); if (!v) return;
    const bg = document.createElement("div");
    bg.style.cssText = "position:fixed;inset:0;background:#000;z-index:2147483646";
    document.body.appendChild(bg);
    const s = v.style;
    s.setProperty("position", "fixed", "important");
    s.setProperty("inset", "0", "important");
    s.setProperty("width", "100vw", "important");
    s.setProperty("height", "100vh", "important");
    s.setProperty("max-width", "none", "important");
    s.setProperty("max-height", "none", "important");
    s.setProperty("object-fit", objectFit, "important");
    s.setProperty("z-index", "2147483647", "important");
    v.muted = true; v.loop = true; v.playsInline = true;
    const p = v.play(); if (p && p.catch) p.catch(() => {});
  }, fit);
  await page.waitForTimeout(3500);
  const st = await page.evaluate(() => { const v = document.querySelector("video"); const r = v.getBoundingClientRect();
    return { t: +v.currentTime.toFixed(2), paused: v.paused, rect: { w: Math.round(r.width), h: Math.round(r.height) } }; });
  console.log(`  object-fit: ${fit} →`, JSON.stringify(st));
  await page.screenshot({ path: path.join(OUT, `fill_${fit}.png`) });
  await page.close(); await ctx.close();
}
await browser.close();
