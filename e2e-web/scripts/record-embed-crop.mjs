/*
#1375（案 A）**取り込んだリールがフィードで «写真が全画面に出る» ことの録画。**

`ui-preview.mjs` と同じモック（Supabase 匿名サインイン / backend / Google Maps /
Instagram の埋め込みスタブ）をそのまま使い、**録画だけ**を目的に切り出したもの。
使い方も同じで、先に app-expo でダミー .env を置いて `npx expo start --web --port 8081`
を立てておく（手順は ui-preview.mjs のヘッダを参照）。

    cd e2e-web && node scripts/record-embed-crop.mjs

出力は `EVIDENCE_OUT`（既定 /tmp/claude-artifacts/evidence）へ webm と png。

⚠️ ここで映るのは **web ビルド（react-native-web）** である。ネイティブの実機は
Detox（e2e-mobile-test.yml の record_videos）で別途撮る。
**この動画を「実機で確認した」と提示してはいけない。**
*/
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
const now = Math.floor(Date.now() / 1000);
// #1375 5 巡目: 「食べたを記録」はログインが要る（ゲストにはサインイン画面が出るのが正しい挙動）。
// 撮影用のセッションは **ログイン済み**にする。以前は is_anonymous: true で、
// eaten タブを撮ろうとするとサインイン画面しか撮れなかった
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "preview@example.com", is_anonymous: false, app_metadata: { provider: "anonymous", providers: ["anonymous"] }, user_metadata: {}, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
const session = { access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4IiwiZXhwIjo5OTk5OTk5OTk5fQ.x", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "r", user };

// 1x1 PNG (orange-ish) data
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

const pad2 = (v) => (v < 10 ? `0${v}` : String(v));
const d = new Date();
const ym = (n) => { const a = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 15, 3)); return a; };
const iso = (n, day) => { const a = ym(n); return new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), day, 3)).toISOString(); };
// #1375 5 巡目: status を引数にした（緑=食べたい / 赤=食べた の内訳バッジを撮るため。
// 既定は従来どおり "eaten" なので、既存の呼び出しの見え方は変わらない）
const item = (key, occurredAt, withMedia, cat = ["Q1", "ラーメン"], status = "eaten") => ({
  key, status, occurredAt, savedAt: status === "want" ? occurredAt : null, eatenAt: status === "eaten" ? occurredAt : null,
  restaurant: { id: "r-1", name: "醤油ラーメン一番", image_url: "https://img.example.invalid/r.jpg" },
  dish: { id: `dish-${key}`, category_id: cat[0], name: cat[1], reviewCount: 3, averageRating: 4.2, categoryImageUrl: "https://img.example.invalid/c.jpg" },
  dishMedia: withMedia ? { id: `dm-${key}`, thumbnailImageUrl: "https://img.example.invalid/t.jpg", mediaImageUrl: "https://img.example.invalid/m.jpg", mediaType: "image" } : null,
  myReview: null, distanceMeters: null,
});
// this month: several days with records; last month: a few
const page1 = [
  item("a", iso(0, 2), true), item("b", iso(0, 5), true), item("b2", iso(0, 5), true), item("c", iso(0, 11), true),
  item("d", iso(0, 14), false), item("e", iso(0, 20), true),
  item("f", iso(1, 3), true), item("g", iso(1, 9), true), item("h", iso(1, 22), true),
  // #1375 5 巡目: 同じ日に «食べたい» と «食べた» が混ざる日を作る（日バッジが緑と赤に割れる）
  item("w1", iso(0, 5), true, ["Q1", "ラーメン"], "want"),
  item("w2", iso(0, 5), true, ["Q2", "寿司"], "want"),
  item("w3", iso(0, 11), true, ["Q3", "カレー"], "want"),
  item("w4", iso(0, 18), true, ["Q4", "うどん"], "want"),
  // #1375 4 巡目: 料理カテゴリー絞り込みの「もっと見る」を出すため 10 カテゴリー以上にする
  ...[["Q2","寿司"],["Q3","カレー"],["Q4","うどん"],["Q5","そば"],["Q6","天ぷら"],["Q7","焼き鳥"],["Q8","餃子"],["Q9","パスタ"],["Q10","ハンバーガー"],["Q11","牛丼"]]
    .map((cat, i) => item(`cat-${cat[0]}`, iso(0, 3 + (i % 20)), true, cat)),
];

const LONG_CAPTION = [
  "濃口醤油とラードを効かせた八王子ラーメン！半熟味玉を添えた中華そば",
  "【中華そば専門店 八王子ラーメンよしだ】",
  "東京都八王子市にある「中華そば専門店 八王子ラーメンよしだ」へ撮影に伺いました。",
  "■店舗情報",
  "🏠 店名：中華そば専門店 八王子ラーメンよしだ",
  "📍 住所：東京都八王子市東町1-3",
  "⏰ 営業時間：11:00〜翌2:00",
  "■ご紹介したメニュー",
  "・中華そば：800円（税込）",
].join("\n");
// #1375 4巡目: 取り込んだリール（render_type='external_embed'）の再生確認用エントリ
const EMBED_ENTRY = {
  restaurant: {
    id: "r-embed", name: "中華そば専門店 八王子ラーメンよしだ", name_language_code: "ja",
    image_url: "https://img.example.invalid/r.jpg", image_path: null,
    google_place_id: "place_embed", created_at: "2026-08-01T00:00:00Z",
    latitude: 35.6577, longitude: 139.341, location: null, address_components: null, plus_code: null,
  },
  dish: {
    id: "dish-embed", name: "ラーメン", restaurant_id: "r-embed", category_id: "Q1",
    created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", lock_no: 1,
    reviewCount: 0, averageRating: 0,
  },
  dish_media: {
    id: "media-embed-1", dish_id: "dish-embed", media_path: null, thumbnail_path: "",
    media_type: "image", user_id: null, lock_no: 1,
    created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    media_processing_status: "completed", thumbnail_processing_status: "completed",
    render_type: "external_embed",
    isSaved: true, isLiked: false, likeCount: 0, isMine: false,
    mediaUrl: null,
    thumbnailImageUrl: "https://img.example.invalid/t.jpg",
    video_duration_ms: null,
    externalEmbed: {
      provider: "instagram", externalContentId: "DZnIRziT70s",
      canonicalUrl: "https://www.instagram.com/reel/DZnIRziT70s/",
      embedStatus: "available", lastVerifiedAt: null,
      thumbnailUrl: "https://img.example.invalid/t.jpg",
    },
  },
  dish_reviews: [],
};

const resolveResponse = {
  status: "ok", reason: "resolved",
  source: { provider: "instagram", externalContentId: "DZFdePPzzLI", canonicalUrl: "https://www.instagram.com/reel/DZFdePPzzLI/", mediaIndex: null },
  metadata: { title: LONG_CAPTION, authorName: "umaguru.tokyo", authorUrl: null, thumbnailUrl: null, extractedTexts: [] },
  candidates: {
    dishCategories: [
      { dishCategoryId: "Q177", labelEn: "Ramen", labels: { ja: "ラーメン" } },
      { dishCategoryId: "Q188", labelEn: "Miso ramen", labels: { ja: "味噌ラーメン" } },
    ],
    restaurants: [ { restaurantId: "r-1", name: "麺屋 いちばん 本店" }, { restaurantId: "r-2", name: "らーめん 大和" } ],
  },
  prefill: { dishCategoryId: "Q188", restaurantId: null },
  restaurantSearch: { performed: true, reason: "searched", scannedCount: 12 },
};


// Google Maps JS API のスタブ。LoadScript がアプリ全体を包んでおり、
// これが読めないと画面全体が «Loading...» のまま止まる
const MAPS_STUB = `
(function(){
  function F(){ return this; }
  function mk(){ return new Proxy(function(){}, { get: () => mk(), apply: () => mk(), construct: () => mk() }); }
  const ev = { addListener: () => ({ remove(){} }), addListenerOnce: () => ({ remove(){} }), removeListener(){}, trigger(){} };
  class MVCObject { addListener(){ return { remove(){} }; } set(){} get(){} setValues(){} bindTo(){} }
  class GMap extends MVCObject { constructor(el){ this.el = el; } setOptions(){} setCenter(){} setZoom(){} getZoom(){ return 12; } panTo(){} getBounds(){ return null; } getCenter(){ return { lat: () => 35.68, lng: () => 139.76 }; } fitBounds(){} getDiv(){ return this.el; } controls = [[],[],[],[],[],[],[],[],[],[],[],[],[],[]]; data = { addListener(){ return { remove(){} }; }, setStyle(){} }; }
  class Marker extends MVCObject { setMap(){} setPosition(){} setIcon(){} setZIndex(){} }
  window.google = { maps: {
    Map: GMap, Marker, InfoWindow: F, LatLng: function(a,b){ return { lat: () => a, lng: () => b }; },
    LatLngBounds: function(){ return { extend(){}, getNorthEast(){ return { lat:()=>36, lng:()=>140 }; }, getSouthWest(){ return { lat:()=>35, lng:()=>139 }; } }; },
    Size: function(){}, Point: function(){}, event: ev, ControlPosition: {}, MapTypeId: { ROADMAP: "roadmap" },
    Animation: {}, SymbolPath: {}, MVCObject,
    marker: { AdvancedMarkerElement: F },
    places: { Autocomplete: F, AutocompleteService: F, PlacesService: F, PlacesServiceStatus: { OK: "OK" } },
    OverlayView: class extends MVCObject { setMap(){} getPanes(){ return { overlayMouseTarget: document.createElement("div") }; } getProjection(){ return { fromLatLngToDivPixel: () => ({ x: 0, y: 0 }) }; } },
  } };
  if (typeof window.initMap === 'function') window.initMap();
  if (typeof window.__googleMapsCallback === 'function') window.__googleMapsCallback();
})();
`;
/** ui-preview.mjs と同じモック一式。ここを触らないこと（触るなら両方を揃える） */
async function installMocks(context) {
	// 匿名サインイン（/auth/v1/signup）を成功させる。セッション注入より確実
	await context.route("**/example.supabase.co/**", (r) => {
	  const u = r.request().url();
	  if (u.includes("/auth/v1/user")) return r.fulfill({ json: user });
	  return r.fulfill({ json: session });
	});
	await context.route("**/maps.googleapis.com/**", (r) => {
	  if (r.request().url().includes("/maps/api/js")) return r.fulfill({ contentType: "application/javascript", body: MAPS_STUB });
	  return r.fulfill({ json: {} });
	});
	await context.route("**/img.example.invalid/**", (r) => r.fulfill({ contentType: "image/png", body: PNG }));
	// ⚠️ このサンドボックスのプロキシは Chromium→instagram.com を遮断する（実測 ERR_CONNECTION_RESET。
	// curl では届くのでアプリ側の問題ではない）。埋め込み «ページ» をスタブし、
	// iframe の生成・サイズ・重なり順（本アプリ側の責務）だけを目視検証する
	await context.route("**/www.instagram.com/**", (r) =>
	  r.fulfill({
	    contentType: "text/html",
	    // #1375（案 A）**実物の Instagram `/embed/` と同じ «積み方» にしてあるスタブ。**
	    // 実機 Detox の動画のコマを実測した内訳（セル幅 320 のとき）を再現している:
	    //   ヘッダ帯 17px 相当（幅の 5.3%）→ 写真（幅いっぱいの正方形〜4:5）→ いいね欄・コメント欄・白帯。
	    // 切り取り（features/dishMedia/embedCrop.ts）が効いているかは、
	    // **この白い部分が 1px も見えないこと**で判定する。中央に置いた「▶」は
	    // Instagram 自前の再生ボタンの位置を表す（こちらの再生ボタンと重なっていないかの確認用）
	    body: `<html><body style="margin:0;background:#fff;font-family:sans-serif"><div style="height:5.3vw;background:#fff;border-bottom:1px solid #dbdbdb;display:flex;align-items:center;gap:6px;padding:0 8px;box-sizing:border-box"><div style="width:3.5vw;height:3.5vw;border-radius:50%;background:#E1306C"></div><div style="font-size:2.2vw;color:#262626">msg.eatokyo</div><div style="margin-left:auto;font-size:2vw;color:#0095f6">Instagramで表示</div></div><div style="width:100vw;height:100vw;background:linear-gradient(160deg,#8B2E1F,#D9531E 45%,#7A2414);position:relative"><div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:16vw;height:16vw;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;display:flex;align-items:center;justify-content:center;font-size:7vw">&#9654;</div></div><div style="padding:8px;background:#fff"><div style="font-size:3vw;color:#262626">&#9825; &#9836; &#8599;</div><div style="font-size:2.4vw;font-weight:700;margin-top:6px">いいね！169,527件</div><div style="font-size:2.4vw;color:#8e8e8e;margin-top:6px">コメントを追加…</div><div style="height:30vh;background:#fff"></div></div></body></html>`,
	  }),
	);
	await context.route("**/localhost:9999/**", (r) => {
	  const u = new URL(r.request().url());
	  const p = u.pathname;
	  const env = (data) => r.fulfill({ json: { success: true, data } });
	  if (p.endsWith("/health")) return env({ status: "ok" });
	  if (p.endsWith("/v1/users/me/dishes")) return env({ data: page1, nextCursor: null, meta: { oldestOccurredAt: iso(1, 1) } });
	  // #1375 5 巡目: Map ビューの下帯（店名 + 緑/赤の内訳バッジ + 凡例）を撮るため
	  if (p.endsWith("/v1/users/me/dishes/map-pins"))
	    return env({
	      data: [
	        { restaurant: { id: "r-1", name: "醤油ラーメン一番", image_url: "https://img.example.invalid/r.jpg", location: { latitude: 35.68, longitude: 139.76 }, latitude: 35.68, longitude: 139.76 }, counts: { want: 2, eaten: 3 }, latestOccurredAt: iso(0, 20), representativeThumbnailUrl: "https://img.example.invalid/t.jpg" },
	        { restaurant: { id: "r-2", name: "寿司処 まえだ", image_url: null, location: { latitude: 35.69, longitude: 139.77 }, latitude: 35.69, longitude: 139.77 }, counts: { want: 1, eaten: 0 }, latestOccurredAt: iso(0, 14), representativeThumbnailUrl: null },
	        { restaurant: { id: "r-3", name: "カレーの店 ボンベイ", image_url: "https://img.example.invalid/r.jpg", location: { latitude: 35.67, longitude: 139.75 }, latitude: 35.67, longitude: 139.75 }, counts: { want: 0, eaten: 4 }, latestOccurredAt: iso(0, 11), representativeThumbnailUrl: "https://img.example.invalid/t.jpg" },
	      ],
	      truncated: false,
	    });
	  if (p.endsWith("/v1/dish-media/imports/resolve")) return env(resolveResponse);
	  if (p.endsWith("/v1/dish-media") && u.searchParams.has("ids")) {
	    // 要求された id を echo する（id が食い違うとフィード側の突き合わせで 0 件になる）
	    const ids = (u.searchParams.get("ids") ?? "").split(",").filter(Boolean);
	    return env({
	      items: ids.map((id) => ({ ...EMBED_ENTRY, dish_media: { ...EMBED_ENTRY.dish_media, id } })),
	      notFound: [],
	    });
	  }
	  // #1375 5 巡目: 食べたを記録タブの店名検索と «このお店の写真から選ぶ»
	  if (p.endsWith("/v1/restaurants/search"))
	    return env([
	      { restaurant: { id: "r-1", name: "醤油ラーメン一番", imageUrls: { sm: "https://img.example.invalid/r.jpg" } }, meta: { averageRating: 4.2, reviewCount: 12 } },
	      { restaurant: { id: "r-2", name: "らーめん 大和", imageUrls: { sm: "https://img.example.invalid/r.jpg" } }, meta: { averageRating: 3.9, reviewCount: 4 } },
	    ]);
	  if (/\/v1\/restaurants\/[^/]+\/dish-media$/.test(p))
	    return env({
	      data: [1, 2, 3, 4].map((n) => ({
	        restaurant: { id: "r-1", name: "醤油ラーメン一番" },
	        dish: { id: `dish-${n}`, category_id: `cat-${n}`, name: ["味玉ラーメン", "つけ麺", "チャーシュー丼", "餃子"][n - 1], reviewCount: n, averageRating: 4 },
	        dish_media: { id: `dm-${n}`, isMine: false, isSaved: false, isLiked: false, likeCount: 0, mediaUrl: "https://img.example.invalid/m.jpg", thumbnailImageUrl: "https://img.example.invalid/t.jpg", media_type: "image" },
	        dish_reviews: [],
	      })),
	      nextCursor: null,
	    });
	  if (p.includes("/v1/logs")) return env({});
	  return env({});
	});
}

/*
#1375（案 A）**取り込んだリールがフィードで «写真が全画面に出る» ことの録画。**

ui-preview.mjs と同じモック（Supabase 匿名サインイン / backend / Google Maps /
Instagram の埋め込みスタブ）を共有し、**録画だけ**を目的に切り出したもの。

⚠️ ここで映るのは web ビルド（react-native-web）である。ネイティブの実機は
Detox（e2e-mobile-test.yml の record_videos）で別途撮る。**この動画を
「実機で確認した」と提示してはいけない。**

デバイスは 2 つ撮る:
  - android … Pixel 7 相当（Chromium）
  - ios     … iPhone 14 相当のビューポート（同じ Chromium。WebKit は別途要インストール）
*/
const PRESETS = {
  android: { name: "android", viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6 },
  ios: { name: "ios", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
};

const OUT = process.env.EVIDENCE_OUT ?? "/tmp/claude-artifacts/evidence";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

for (const preset of Object.values(PRESETS)) {
  const context = await browser.newContext({
    viewport: preset.viewport,
    deviceScaleFactor: preset.deviceScaleFactor,
    locale: "ja-JP",
    recordVideo: { dir: `${OUT}/raw-${preset.name}`, size: preset.viewport },
  });
  await installMocks(context);
  // #1375 チュートリアル（初回だけ自動で開くスポットライト）が最前面に出ると
  // 以降のタップを全部横取りする（実測: my-dishes-tutorial-overlay intercepts pointer events）。
  // 撮りたいのは «取り込んだリールの見た目» なので、既読状態にしてから開く
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("my_dishes_spotlight_tutorial_seen_v1", "true");
      window.localStorage.setItem("search_tutorial_seen_v1", "true");
    } catch {
      /* プライベートモード等で localStorage が使えなくても撮影は続ける */
    }
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`PAGEERR(${preset.name}):`, String(e).slice(0, 160)));

  const goto = async (path) =>
    page.goto("http://localhost:8081" + path, { waitUntil: "domcontentloaded", timeout: 180000 });

  // 実ユーザー経路: カレンダー → 日付タップ → フィード（client-side 遷移で store を保つ）
  await goto("/ja-JP/my-dishes?view=calendar");
  await page
    .getByTestId("my-dishes-calendar-list")
    .waitFor({ timeout: 120000 })
    .catch((e) => console.log("cal wait:", e.message));
  await page.waitForTimeout(3000);
  await page
    .getByTestId("my-dishes-calendar-day")
    .first()
    .click()
    .catch((e) => console.log("day click:", e.message));
  // 埋め込みが読み込まれて «写真が全面に出る» までを見せる
  await page.waitForTimeout(7000);
  console.log(`${preset.name}: iframes =`, await page.locator("iframe").count());
  // 再生ボタン（= セル全面のタップ受け）を押して操作モードへ入るところまで撮る
  await page
    .getByTestId("external-embed-open-browser")
    .first()
    .click()
    .catch((e) => console.log("play:", e.message));
  await page.waitForTimeout(4000);

  await page.screenshot({ path: `${OUT}/embed-crop-${preset.name}.png` });
  await context.close();
  const video = await page.video();
  if (video) {
    await video.saveAs(`${OUT}/embed-crop-${preset.name}.webm`);
    console.log("saved", `${OUT}/embed-crop-${preset.name}.webm`);
  }
}

await browser.close();
