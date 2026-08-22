import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
const dir = "/tmp/claude-0/-home-user-nanitabeyo/774ef443-d249-52f1-a6ef-48ee3c4b416f/scratchpad/shots";
mkdirSync(dir, { recursive: true });
const now = Math.floor(Date.now() / 1000);
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "", is_anonymous: true, app_metadata: { provider: "anonymous", providers: ["anonymous"] }, user_metadata: {}, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
const session = { access_token: "e.e.e", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "r", user };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
const MAPS_STUB = `(function(){function F(){}window.google={maps:{Map:function(){this.controls=[[],[],[],[],[],[],[],[],[],[],[],[],[],[]];this.setOptions=function(){};this.addListener=function(){return{remove:function(){}}};this.setCenter=function(){};this.setZoom=function(){};this.getDiv=function(){return document.createElement('div')};this.panTo=function(){};this.fitBounds=function(){};this.getCenter=function(){return{lat:function(){return 35},lng:function(){return 139}}};this.getZoom=function(){return 12};this.getBounds=function(){return null};},Marker:F,InfoWindow:F,LatLng:function(a,b){return{lat:function(){return a},lng:function(){return b}}},LatLngBounds:function(){return{extend:function(){}}},Size:F,Point:F,event:{addListener:function(){return{remove:function(){}}},addListenerOnce:function(){return{remove:function(){}}},removeListener:function(){},trigger:function(){}},ControlPosition:{},MapTypeId:{ROADMAP:'roadmap'},MVCObject:F,OverlayView:F,places:{}}};if(window.initMap)window.initMap();})();`;

const pad2 = (v) => (v < 10 ? `0${v}` : String(v));
const d = new Date();
const iso = (day) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day, 3)).toISOString();
const dm = (n) => ({
  id: `dm-${n}`, dish_id: `dish-${n}`, user_id: user.id, media_path: null,
  media_processing_status: "completed", media_type: "image", render_type: "stored",
  thumbnail_path: "x/t.jpg", thumbnail_processing_status: "processing", video_duration_ms: null,
  created_at: iso(2), updated_at: iso(2), lock_no: 0,
});
const item = (n, day) => ({
  key: `k-${n}`, status: "eaten", occurredAt: iso(day), savedAt: null, eatenAt: iso(day),
  restaurant: { id: `r-${n}`, name: `店${n}`, image_url: "https://img.example.invalid/r.jpg" },
  dish: { id: `dish-${n}`, name: "ラーメン", reviewCount: 1, averageRating: 4, categoryImageUrl: "https://img.example.invalid/c.jpg" },
  dishMedia: { id: `dm-${n}`, thumbnailImageUrl: "https://img.example.invalid/t.jpg", mediaImageUrl: null, mediaType: "image" },
  myReview: null, distanceMeters: null,
});
// day 2 has 2 items, day 5 has 1
const rows = [item(1, 2), item(2, 2), item(3, 5)];
const entry = (n) => ({
  restaurant: { id: `r-${n}`, name: `店${n}`, latitude: 35.6, longitude: 139.7, image_url: "https://img.example.invalid/r.jpg", imageUrls: { sm: "https://img.example.invalid/r.jpg" } },
  dish: { id: `dish-${n}`, restaurant_id: `r-${n}`, category_id: "Q123", name: "ラーメン", created_at: iso(2), updated_at: iso(2), lock_no: 0, reviewCount: 1, averageRating: 4 },
  dish_media: { ...dm(n), isMine: false, isSaved: true, isLiked: false, likeCount: 3, mediaUrl: "https://img.example.invalid/m.jpg", thumbnailImageUrl: "https://img.example.invalid/t.jpg", externalEmbed: null },
  dish_reviews: [],
});

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ja-JP" });
await context.route("**/example.supabase.co/**", (r) => r.fulfill({ json: r.request().url().includes("/auth/v1/user") ? user : session }));
await context.route("**/maps.googleapis.com/**", (r) => r.fulfill({ contentType: "application/javascript", body: MAPS_STUB }));
await context.route("**/img.example.invalid/**", (r) => r.fulfill({ contentType: "image/png", body: PNG }));
await context.route("**/localhost:9999/**", (r) => {
  const u = new URL(r.request().url());
  const p = u.pathname;
  const env = (data) => r.fulfill({ json: { success: true, data } });
  if (p.endsWith("/health")) return env({ status: "ok" });
  if (p.endsWith("/v1/users/me/dishes")) return env({ data: rows, nextCursor: null, meta: { oldestOccurredAt: iso(1) } });
  if (p.endsWith("/v1/dish-media")) {
    const ids = u.searchParams
      .getAll("ids[]")
      .concat(u.searchParams.getAll("ids"))
      .flatMap((v) => v.split(","));
    console.log("dish-media ids:", ids);
    return r.fulfill({ json: { success: true, data: { items: ids.map((id) => entry(id.replace("dm-", ""))) } } });
  }
  return env({});
});
const page = await context.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("ERR:", m.text().slice(0, 200)); });
page.on("pageerror", (e) => console.log("PAGEERR:", String(e).slice(0, 300)));

await page.goto("http://localhost:8081/ja-JP/my-dishes?view=calendar", { waitUntil: "domcontentloaded", timeout: 180000 });
await page.getByTestId("my-dishes-calendar-list").waitFor({ timeout: 120000 });
await page.waitForTimeout(2000);
// tap the day cell for day 2 (has 2 items)
const days = page.getByTestId("my-dishes-calendar-day");
console.log("day cells:", await days.count());
await days.nth(1).click();
await page.waitForTimeout(4000);
await page.screenshot({ path: `${dir}/feed-after-day-tap.png` });
// 縦フリック（次の記録がある日へ）
await page.mouse.move(195, 500);
await page.mouse.wheel(0, 800);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${dir}/feed-after-vertical-swipe.png` });
console.log("URL:", page.url());
const body = (await page.innerText("body")).replace(/\s+/g, " ").slice(0, 200);
console.log("BODY:", body);
// check testids present
for (const t of ["my-dishes-feed-screen", "my-dishes-feed-pager", "my-dishes-feed-loading", "my-dishes-feed-empty", "my-dishes-feed-error"]) {
  console.log(t, await page.getByTestId(t).count());
}
await browser.close();
