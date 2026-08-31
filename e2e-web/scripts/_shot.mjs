import { chromium } from "@playwright/test";
import fs from "node:fs";
const SCRIPT = fs.readFileSync("/home/user/nanitabeyo/app-expo/features/dishMedia/components/ExternalEmbedPlayer.tsx","utf8")
  .match(/const AUTOPLAY_SCRIPT = `([\s\S]*?)`;\n/)[1];
const CODE = process.argv[2];
const browser = await chromium.launch({ channel:"chrome",
  args:["--no-sandbox","--ssl-version-max=tls1.2","--disable-features=EncryptedClientHello,DnsOverHttps","--autoplay-policy=no-user-gesture-required"] });
// iPhone 16 相当のセル寸法（393x852 の全画面セル）
const ctx = await browser.newContext({ viewport:{width:393,height:852},
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass:"127.0.0.1,localhost" } : undefined });
const page = await ctx.newPage();
await page.exposeFunction("__nbPost",(s)=>console.log("RESULT "+s));
await page.addInitScript(()=>{ window.ReactNativeWebView={postMessage:(s)=>window.__nbPost(s)}; });
await page.goto(`https://www.instagram.com/p/${CODE}/embed/`,{waitUntil:"commit"});
page.once("domcontentloaded",()=>page.evaluate(SCRIPT).catch(()=>{}));
await page.waitForTimeout(8000);
console.log(JSON.stringify(await page.evaluate(()=>{
  const v=document.querySelector("video"); if(!v) return {video:null};
  const r=v.getBoundingClientRect();
  return { rect:{w:Math.round(r.width),h:Math.round(r.height)}, videoWH:[v.videoWidth,v.videoHeight],
           fit:getComputedStyle(v).objectFit, paused:v.paused };
})));
await page.screenshot({ path:`/tmp/claude-0/-home-user-nanitabeyo/723d1235-5107-5890-a6a7-dadd9eb97d9d/scratchpad/contain-${CODE}.png` });
await browser.close();
