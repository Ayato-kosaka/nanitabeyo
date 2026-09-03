import { chromium } from "@playwright/test";
import fs from "node:fs";
const SCRIPT = fs.readFileSync("/home/user/nanitabeyo/app-expo/features/dishMedia/components/ExternalEmbedPlayer.tsx","utf8")
  .match(/const AUTOPLAY_SCRIPT = `([\s\S]*?)`;\n/)[1];
const CODE = process.argv[2];
const browser = await chromium.launch({ channel:"chrome",
  args:["--no-sandbox","--ssl-version-max=tls1.2","--disable-features=EncryptedClientHello,DnsOverHttps","--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport:{width:360,height:780},
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass:"127.0.0.1,localhost" } : undefined });
const page = await ctx.newPage();
let t0;
await page.exposeFunction("__nbPost", (s) => console.log(`RESULT +${Date.now()-t0}ms ${s}`));
await page.addInitScript(() => { window.ReactNativeWebView = { postMessage: (s) => window.__nbPost(s) }; });
t0 = Date.now();
await page.goto(`https://www.instagram.com/p/${CODE}/embed/`, { waitUntil: "commit" });
page.once("domcontentloaded", () => page.evaluate(SCRIPT).catch(()=>{}));
await page.waitForTimeout(15000);
await page.screenshot({ path:`/tmp/claude-0/-home-user-nanitabeyo/723d1235-5107-5890-a6a7-dadd9eb97d9d/scratchpad/early-${CODE}.png` });
await browser.close();
