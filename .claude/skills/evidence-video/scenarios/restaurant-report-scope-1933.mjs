/*
#1933 「この情報が違う」報告で **何を報告できるようにするか**（①）を、画面を見て決めるための撮影。

論点: 提案していた 4 項目（店名 / 閉店 / 住所 / 位置）のうち、**住所と位置は店舗画面に
出ていない**。出ていないものは、ユーザーが «違う» と気づきようがない。
逆に #1666 で入った **営業時間**は画面に出ているのに、候補に入っていなかった。

撮るもの:
  01 データが揃っている店（店名・評価・営業時間が出ている状態）
  02 データが薄い店（評価 0 件 → 何も出さない / 営業時間なし）＝ 62 万店の既定の姿

⚠️ 認証・API はすべてモック。映るのは «画面の構成» であって実データではない。
*/
import { record, ok } from "./harness.mjs";

const NAME = process.env.EVIDENCE_NAME || "restaurant-report-scope-1933";
const PRESET = process.env.EVIDENCE_PRESET || "default";

const RICH = "restaurant-rich";
const BARE = "restaurant-bare";

const span = (opensAt, closesAt) => ({ opensAt, closesAt, crossesMidnight: false });
const HOURS = {
	days: [
		{ dayOfWeek: 0, spans: [span("11:00", "22:00")] },
		{ dayOfWeek: 1, spans: [span("11:00", "14:30"), span("17:00", "23:00")] },
		{ dayOfWeek: 2, spans: [span("11:00", "14:30"), span("17:00", "23:00")] },
		{ dayOfWeek: 3, spans: [] },
		{ dayOfWeek: 4, spans: [span("17:00", "23:00")] },
		{ dayOfWeek: 5, spans: [span("17:00", "23:00")] },
		{ dayOfWeek: 6, spans: [span("11:00", "23:00")] },
	],
	sources: ["official_site"],
	fetchedAt: "2026-09-20T02:00:00Z",
};

const detail = (id, name, meta) => ({
	restaurant: { id, name, imageUrls: { md: null }, google_place_id: `place-${id}` },
	meta: { averageRating: 0, reviewCount: 0, totalCents: 0, maxEndDate: null, ...meta },
});

await record({
	name: NAME,
	preset: PRESET,
	mock: (url) => {
		if (/\/v1\/restaurants\/[^/]+\/opening-hours/.test(url))
			return { body: ok(url.includes(RICH) ? HOURS : { days: [], sources: [], fetchedAt: null }) };
		if (/\/v1\/restaurants\/[^/]+\/dish-media/.test(url)) return { body: ok({ data: [], nextCursor: null }) };
		if (new RegExp(`/v1/restaurants/${RICH}(\\?.*)?$`).test(url))
			return { body: ok(detail(RICH, "焼肉うしごろ 表参道", { averageRating: 4.2, reviewCount: 12 })) };
		if (new RegExp(`/v1/restaurants/${BARE}(\\?.*)?$`).test(url))
			return { body: ok(detail(BARE, "スターバックス コーヒー 渋谷cocoti店", {})) };
		return null;
	},
	flow: async (page, shot) => {
		for (const [rid, tag] of [
			[RICH, "01-detail-rich"],
			[BARE, "02-detail-bare"],
		]) {
			await page.goto(`http://localhost:8788/ja-JP/restaurant/${rid}`, { waitUntil: "domcontentloaded" });
			await page.getByTestId("restaurant-detail-screen-title").waitFor({ timeout: 30_000 });
			await page.waitForTimeout(2000);
			await shot(tag);
		}
	},
});
