// エビデンス撮影の共通部分。シナリオ側はこれを import して flow だけ書く。
//
// ここに置いてある理由: モック・ブラウザ起動・保存先の作法は毎回同じで、
// シナリオごとにコピーすると必ずどこかがズレる（実際、レスポンス封筒の形を
// 間違えて 1 周無駄にした）。共通部分は 1 箇所に閉じる。
import { createRequire } from "node:module";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO = process.env.EVIDENCE_REPO || "/home/user/nanitabeyo";
const require = createRequire(path.join(REPO, "e2e-web/"));
const { chromium } = require("@playwright/test");

export const BASE = process.env.EVIDENCE_BASE || "http://localhost:8788";
export const OUT = process.env.EVIDENCE_OUT || "/tmp/claude-artifacts/evidence";

/**
 * ⚠️ サンドボックス / CI の Chromium はリポジトリの @playwright/test と
 * バージョンが一致しないことがある（実測: playwright 1.61.1 が
 * chromium_headless_shell-1228 を要求するのに、入っているのは 1194）。
 * その場合は download させず、既に在る実体を直接指す。
 */
function resolveExecutablePath() {
	if (process.env.EVIDENCE_CHROMIUM) return process.env.EVIDENCE_CHROMIUM;
	for (const p of [
		"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
		"/opt/pw-browsers/chromium/chrome-linux/chrome",
	]) {
		if (existsSync(p)) return p;
	}
	return undefined; // 見つからなければ Playwright の既定に任せる
}

const JWT = [
	Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
	Buffer.from(
		JSON.stringify({
			sub: "11111111-1111-1111-1111-111111111111",
			aud: "authenticated",
			role: "authenticated",
			exp: 4102444800,
			is_anonymous: false,
			email: "evidence@example.com",
		}),
	).toString("base64url"),
	"sig",
].join(".");

const USER = {
	id: "11111111-1111-1111-1111-111111111111",
	aud: "authenticated",
	role: "authenticated",
	email: "evidence@example.com",
	is_anonymous: false,
	app_metadata: { provider: "email" },
	user_metadata: {},
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
};
const SESSION = {
	access_token: JWT,
	token_type: "bearer",
	expires_in: 3600,
	expires_at: 4102444800,
	refresh_token: "fake-refresh-token",
	user: USER,
};

// LoadScript は window.initMap が呼ばれるまで "Loading..." を出し続けるため、最後に必ず呼ぶ
const MAPS_STUB = `window.google=window.google||{};window.google.maps={version:"3.58",importLibrary:async()=>({}),event:{addListener:()=>({remove:()=>{}})},places:{AutocompleteService:function(){this.getPlacePredictions=(r,cb)=>cb&&cb([],"ZERO_RESULTS");},PlacesServiceStatus:{OK:"OK"}},Map:function(){},Marker:function(){},LatLng:function(){},LatLngBounds:function(){},Geocoder:function(){},MapTypeId:{ROADMAP:"roadmap"}};window.initMap&&window.initMap();`;

/**
 * ⚠️ backend のレスポンスは `BaseResponse<R>` = `{ success: boolean, data: R }` である。
 * 素の配列やオブジェクトを返すと useAPICall が `invalid_response` /
 * "Malformed response for ..." で弾き、画面はエラー表示になる。
 * 空で握りつぶすときも必ずこの封筒に入れること。
 */
export const ok = (data) => JSON.stringify({ success: true, data });

/** 色ベタ + 白枠の SVG。カードの端がどこまで伸びているかを見たいときに使う */
export const solidCard = (hex) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><rect width="720" height="1280" fill="#${hex}"/><rect x="8" y="8" width="704" height="1264" fill="none" stroke="#ffffff" stroke-width="16"/></svg>`;

/**
 * @param {import("@playwright/test").Page} page
 * @param {(url: string) => ({body: string, contentType?: string, status?: number}) | null} handler
 *        シナリオ固有の応答。null を返すと既定（空データ）にフォールバックする。
 */
export async function installMocks(page, handler) {
	await page.route("**", async (route) => {
		const url = route.request().url();
		if (url.startsWith(BASE)) return route.continue();
		if (url.includes("maps.googleapis.com"))
			return route.fulfill({ status: 200, contentType: "text/javascript", body: MAPS_STUB });
		if (url.includes("/auth/v1/user"))
			return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) });
		if (url.includes("/auth/v1/"))
			return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION) });
		if (handler) {
			const r = handler(url);
			if (r)
				return route.fulfill({
					status: r.status ?? 200,
					contentType: r.contentType ?? "application/json",
					body: r.body,
				});
		}
		return route.fulfill({ status: 200, contentType: "application/json", body: ok([]) });
	});
}

/**
 * 1 本撮る。撮ったファイルの一覧を返す。
 * @param {object} o
 * @param {string} o.name           出力ファイル名の接頭辞
 * @param {(url:string)=>any} [o.mock] シナリオ固有のモック
 * @param {object} [o.contextOptions]  viewport / permissions などの上書き
 * @param {(page, shot)=>Promise<void>} o.flow  操作。shot("01-open") でスクショを撮る
 */
/**
 * 撮る前に、その言語の字が描けるフォントが居るかを確かめる。
 *
 * 2026-08-23、この確認が無かったために、CI で撮った動画・スクショの日本語が
 * すべて豆腐（□）になり、読めないエビデンスをそのまま PR へ配ってしまった。
 * `playwright install --with-deps` が入れるのは Latin 系だけで、CJK は入らない。
 * 「URL が 200 で返る」は中身が読めることを何ひとつ保証しない。
 *
 * 撮ってから気づいても撮り直しになるので、起動前に落とす。
 */
export function assertFontsFor(langs = ["ja"]) {
	const missing = [];
	for (const lang of langs) {
		let n = 0;
		try {
			n = execFileSync("fc-list", [`:lang=${lang}`], { encoding: "utf8" })
				.split("\n")
				.filter(Boolean).length;
		} catch {
			// fc-list が無い環境では判定できない。黙って通さず、その旨を出す
			console.warn("fc-list が無いためフォントの確認ができない。文字化けの可能性を残したまま撮る");
			return;
		}
		console.log(`lang=${lang} のフォント数: ${n}`);
		if (n === 0) missing.push(lang);
	}
	if (missing.length) {
		throw new Error(
			`${missing.join(", ")} のフォントが無い。この状態で撮ると文字が豆腐（□）になり、\n` +
				`エビデンスとして使えない。先に入れること:\n` +
				`  sudo apt-get install -y fonts-noto-cjk fonts-noto-core && fc-cache -f`,
		);
	}
}

export async function record({ name, mock, contextOptions, flow, langs }) {
	assertFontsFor(langs ?? ["ja"]);
	await mkdir(OUT, { recursive: true });
	const browser = await chromium.launch({ executablePath: resolveExecutablePath() });
	const context = await browser.newContext({
		locale: "ja-JP",
		viewport: { width: 390, height: 844 }, // iPhone 相当。iOS 実機ではないので偽らないこと
		recordVideo: { dir: OUT, size: { width: 390, height: 844 } },
		...contextOptions,
	});
	const page = await context.newPage();
	await installMocks(page, mock);
	// チュートリアルは既読にしておく（目的の画面を隠すため）
	await page.addInitScript(() => {
		try {
			window.localStorage.setItem("search_tutorial_seen_v1", "true");
		} catch {}
	});

	const shots = [];
	const shot = async (label) => {
		const p = `${OUT}/${name}-${label}.png`;
		await page.screenshot({ path: p });
		shots.push(p);
		return p;
	};

	try {
		await flow(page, shot);
	} finally {
		const video = page.video();
		await context.close(); // close で動画が確定する
		if (video) await rename(await video.path(), `${OUT}/${name}.webm`);
		await browser.close();
	}
	console.log(`saved: ${OUT}/${name}.webm (+${shots.length} shots)`);
	return { video: `${OUT}/${name}.webm`, shots };
}

/** 画面に出ているチュートリアルを閉じる（複数ページある場合も想定） */
export async function dismissTutorial(page, max = 4) {
	for (let i = 0; i < max; i++) {
		const skip = page.getByText("スキップ", { exact: true });
		if (await skip.count()) {
			await skip.first().click().catch(() => {});
			await page.waitForTimeout(900);
		} else break;
	}
	await page.waitForTimeout(1200);
}

/** 何が映ったかを後から追えるようにメモを残す */
export async function writeNote(name, lines) {
	await mkdir(OUT, { recursive: true });
	await writeFile(`${OUT}/${name}.md`, lines.join("\n") + "\n");
}
