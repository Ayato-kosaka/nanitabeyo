/*
即席エビデンス撮影の録画テンプレート（SKILL.md の手順 2）。

実行方法（どのディレクトリからでもよい）:
    env -u PLAYWRIGHT_BROWSERS_PATH node .claude/skills/evidence-video/scripts/record.mjs

前半（モック）は共通部品なので触らない。後半の「シナリオ」だけを撮りたいフローへ書き換える。
スクショだけ欲しいときは recordVideo を外して page.screenshot() を使う。
出力先はセッションの scratchpad など、リポジトリの外に置くこと。
*/
import { rename, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

// このスクリプトは node_modules を持たない場所に居るため、ESM の import では
// @playwright/test を解決できない。e2e-web を基点にした require で借りる
const require = createRequire(new URL("../../../../e2e-web/package.json", import.meta.url));
const { chromium, webkit, devices } = require("@playwright/test");

/**
 * デバイスプリセット。e2e-web/playwright.config.ts の mobile-chrome / mobile-safari と
 * 同じ device descriptor を使う（CI のテスト環境と見た目を揃えるため）。
 *
 * ⚠️ これは «相当» であって実機ではない。同じ React Native の JS が描画されるので
 * UI・デザイン・フローのエビデンスとしてはほぼ等価だが、OS の許可ダイアログ・ATT・
 * プッシュ通知・共有インテント等のネイティブ面は映らない。それらは e2e-mobile CI の
 * record_videos 入力（本物の Detox 動画）で撮ること。SKILL.md 参照。
 *
 * ios プリセットは WebKit エンジンを使うため、初回は
 *   env -u PLAYWRIGHT_BROWSERS_PATH npx playwright install webkit
 * （e2e-web で実行）が必要になることがある。
 */
const PRESETS = {
	// 素の iPhone サイズ Chromium（最速。エンジン差が論点でないときの既定）
	default: { engine: chromium, options: { viewport: { width: 390, height: 844 } } },
	// Android 相当（Pixel 7 の UA / viewport / タッチ。CI の mobile-chrome と同一）
	android: { engine: chromium, options: { ...devices["Pixel 7"] } },
	// iOS 相当（iPhone 14 + WebKit = Safari のレンダリングエンジン。CI の mobile-safari と同一）
	ios: { engine: webkit, options: { ...devices["iPhone 14"] } },
};

const BASE = "http://localhost:8788";
// 出力先。セッションの scratchpad へ書き換えて使う（リポジトリ内へは置かない）
const OUT = process.env.EVIDENCE_OUT ?? "/tmp/evidence-video";

// ── ここからモック（共通部品。触らない） ─────────────────────────────
// Supabase 認証: 偽 JWT 入りセッション。確立しないと auth-error-fallback で画面が出ない
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
	sub: "00000000-0000-4000-8000-000000000001",
	aud: "authenticated",
	role: "authenticated",
	exp: 4102444800,
	is_anonymous: true,
})}.sig`;
const USER = {
	id: "00000000-0000-4000-8000-000000000001",
	aud: "authenticated",
	role: "authenticated",
	email: "",
	is_anonymous: true,
	app_metadata: {},
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
// Google Maps: LoadScript は window.initMap が呼ばれるまで "Loading..." を出し続けるため、
// スタブの最後で必ず initMap を呼ぶ（呼ばないとアプリ全体が Loading で固まる）
const MAPS_STUB = `window.google=window.google||{};window.google.maps={version:"3.58",importLibrary:async()=>({}),event:{addListener:()=>({remove:()=>{}})},places:{AutocompleteService:function(){this.getPlacePredictions=(r,cb)=>cb&&cb([],"ZERO_RESULTS");},PlacesServiceStatus:{OK:"OK"}},Map:function(){},Marker:function(){},LatLng:function(){},LatLngBounds:function(){},Geocoder:function(){},MapTypeId:{ROADMAP:"roadmap"}};window.initMap&&window.initMap();`;

async function installMocks(page) {
	await page.route("**", async (route) => {
		const url = route.request().url();
		if (url.startsWith(BASE)) return route.continue();
		// script として実行される URL へ JSON を返すと SyntaxError で壊れるので contentType を合わせる
		if (url.includes("maps.googleapis.com"))
			return route.fulfill({ status: 200, contentType: "text/javascript", body: MAPS_STUB });
		if (url.includes("/auth/v1/user"))
			return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) });
		if (url.includes("/auth/v1/"))
			return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION) });
		// backend / CDN / その他外部はすべて空で握りつぶす（サンドボックスは外部到達不可）
		return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) });
	});
}
// ── モックここまで ───────────────────────────────────────────────

await mkdir(OUT, { recursive: true });
const launched = new Map(); // エンジンごとに 1 度だけ起動して使い回す

/**
 * 1 本の動画を撮る。
 *
 * @param name    出力ファイル名（.webm が付く）
 * @param preset  PRESETS のキー（"default" / "android" / "ios"）
 * @param contextOptions 追加の context オプション。
 *   例) 位置情報許可済み: { permissions: ["geolocation"], geolocation: { latitude: 35.68, longitude: 139.76 } }
 * @param scenario page を受け取って操作する async 関数
 */
async function record(name, preset, contextOptions, scenario) {
	const { engine, options } = PRESETS[preset];
	if (!launched.has(engine)) launched.set(engine, await engine.launch());
	const browser = launched.get(engine);

	const viewport = options.viewport;
	const context = await browser.newContext({
		locale: "ja-JP",
		...options,
		recordVideo: { dir: OUT, size: viewport },
		...contextOptions,
	});
	const page = await context.newPage();
	await installMocks(page);
	await scenario(page);
	const video = page.video();
	await context.close(); // close で動画が確定する
	await rename(await video.path(), `${OUT}/${name}.webm`);
	console.log("saved:", `${OUT}/${name}.webm`);
}

// ── シナリオ（ここを撮りたいフローへ書き換える） ─────────────────────
// 例: オンボーディング初回導線。SPA モードは "/" からの初期タブが狂うことがあるので
//     目的のルートへ直接 goto する。アニメーションは実時間ぶん waitForTimeout で待つ。
//     プラットフォーム比較が要るときは同じシナリオを "android" / "ios" でも record する
await record("example-onboarding", "default", {}, async (page) => {
	await page.goto(BASE + "/ja-JP/search");
	await page.getByTestId("onboarding-screen").waitFor({ timeout: 30000 });
	await page.waitForTimeout(2600); // 課題 → 解決アニメーション（約 1.5s + 0.3s）
	await page.getByTestId("onboarding-next").click();
	await page.waitForTimeout(2600);
});

for (const browser of launched.values()) await browser.close();
