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
const user = {
	id: "00000000-0000-4000-8000-000000000001",
	aud: "authenticated",
	role: "authenticated",
	email: "preview@example.com",
	is_anonymous: false,
	app_metadata: { provider: "anonymous", providers: ["anonymous"] },
	user_metadata: {},
	identities: [],
	created_at: new Date().toISOString(),
	updated_at: new Date().toISOString(),
};
const session = {
	access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4IiwiZXhwIjo5OTk5OTk5OTk5fQ.x",
	token_type: "bearer",
	expires_in: 3600,
	expires_at: now + 3600,
	refresh_token: "r",
	user,
};

// 1x1 PNG (orange-ish) data
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
	"base64",
);

const pad2 = (v) => (v < 10 ? `0${v}` : String(v));
const d = new Date();
const ym = (n) => {
	const a = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 15, 3));
	return a;
};
const iso = (n, day) => {
	const a = ym(n);
	return new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), day, 3)).toISOString();
};
// #1375 5 巡目: status を引数にした（緑=食べたい / 赤=食べた の内訳バッジを撮るため。
// 既定は従来どおり "eaten" なので、既存の呼び出しの見え方は変わらない）
// #1375（9 巡目）`provider` を渡すと «SNS から取り込んだ行» になる（一覧のロゴの確認用）。
// 既定は undefined なので、既存の呼び出しの見え方は変わらない
const item = (key, occurredAt, withMedia, cat = ["Q1", "ラーメン"], status = "eaten", provider) => ({
	key,
	status,
	occurredAt,
	savedAt: status === "want" ? occurredAt : null,
	eatenAt: status === "eaten" ? occurredAt : null,
	restaurant: { id: "r-1", name: "醤油ラーメン一番", image_url: "https://img.example.invalid/r.jpg" },
	dish: {
		id: `dish-${key}`,
		category_id: cat[0],
		name: cat[1],
		reviewCount: 3,
		averageRating: 4.2,
		categoryImageUrl: "https://img.example.invalid/c.jpg",
	},
	dishMedia: withMedia
		? {
				id: `dm-${key}`,
				thumbnailImageUrl: "https://img.example.invalid/t.jpg",
				mediaImageUrl: "https://img.example.invalid/m.jpg",
				mediaType: "image",
				render_type: provider ? "external_embed" : "stored",
				...(provider
					? {
							externalEmbed: {
								provider,
								externalContentId: "abc",
								canonicalUrl: "https://x/",
								embedStatus: "available",
								lastVerifiedAt: null,
							},
						}
					: {}),
			}
		: null,
	myReview: null,
	distanceMeters: null,
});
// this month: several days with records; last month: a few
const page1 = [
	// #1375 9 巡目: 先頭を «Instagram から取り込んだ行» にする（一覧のロゴがここに出る）
	item("a", iso(0, 2), true, ["Q1", "ラーメン"], "eaten", "instagram"),
	item("b", iso(0, 5), true),
	item("b2", iso(0, 5), true),
	item("c", iso(0, 11), true),
	item("d", iso(0, 14), false),
	item("e", iso(0, 20), true),
	item("f", iso(1, 3), true),
	item("g", iso(1, 9), true),
	item("h", iso(1, 22), true),
	// #1375 5 巡目: 同じ日に «食べたい» と «食べた» が混ざる日を作る（日バッジが緑と赤に割れる）
	item("w1", iso(0, 5), true, ["Q1", "ラーメン"], "want"),
	item("w2", iso(0, 5), true, ["Q2", "寿司"], "want"),
	item("w3", iso(0, 11), true, ["Q3", "カレー"], "want"),
	item("w4", iso(0, 18), true, ["Q4", "うどん"], "want"),
	// #1375 4 巡目: 料理カテゴリー絞り込みの「もっと見る」を出すため 10 カテゴリー以上にする
	...[
		["Q2", "寿司"],
		["Q3", "カレー"],
		["Q4", "うどん"],
		["Q5", "そば"],
		["Q6", "天ぷら"],
		["Q7", "焼き鳥"],
		["Q8", "餃子"],
		["Q9", "パスタ"],
		["Q10", "ハンバーガー"],
		["Q11", "牛丼"],
	].map((cat, i) => item(`cat-${cat[0]}`, iso(0, 3 + (i % 20)), true, cat)),
];

// #1505 グループ投票の履歴一覧（自分が主催した投票だけ）。
// 「勝者が決まった行 / 未決の行 / 候補 4 件以上（+N）/ 候補 0 件 / 画像が読めない行」を
// 1 画面に並べ、**どの状態でも行の高さと左端が揃うこと**を目で見るための材料。
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const cand = (name, host = "img.example.invalid") => ({
	displayName: name,
	imageUrl: `https://${host}/${encodeURIComponent(name)}.jpg`,
});
const groupVote = (o) => ({
	id: o.id,
	shareToken: `share-${o.id}`,
	hasVoted: o.hasVoted ?? false,
	candidateCount: o.candidateCount,
	candidatePreviews: o.candidatePreviews,
	participantCount: o.participantCount,
	winnerName: o.winnerName ?? null,
	createdAt: o.updatedAt,
	updatedAt: o.updatedAt,
});
const GROUP_VOTE_ITEMS = [
	// 勝者が決まっている（1 行目は料理名が太字。未投票ドットは出ない）
	groupVote({
		id: "decided",
		hasVoted: true,
		candidateCount: 3,
		participantCount: 5,
		winnerName: "八王子ラーメン",
		candidatePreviews: [cand("八王子ラーメン"), cand("寿司"), cand("カレー")],
		updatedAt: hoursAgo(50),
	}),
	// 未決 + 候補 6 件（+3 が出る）+ 自分は未投票（ドットが出る）
	groupVote({
		id: "undecided",
		candidateCount: 6,
		participantCount: 2,
		candidatePreviews: [cand("うどん"), cand("そば"), cand("天ぷら")],
		updatedAt: hoursAgo(5),
	}),
	// 画像が読めない行（img.broken.invalid はモックしていない）。同寸法のプレースホルダが残るはず
	groupVote({
		id: "broken-image",
		candidateCount: 2,
		participantCount: 0,
		candidatePreviews: [cand("焼き鳥", "img.broken.invalid"), cand("餃子", "img.broken.invalid")],
		updatedAt: hoursAgo(1),
	}),
	// 候補が 1 件も無い（全部削除された）行。左端が揃うか
	groupVote({
		id: "no-candidates",
		candidateCount: 0,
		participantCount: 0,
		candidatePreviews: [],
		updatedAt: hoursAgo(0.2),
	}),
	// 長い料理名（1 行に収まらない）で行が崩れないか
	groupVote({
		id: "long-name",
		hasVoted: true,
		candidateCount: 4,
		participantCount: 12,
		winnerName: "特製濃厚豚骨魚介つけ麺（全部のせ・大盛り）",
		candidatePreviews: [cand("つけ麺"), cand("ハンバーガー"), cand("パスタ")],
		updatedAt: hoursAgo(24 * 40),
	}),
];
let groupVoteItems = GROUP_VOTE_ITEMS;

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
		id: "r-embed",
		name: "中華そば専門店 八王子ラーメンよしだ",
		name_language_code: "ja",
		image_url: "https://img.example.invalid/r.jpg",
		image_path: null,
		google_place_id: "place_embed",
		created_at: "2026-08-01T00:00:00Z",
		latitude: 35.6577,
		longitude: 139.341,
		location: null,
		address_components: null,
		plus_code: null,
	},
	dish: {
		id: "dish-embed",
		name: "ラーメン",
		restaurant_id: "r-embed",
		category_id: "Q1",
		created_at: "2026-08-01T00:00:00Z",
		updated_at: "2026-08-01T00:00:00Z",
		lock_no: 1,
		reviewCount: 0,
		averageRating: 0,
	},
	dish_media: {
		id: "media-embed-1",
		dish_id: "dish-embed",
		media_path: null,
		thumbnail_path: "",
		media_type: "image",
		user_id: null,
		lock_no: 1,
		created_at: "2026-08-01T00:00:00Z",
		updated_at: "2026-08-01T00:00:00Z",
		media_processing_status: "completed",
		thumbnail_processing_status: "completed",
		render_type: "external_embed",
		// #1375 10 巡目: «食べたい» «食べた» の両方が押してある状態を撮る（オレンジ塗りの確認）
		isSaved: true,
		isLiked: false,
		likeCount: 0,
		isMine: false,
		isEaten: true,
		mediaUrl: null,
		thumbnailImageUrl: "https://img.example.invalid/t.jpg",
		video_duration_ms: null,
		externalEmbed: {
			provider: "instagram",
			externalContentId: "DZnIRziT70s",
			canonicalUrl: "https://www.instagram.com/reel/DZnIRziT70s/",
			embedStatus: "available",
			lastVerifiedAt: null,
			thumbnailUrl: "https://img.example.invalid/t.jpg",
		},
	},
	dish_reviews: [],
};

const resolveResponse = {
	status: "ok",
	reason: "resolved",
	source: {
		provider: "instagram",
		externalContentId: "DZFdePPzzLI",
		canonicalUrl: "https://www.instagram.com/reel/DZFdePPzzLI/",
		mediaIndex: null,
	},
	metadata: {
		title: LONG_CAPTION,
		authorName: "umaguru.tokyo",
		authorUrl: null,
		thumbnailUrl: null,
		extractedTexts: [],
	},
	candidates: {
		dishCategories: [
			{ dishCategoryId: "Q177", labelEn: "Ramen", labels: { ja: "ラーメン" } },
			{ dishCategoryId: "Q188", labelEn: "Miso ramen", labels: { ja: "味噌ラーメン" } },
		],
		restaurants: [
			{ restaurantId: "r-1", name: "麺屋 いちばん 本店" },
			{ restaurantId: "r-2", name: "らーめん 大和" },
		],
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
const context = await browser.newContext({
	viewport: { width: 390, height: 844 },
	deviceScaleFactor: 2,
	locale: "ja-JP",
});
// 匿名サインイン（/auth/v1/signup）を成功させる。セッション注入より確実
await context.route("**/example.supabase.co/**", (r) => {
	const u = r.request().url();
	if (u.includes("/auth/v1/user")) return r.fulfill({ json: user });
	return r.fulfill({ json: session });
});
await context.route("**/maps.googleapis.com/**", (r) => {
	if (r.request().url().includes("/maps/api/js"))
		return r.fulfill({ contentType: "application/javascript", body: MAPS_STUB });
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
	if (p.endsWith("/v1/users/me/dishes"))
		return env({ data: page1, nextCursor: null, meta: { oldestOccurredAt: iso(1, 1) } });
	// #1505 グループ投票の履歴一覧。空状態も撮れるよう、返す配列は下のシナリオから差し替える
	if (p.endsWith("/v1/users/me/dish-category-group-votes")) return env({ data: groupVoteItems, nextCursor: null });
	// #1375 5 巡目: Map ビューの下帯（店名 + 緑/赤の内訳バッジ + 凡例）を撮るため
	if (p.endsWith("/v1/users/me/dishes/map-pins"))
		return env({
			data: [
				{
					restaurant: {
						id: "r-1",
						name: "醤油ラーメン一番",
						image_url: "https://img.example.invalid/r.jpg",
						location: { latitude: 35.68, longitude: 139.76 },
						latitude: 35.68,
						longitude: 139.76,
					},
					counts: { want: 2, eaten: 3 },
					latestOccurredAt: iso(0, 20),
					representativeThumbnailUrl: "https://img.example.invalid/t.jpg",
				},
				{
					restaurant: {
						id: "r-2",
						name: "寿司処 まえだ",
						image_url: null,
						location: { latitude: 35.69, longitude: 139.77 },
						latitude: 35.69,
						longitude: 139.77,
					},
					counts: { want: 1, eaten: 0 },
					latestOccurredAt: iso(0, 14),
					representativeThumbnailUrl: null,
				},
				{
					restaurant: {
						id: "r-3",
						name: "カレーの店 ボンベイ",
						image_url: "https://img.example.invalid/r.jpg",
						location: { latitude: 35.67, longitude: 139.75 },
						latitude: 35.67,
						longitude: 139.75,
					},
					counts: { want: 0, eaten: 4 },
					latestOccurredAt: iso(0, 11),
					representativeThumbnailUrl: "https://img.example.invalid/t.jpg",
				},
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
			{
				restaurant: { id: "r-1", name: "醤油ラーメン一番", imageUrls: { sm: "https://img.example.invalid/r.jpg" } },
				meta: { averageRating: 4.2, reviewCount: 12 },
			},
			{
				restaurant: { id: "r-2", name: "らーめん 大和", imageUrls: { sm: "https://img.example.invalid/r.jpg" } },
				meta: { averageRating: 3.9, reviewCount: 4 },
			},
		]);
	if (/\/v1\/restaurants\/[^/]+\/dish-media$/.test(p))
		return env({
			data: [1, 2, 3, 4].map((n) => ({
				restaurant: { id: "r-1", name: "醤油ラーメン一番" },
				dish: {
					id: `dish-${n}`,
					category_id: `cat-${n}`,
					name: ["味玉ラーメン", "つけ麺", "チャーシュー丼", "餃子"][n - 1],
					reviewCount: n,
					averageRating: 4,
				},
				dish_media: {
					id: `dm-${n}`,
					isMine: false,
					isSaved: false,
					isLiked: false,
					likeCount: 0,
					mediaUrl: "https://img.example.invalid/m.jpg",
					thumbnailImageUrl: "https://img.example.invalid/t.jpg",
					media_type: "image",
				},
				dish_reviews: [],
			})),
			nextCursor: null,
		});
	// #1671 新規店舗の確認ページの下読み（保存しない）
	if (p.endsWith("/v1/restaurants/draft"))
		return env({
			draft: {
				googlePlaceId: "ChIJpreview1",
				name: "醤油ラーメン一番 渋谷店",
				nameLanguageCode: "ja",
				latitude: 35.6595,
				longitude: 139.7005,
				addressComponents: [],
				address: "東京都渋谷区神南1-2-3",
				countryCode: "JP",
				countryName: "日本",
			},
			draftToken: "rdt1.preview.token",
		});
	if (p.includes("/v1/logs")) return env({});
	return env({});
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERR:", String(e).slice(0, 200)));

const shot = async (name) => {
	await page.screenshot({ path: `${dir}/${name}.png` });
	console.log("shot", name);
};
const goto = async (path) => {
	await page.goto("http://localhost:8081" + path, { waitUntil: "domcontentloaded", timeout: 180000 });
};

// ─── 撮影シナリオ（撮りたい画面・状態はここへ足す） ───

// 0. my-dishes のチュートリアル（#1375 5 巡目: 初見の人へ画面の使い方を指す）
// ⚠️ 初回起動でしか自動で開かないので、**一番最初に**撮ること
await goto("/ja-JP/my-dishes");
await page
	.getByTestId("my-dishes-tutorial-overlay")
	.first()
	.waitFor({ timeout: 60000 })
	.catch((e) => console.log("tutorial wait:", e.message));
await page.waitForTimeout(1500);
await shot("tutorial-1-views");
for (const step of ["2-openFeed", "3-add", "4-filter"]) {
	await page
		.getByTestId("my-dishes-tutorial-next")
		.click()
		.catch((e) => console.log("next:", e.message));
	await page.waitForTimeout(1200);
	await shot(`tutorial-${step}`);
}
await page
	.getByTestId("my-dishes-tutorial-finish")
	.click()
	.catch((e) => console.log("finish:", e.message));
await page.waitForTimeout(800);

// 0b. 一覧（3 列グリッド）。#1375 5 巡目デザインレビュー #2/#9 でタイルの密度を落とし、
// 「食べたを記録」を «全幅の赤いピル» から «内容幅の半透明黒» へ変えた結果を確かめる
await page.waitForTimeout(2000);
await shot("list-grid");
// want タイル（「食べたを記録」の CTA が出るのは want だけ）まで送る
await page.mouse.wheel(0, 900);
await page.waitForTimeout(1200);
await shot("list-grid-want");

// 1. calendar
await goto("/ja-JP/my-dishes?view=calendar");
await page
	.getByTestId("my-dishes-calendar-list")
	.waitFor({ timeout: 120000 })
	.catch((e) => console.log("calendar wait:", e.message));
await page.waitForTimeout(3000);
await shot("calendar");
// 1b. calendar の最下部（凡例）
await page
	.getByTestId("my-dishes-calendar-legend")
	.first()
	.waitFor({ timeout: 30000 })
	.catch((e) => console.log("legend wait:", e.message));
await shot("calendar-legend");

// 1c. map（下帯の店名 + 緑/赤の内訳 + 凡例）
await goto("/ja-JP/my-dishes?view=map");
await page
	.getByTestId("my-dishes-map-sheet")
	.first()
	.waitFor({ timeout: 120000 })
	.catch((e) => console.log("map sheet wait:", e.message));
await page.waitForTimeout(2500);
await shot("map-sheet");

// 2. filters（先に一覧を訪れて store を満たす。カテゴリー候補は一覧のキャッシュから数える。
// ⚠️ goto() はフルリロードで store が消えるので、フィルタへは **画面内のボタンから** 遷移する）
await goto("/ja-JP/my-dishes");
await page.waitForTimeout(3000);
await page
	.getByTestId("my-dishes-filter-button")
	.click()
	.catch((e) => console.log("filter-btn:", e.message));
await page.waitForTimeout(1500);
await page
	.getByTestId("my-dishes-filter-screen")
	.first()
	.waitFor({ timeout: 120000 })
	.catch((e) => console.log("filters wait:", e.message));
await page.waitForTimeout(2000);
await shot("filters-default");
// #1375 4 巡目: カテゴリー「もっと見る」を開く
await page
	.getByTestId("my-dishes-filter-category-show-all")
	.click()
	.catch((e) => console.log("show-all:", e.message));
await page.waitForTimeout(400);
await shot("filters-categories-expanded");
// select 条件を選ぶ to reveal axes
await page
	.getByTestId("my-dishes-filter-sort--featureScore")
	.click()
	.catch((e) => console.log(e.message));
await page.waitForTimeout(500);
await shot("filters-feature-axes");
await page
	.getByTestId("my-dishes-filter-axis-time-slot")
	.click()
	.catch((e) => console.log(e.message));
await page.waitForTimeout(500);
await shot("filters-axis-open");
// #1375 4 巡目: 値を選ぶとプルダウンが閉じる（確定の見た目）
await page
	.getByTestId("my-dishes-filter-axis-time-slot-dinner")
	.click()
	.catch((e) => console.log("dinner:", e.message));
await page.waitForTimeout(500);
await shot("filters-axis-closed-after-select");

// 3. sns-import initial
await goto("/ja-JP/add-record");
await page
	.getByTestId("sns-import-screen")
	.waitFor({ timeout: 120000 })
	.catch((e) => console.log("sns wait:", e.message));
await page.waitForTimeout(2000);
await shot("sns-import-initial");
// paste + resolve
await page.getByTestId("sns-import-url-input").fill("https://www.tiktok.com/@a/video/7412345678901234567");
await page.getByTestId("sns-import-resolve-button").click();
await page.waitForTimeout(2500);
await shot("sns-import-resolved-top");
// #1375 4 巡目: キャプション「もっと見る」で全文を開く
await page
	.getByTestId("sns-import-caption-toggle")
	.click()
	.catch((e) => console.log("caption:", e.message));
await page.waitForTimeout(500);
await shot("sns-import-caption-expanded");
await page.mouse.wheel(0, 600);
await page.waitForTimeout(800);
await shot("sns-import-resolved-bottom");

// 3b. 食べたを記録タブ（#1375 5 巡目: 店選択の統一 + メディアの選び方）
await goto("/ja-JP/add-record");
await page
	.getByTestId("sns-import-screen")
	.waitFor({ timeout: 120000 })
	.catch((e) => console.log("sns wait:", e.message));
await page.waitForTimeout(1500);
await page
	.getByTestId("sns-import-tab-eaten")
	.click()
	.catch((e) => console.log("eaten tab:", e.message));
await page.waitForTimeout(1200);
await shot("eaten-pick-restaurant");
// 店名検索で 1 件選ぶ（restaurants/search をスタブしてある）
await page
	.getByTestId("sns-import-eaten-restaurant-search-input")
	.fill("ラーメン")
	.catch((e) => console.log("eaten search:", e.message));
await page.waitForTimeout(1200);
await page
	.getByTestId("sns-import-eaten-restaurant-search-result-0")
	.click()
	.catch((e) => console.log("eaten result:", e.message));
await page.waitForTimeout(2500);
await shot("eaten-media-step");

// 4. 取り込んだリールの再生（external_embed → web は iframe）。
// 実ユーザー経路: カレンダー → 日付タップ → フィード（client-side 遷移で store を保つ）
await goto("/ja-JP/my-dishes?view=calendar");
await page
	.getByTestId("my-dishes-calendar-list")
	.waitFor({ timeout: 120000 })
	.catch((e) => console.log("cal wait:", e.message));
await page.waitForTimeout(2500);
await page
	.getByTestId("my-dishes-calendar-day")
	.first()
	.click()
	.catch((e) => console.log("day click:", e.message));
await page.waitForTimeout(5000);
const iframeCount = await page.locator("iframe").count();
console.log("embed iframes:", iframeCount);
await shot("embed-feed");
await page.waitForTimeout(4000);
await shot("embed-feed-loaded");

// 5. #1505 グループ投票の履歴一覧（行の再設計 / 空状態）
groupVoteItems = GROUP_VOTE_ITEMS;
await goto("/ja-JP/profile/dish-category-group-votes");
await page
	.getByTestId("me-dish-category-group-votes-item")
	.first()
	.waitFor({ timeout: 120000 })
	.catch((e) => console.log("group-votes wait:", e.message));
await page.waitForTimeout(2500);
await shot("group-votes-list");

groupVoteItems = [];
await goto("/ja-JP/profile/dish-category-group-votes");
await page
	.getByTestId("me-dish-category-group-votes-empty-state")
	.waitFor({ timeout: 120000 })
	.catch((e) => console.log("group-votes empty wait:", e.message));
await page.waitForTimeout(1500);
await shot("group-votes-empty");

// 6. #1671 新規店舗の確認ページ（ダイアログではなくページ / 店名・場所・住所・国）
await goto("/ja-JP/my-dishes/confirm-restaurant?googlePlaceId=ChIJpreview1");
await page
	.getByTestId("confirm-restaurant-name")
	.waitFor({ timeout: 120000 })
	.catch((e) => console.log("confirm wait:", e.message));
await page.waitForTimeout(2500);
await shot("confirm-restaurant");

// 店名を直した状態（«確認して直せる» ことが分かる絵）
await page
	.getByTestId("confirm-restaurant-name")
	.fill("醤油ラーメン一番")
	.catch((e) => console.log("fill:", e.message));
await page.waitForTimeout(800);
await shot("confirm-restaurant-edited");

await browser.close();
