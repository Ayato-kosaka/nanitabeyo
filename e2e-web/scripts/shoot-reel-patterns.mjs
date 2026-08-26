/*
#1375 「リールの再生」— 見せ方の候補を実物で並べて撮る道具。

アプリのビルドは通さない。**Instagram の埋め込みそのものを、候補ごとの枠へ入れて撮る**。
アプリ側の差は «iframe/WebView をどの大きさで、どこに置いて、どこで切るか» だけなので、
その計算（app-expo/features/dishMedia/embedCrop.ts）を同じ値でここへ写せば見た目は一致する。
*/
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const OUT = process.argv[2] ?? ".";
const SHORTCODE = process.argv[3] ?? "DZnIRziT70s";

// 端末 1 台ぶんのセル。iPhone 14 相当（論理ピクセル）から、上下タブを除いた見え方。
const CELL_W = 390;
const CELL_H = 844;

// embedCrop.ts と同じ定数
const EMBED_HEADER_RATIO = 17 / 320;
const EMBED_MEDIA_ASPECT = 1;
const EMBED_FRAME_HEIGHT_RATIO = EMBED_HEADER_RATIO + EMBED_MEDIA_ASPECT + 0.05;
const EMBED_OVERSCAN = 1.02;

function crop(w, h) {
	const frameWidth = Math.max((h * EMBED_OVERSCAN) / EMBED_MEDIA_ASPECT, w * EMBED_OVERSCAN);
	const frameHeight = frameWidth * EMBED_FRAME_HEIGHT_RATIO;
	const mediaTop = frameWidth * EMBED_HEADER_RATIO;
	const mediaHeight = frameWidth * EMBED_MEDIA_ASPECT;
	return { frameWidth, frameHeight, left: (w - frameWidth) / 2, top: h / 2 - (mediaTop + mediaHeight / 2) };
}

const EMBED_URL = `https://www.instagram.com/reel/${SHORTCODE}/embed/captioned/`;
const EMBED_PLAIN = `https://www.instagram.com/reel/${SHORTCODE}/embed/`;

const c = crop(CELL_W, CELL_H);

// フィード側の見た目（右のアクション列・下の文言）を薄く重ねて、実機での印象に近づける。
const RAIL = `
<div class="rail">
  <div class="ic">♥</div><div class="ic">💬</div><div class="ic">🔖</div><div class="ic">⋯</div>
</div>
<div class="caption"><b>umaguru.tokyo</b><br/>取り込んだ Instagram のリール</div>`;

const PATTERNS = [
	{
		id: "A-current",
		title: "案A（今の実装）切り取って写真だけ全面",
		note: "iframe を幅 " + Math.round(c.frameWidth) + "px で描き、ヘッダと下の帯をセルの外へ捨てる。既存の dish_media と同じ «全面» になる。",
		body: `<iframe src="${EMBED_URL}" style="position:absolute;border:0;background:#000;width:${c.frameWidth}px;height:${c.frameHeight}px;left:${c.left}px;top:${c.top}px" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
		${RAIL}
		<div class="hint">▶ Instagram で再生</div>`,
	},
	{
		id: "B-raw-captioned",
		title: "切り取らない（/embed/captioned/ そのまま）",
		note: "Instagram が返すものをそのまま貼った場合。ヘッダ帯・いいね欄・コメント欄・白帯がそのまま出る。",
		body: `<iframe src="${EMBED_URL}" style="position:absolute;border:0;background:#fff;width:${CELL_W}px;height:${CELL_H}px;left:0;top:0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>${RAIL}`,
	},
	{
		id: "C-raw-plain",
		title: "切り取らない（/embed/ そのまま）",
		note: "captioned なし。キャプションが減るだけで、ヘッダ帯と白帯は変わらない。",
		body: `<iframe src="${EMBED_PLAIN}" style="position:absolute;border:0;background:#fff;width:${CELL_W}px;height:${CELL_H}px;left:0;top:0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>${RAIL}`,
	},
	{
		id: "D-letterbox",
		title: "幅に合わせて中央へ（レターボックス）",
		note: "切り取らず、写真の幅をセル幅に合わせて上下を黒で埋める。Instagram の UI は残る。",
		body: `<iframe src="${EMBED_URL}" style="position:absolute;border:0;background:#000;width:${CELL_W}px;height:${CELL_W * EMBED_FRAME_HEIGHT_RATIO}px;left:0;top:${(CELL_H - CELL_W * EMBED_FRAME_HEIGHT_RATIO) / 2}px" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>${RAIL}`,
	},
	{
		id: "E-oembed",
		title: "公式 oEmbed（blockquote + embeds.js）",
		note: "Meta の oEmbed が返す html をそのまま置いた場合。embeds.js が iframe へ差し替えるので、再生できる範囲は /embed/ と同じ。",
		body: `<div style="position:absolute;inset:0;overflow:auto;background:#fff">
		<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/reel/${SHORTCODE}/" data-instgrm-version="14" style="background:#FFF;border:0;margin:0;width:100%"></blockquote>
		<script async src="//www.instagram.com/embed.js"></script></div>${RAIL}`,
	},
	{
		id: "G-blurfill",
		title: "幅を合わせ、余白は同じ写真のぼかしで埋める",
		note: "拡大しすぎずに全画面へ収める案。写真は原寸のまま幅いっぱい、上下の余白は同じ絵をぼかして敷く。Instagram のヘッダ帯・いいね欄は内側の枠で切り取る。",
		body: (() => {
			// 写真だけを見せる内枠。iframe は «幅 = セル幅» で描かれるので、写真の高さは
			// 幅 × EMBED_MEDIA_ASPECT、ヘッダ帯の高さは 幅 × EMBED_HEADER_RATIO で決まる。
			// その矩形ぶんだけを切り抜いて中央へ置く
			const fw = CELL_W * EMBED_OVERSCAN;
			const mediaTop = fw * EMBED_HEADER_RATIO;
			const mediaH = fw * EMBED_MEDIA_ASPECT;
			const winTop = (CELL_H - mediaH) / 2;
			return `<div class="blurwrap"><img class="blurbg" src="THUMB_SRC"/></div>
		<div style="position:absolute;left:${(CELL_W - fw) / 2}px;top:${winTop}px;width:${fw}px;height:${mediaH}px;overflow:hidden">
		  <iframe src="${EMBED_URL}" style="position:absolute;border:0;background:#000;width:${fw}px;height:${fw * EMBED_FRAME_HEIGHT_RATIO}px;left:0;top:${-mediaTop}px" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
		</div>
		${RAIL}
		<div class="hint">▶ Instagram で再生</div>`;
		})(),
	},
	{
		id: "F-thumb-fallback",
		title: "再生できない投稿のフォールバック（サムネイル全面＋導線）",
		note: "権利保護（copyright_blocked）の投稿は埋め込みに映像が入らない。サムネイルを全面に敷き、Instagram を開く導線だけを出す案。",
		body: `<div class="thumbwrap"><img class="thumb" src="THUMB_SRC"/></div>
		<div class="scrim"></div>
		${RAIL}
		<div class="cta">▶ Instagram で見る</div>`,
	},
];

const HTML = (p) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#111}
.cell{position:relative;width:${CELL_W}px;height:${CELL_H}px;overflow:hidden;background:#000}
.rail{position:absolute;right:10px;bottom:150px;display:flex;flex-direction:column;gap:18px;align-items:center;
 font-size:24px;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.8);z-index:5}
.caption{position:absolute;left:14px;bottom:96px;right:70px;color:#fff;font:13px/1.5 -apple-system,sans-serif;
 text-shadow:0 1px 4px rgba(0,0,0,.9);z-index:5}
.hint{position:absolute;left:50%;transform:translateX(-50%);bottom:124px;z-index:6;
 background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.35);border-radius:16px;
 padding:6px 12px;color:#fff;font:12px -apple-system,sans-serif}
.cta{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:6;
 background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.5);border-radius:24px;
 padding:12px 20px;color:#fff;font:15px -apple-system,sans-serif}
.thumbwrap{position:absolute;inset:0}
.blurwrap{position:absolute;inset:0;overflow:hidden}
.blurbg{width:100%;height:100%;object-fit:cover;filter:blur(28px) brightness(.6);transform:scale(1.2)}
.thumb{width:100%;height:100%;object-fit:cover}
.scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.25),rgba(0,0,0,.05) 40%,rgba(0,0,0,.55))}
</style></head><body><div class="cell">${p.body}</div></body></html>`;

// ⚠️ bypass を必ず付ける。付けないと **ローカルの配信サーバーまでプロキシへ送られて**
// ページが読めず、真っ白のまま «撮れたように見える» 絵が出る（実測）
const proxy = process.env.HTTPS_PROXY
	? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" }
	: undefined;

const browser = await chromium.launch({
	executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
	proxy,
	args: [
		"--no-sandbox",
		"--ssl-version-max=tls1.2",
		"--disable-features=EncryptedClientHello,DnsOverHttps",
		"--autoplay-policy=no-user-gesture-required",
	],
});

const ctx = await browser.newContext({
	viewport: { width: CELL_W, height: CELL_H },
	deviceScaleFactor: 2,
	ignoreHTTPSErrors: true,
	userAgent:
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});

// F 用のサムネイル。埋め込みから 1 枚拾って data URI にする（外部依存を残さない）
let thumbDataUri = "";
try {
	const probe = await ctx.newPage();
	await probe.goto(EMBED_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
	await probe.waitForTimeout(6000);
	// ⚠️ 初版は最初に見つかった img を採っており、**アカウントのアバター**（小さい丸画像）を
	// 掴んでいた。埋め込みの中でいちばん面積の大きい画像がポスター画像である
	const src = await probe.evaluate(() => {
		const imgs = [...document.querySelectorAll("img")].filter((i) => i.naturalWidth > 0);
		if (imgs.length === 0) return null;
		imgs.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);
		return imgs[0].src;
	});
	if (src) {
		const buf = await probe.evaluate(async (u) => {
			const r = await fetch(u);
			const b = await r.blob();
			return await new Promise((res) => {
				const fr = new FileReader();
				fr.onload = () => res(fr.result);
				fr.readAsDataURL(b);
			});
		}, src);
		thumbDataUri = buf;
	}
	await probe.close();
} catch (e) {
	console.error("サムネイル取得に失敗:", e.message);
}

fs.mkdirSync(OUT, { recursive: true });
const manifest = [];

/*
⚠️ `page.setContent` で流し込むと、ページのオリジンが about:blank になる。
公式 oEmbed の html が読む `//www.instagram.com/embed.js` は protocol-relative なので、
about: の上では **読み込まれず E が白紙になる**（実測）。実オリジンで配信する。
*/
const pages = new Map();
for (const p of PATTERNS) pages.set(`/${p.id}`, HTML(p).replace("THUMB_SRC", thumbDataUri || ""));
const server = http.createServer((req, res) => {
	const body = pages.get(req.url) ?? "not found";
	res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	res.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

for (const p of PATTERNS) {
	const page = await ctx.newPage();
	await page.goto(`${base}/${p.id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
	// 埋め込みの読み込み待ち。動画が出るものは 1 コマ目まで進める
	await page.waitForTimeout(12000);
	const file = path.join(OUT, `${SHORTCODE}_${p.id}.png`);
	await page.screenshot({ path: file });
	// 何が描かれたかを機械で残す（«それらしい絵» を出して終わりにしない）
	const probe = await page.evaluate(() => {
		const f = document.querySelector("iframe");
		return { iframes: document.querySelectorAll("iframe").length, iframeSrc: f ? f.src : null };
	});
	manifest.push({ ...p, file, probe });
	console.log(`✅ ${p.id}: ${file} (${JSON.stringify(probe)})`);
	await page.close();
}

fs.writeFileSync(path.join(OUT, `${SHORTCODE}_manifest.json`), JSON.stringify(manifest, null, 2));
await browser.close();
server.close();
