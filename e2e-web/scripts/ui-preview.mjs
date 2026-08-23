/*
UI プレビュー（スクリーンショット）ハーネス — docs/design-guidelines.md §5 の道具

## 何のためのものか

UI を変更したら、**納品前に自分でレンダリングして自分の目でレビューする**ための撮影スクリプト。
実 API・実 DB・実地図・実画像を一切使わずに、Expo の web dev server だけで画面を撮る。

## 使い方

1. ダミー env で dev server を起動する（実バックエンドへは一切つながらない）

   cd app-expo && cat > .env <<'ENV'
   EXPO_PUBLIC_SUPABASE_URL=https://example.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=dummy-anon-key
   EXPO_PUBLIC_BACKEND_BASE_URL=http://localhost:9999
   EXPO_PUBLIC_DB_SCHEMA=dev
   EXPO_PUBLIC_NODE_ENV=development
   EXPO_PUBLIC_WEB_BASE_URL=http://localhost:4173
   EXPO_PUBLIC_CDN_PUBLIC_HOST=https://example.com
   EXPO_PUBLIC_GCS_STATIC_MASTER_DIR_PATH=static
   EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY=dummy
   ENV
   npx expo start --web --port 8081

   ⚠️ 撮り終えたら app-expo/.env は必ず消すこと（残すと typecheck 用の
   .expo/types が dev server に再生成されるだけで害は無いが、紛らわしい）。

2. このスクリプトを叩く（e2e-web の依存で動く）

   cd e2e-web && node scripts/ui-preview.mjs

   スクリーンショットは OUT_DIR（下の定数）に PNG で出る。撮りたい画面・状態は
   下の «撮影シナリオ» ブロックを編集して増やす。

## モックの要点（ここを外すと «Loading...» のまま止まる）

- **Supabase**: 匿名サインイン（/auth/v1/signup）へ偽セッションを返す。
  localStorage へのセッション注入では動かない（実測）
- **Google Maps**: `AppProvider.web.tsx` の LoadScript がアプリ全体を包んでおり、
  Maps JS API が読めないと画面全体が LoadScript の既定フォールバック «Loading...» で
  止まる。スタブ JS を返し、**最後に window.initMap() を呼ぶ**こと（LoadScript は
  callback=initMap を付けてくる）
- **バックエンド**: BaseResponse の封筒 `{ success, data }` を忘れない。
  ページングは 2 段（`{ success, data: { data, nextCursor, meta } }`）
*/
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
const dir = process.env.UI_PREVIEW_OUT_DIR ?? "./ui-preview-shots";
mkdirSync(dir, { recursive: true });
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
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ja-JP" });
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
    body: `<html><body style="margin:0;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif"><div style="text-align:center"><div style="width:220px;height:220px;border:3px solid #E1306C;border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">▶ Instagram embed<br/>(stub)</div>DZnIRziT70s</div></body></html>`,
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
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERR:", String(e).slice(0, 200)));

const shot = async (name) => { await page.screenshot({ path: `${dir}/${name}.png` }); console.log("shot", name); };
const goto = async (path) => { await page.goto("http://localhost:8081" + path, { waitUntil: "domcontentloaded", timeout: 180000 }); };

// ─── 撮影シナリオ（撮りたい画面・状態はここへ足す） ───

// 1. calendar
await goto("/ja-JP/my-dishes?view=calendar");
await page.getByTestId("my-dishes-calendar-list").waitFor({ timeout: 120000 }).catch((e) => console.log("calendar wait:", e.message));
await page.waitForTimeout(3000);
await shot("calendar");
// 1b. calendar の最下部（凡例）
await page.getByTestId("my-dishes-calendar-legend").first().waitFor({ timeout: 30000 }).catch((e) => console.log("legend wait:", e.message));
await shot("calendar-legend");

// 1c. map（下帯の店名 + 緑/赤の内訳 + 凡例）
await goto("/ja-JP/my-dishes?view=map");
await page.getByTestId("my-dishes-map-sheet").first().waitFor({ timeout: 120000 }).catch((e) => console.log("map sheet wait:", e.message));
await page.waitForTimeout(2500);
await shot("map-sheet");

// 2. filters（先に一覧を訪れて store を満たす。カテゴリー候補は一覧のキャッシュから数える。
// ⚠️ goto() はフルリロードで store が消えるので、フィルタへは **画面内のボタンから** 遷移する）
await goto("/ja-JP/my-dishes");
await page.waitForTimeout(3000);
await page.getByTestId("my-dishes-filter-button").click().catch((e) => console.log("filter-btn:", e.message));
await page.waitForTimeout(1500);
await page.getByTestId("my-dishes-filter-screen").first().waitFor({ timeout: 120000 }).catch((e) => console.log("filters wait:", e.message));
await page.waitForTimeout(2000);
await shot("filters-default");
// #1375 4 巡目: カテゴリー「もっと見る」を開く
await page.getByTestId("my-dishes-filter-category-show-all").click().catch((e) => console.log("show-all:", e.message));
await page.waitForTimeout(400);
await shot("filters-categories-expanded");
// select 条件を選ぶ to reveal axes
await page.getByTestId("my-dishes-filter-sort--featureScore").click().catch((e) => console.log(e.message));
await page.waitForTimeout(500);
await shot("filters-feature-axes");
await page.getByTestId("my-dishes-filter-axis-time-slot").click().catch((e) => console.log(e.message));
await page.waitForTimeout(500);
await shot("filters-axis-open");
// #1375 4 巡目: 値を選ぶとプルダウンが閉じる（確定の見た目）
await page.getByTestId("my-dishes-filter-axis-time-slot-dinner").click().catch((e) => console.log("dinner:", e.message));
await page.waitForTimeout(500);
await shot("filters-axis-closed-after-select");

// 3. sns-import initial
await goto("/ja-JP/add-record");
await page.getByTestId("sns-import-screen").waitFor({ timeout: 120000 }).catch((e) => console.log("sns wait:", e.message));
await page.waitForTimeout(2000);
await shot("sns-import-initial");
// paste + resolve
await page.getByTestId("sns-import-url-input").fill("https://www.tiktok.com/@a/video/7412345678901234567");
await page.getByTestId("sns-import-resolve-button").click();
await page.waitForTimeout(2500);
await shot("sns-import-resolved-top");
// #1375 4 巡目: キャプション「もっと見る」で全文を開く
await page.getByTestId("sns-import-caption-toggle").click().catch((e) => console.log("caption:", e.message));
await page.waitForTimeout(500);
await shot("sns-import-caption-expanded");
await page.mouse.wheel(0, 600);
await page.waitForTimeout(800);
await shot("sns-import-resolved-bottom");

// 3b. 食べたを記録タブ（#1375 5 巡目: 店選択の統一 + メディアの選び方）
await goto("/ja-JP/add-record");
await page.getByTestId("sns-import-screen").waitFor({ timeout: 120000 }).catch((e) => console.log("sns wait:", e.message));
await page.waitForTimeout(1500);
await page.getByTestId("sns-import-tab-eaten").click().catch((e) => console.log("eaten tab:", e.message));
await page.waitForTimeout(1200);
await shot("eaten-pick-restaurant");
// 店名検索で 1 件選ぶ（restaurants/search をスタブしてある）
await page.getByTestId("sns-import-eaten-restaurant-search-input").fill("ラーメン").catch((e) => console.log("eaten search:", e.message));
await page.waitForTimeout(1200);
await page.getByTestId("sns-import-eaten-restaurant-search-result-0").click().catch((e) => console.log("eaten result:", e.message));
await page.waitForTimeout(2500);
await shot("eaten-media-step");

// 4. 取り込んだリールの再生（external_embed → web は iframe）。
// 実ユーザー経路: カレンダー → 日付タップ → フィード（client-side 遷移で store を保つ）
await goto("/ja-JP/my-dishes?view=calendar");
await page.getByTestId("my-dishes-calendar-list").waitFor({ timeout: 120000 }).catch((e) => console.log("cal wait:", e.message));
await page.waitForTimeout(2500);
await page.getByTestId("my-dishes-calendar-day").first().click().catch((e) => console.log("day click:", e.message));
await page.waitForTimeout(5000);
const iframeCount = await page.locator("iframe").count();
console.log("embed iframes:", iframeCount);
await shot("embed-feed");
await page.waitForTimeout(4000);
await shot("embed-feed-loaded");

await browser.close();
