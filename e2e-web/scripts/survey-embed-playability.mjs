/*
#1641 「取り込む対象のリールのうち、何割が埋め込みで再生できないのか」を実数で出す。

    node scripts/survey-embed-playability.mjs <アカウント名>...

受け入れ条件（取り込んだリールが再生される）が現実に何割で成立するかは、
オーナーの 2 本が 2 本ともブロックされていた事実だけでは判らない。実데이터を取る。

手口: instagram.com の文脈から web_profile_info（公開エンドポイント）を叩いて
アカウントの投稿一覧 → shortcode を集め、各 shortcode の埋め込みを SSR で見て
video_url の有無を数える。ログインは不要。
*/
import { chromium } from "@playwright/test";
const ACCOUNTS = process.argv.slice(2);
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
const browser = await chromium.launch({
	executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", proxy,
	args: ["--no-sandbox", "--ssl-version-max=tls1.2", "--disable-features=EncryptedClientHello,DnsOverHttps"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
// 同一オリジンの文脈を作る（X-IG-App-ID は公開の web クライアント ID）
await page.goto("https://www.instagram.com/robots.txt", { waitUntil: "domcontentloaded", timeout: 60000 });

for (const user of ACCOUNTS) {
	const codes = await page.evaluate(async (u) => {
		try {
			const r = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${u}`, {
				headers: { "X-IG-App-ID": "936619743392459" },
			});
			if (!r.ok) return { err: `HTTP ${r.status}` };
			const j = await r.json();
			const edges = j?.data?.user?.edge_owner_to_timeline_media?.edges ?? [];
			return { list: edges.filter((e) => e.node?.is_video).map((e) => e.node.shortcode) };
		} catch (e) { return { err: String(e).slice(0, 120) }; }
	}, user);
	if (codes.err) { console.log(`@${user}: 取得失敗 ${codes.err}`); continue; }

	let playable = 0, blocked = 0;
	const detail = [];
	for (const code of (codes.list || []).slice(0, 12)) {
		const p = await ctx.newPage();
		try {
			await p.goto(`https://www.instagram.com/reel/${code}/embed/captioned/`, { waitUntil: "domcontentloaded", timeout: 45000 });
			await p.waitForTimeout(4000);
			const has = await p.evaluate(() => {
				const v = document.querySelector("video");
				return { videoEls: document.querySelectorAll("video").length, src: v ? !!(v.getAttribute("src") || v.currentSrc) : false };
			});
			if (has.videoEls > 0 && has.src) { playable++; detail.push(`${code}:✅`); } else { blocked++; detail.push(`${code}:❌`); }
		} catch (e) { detail.push(`${code}:err`); }
		await p.close();
	}
	console.log(`@${user}: 再生可 ${playable} / 不可 ${blocked}  ${detail.join(" ")}`);
}
await browser.close();
