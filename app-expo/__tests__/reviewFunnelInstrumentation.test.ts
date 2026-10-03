import fs from "node:fs";
import path from "node:path";

/**
 * #1264 【設計】**レビュー投稿のファネルは «同じビルドの中で» 数えられること。**
 *
 * 2026-09-23、«どこで落ちているか» を測ろうとして測れなかった。理由は 2 つあり、
 * どちらも «形» の問題なのでここで固定する。
 *
 * 1. 画面が開いたことを «API を叩いて成功したとき» にしか記録していなかった。
 *    キャッシュがあると early return するので、本番 90 日で
 *    `restaurant_detail_loaded` / `review_screen_restaurant_loaded` は **0 行**、
 *    `fromCache: true` は **一度も**出ていなかった
 * 2. 旧ビルドだけが出しているイベント（`screen: "review"` / `review_post_button_clicked`）を
 *    現行のイベントと縦に並べると、世代の違うものを混ぜた偽のファネルになる
 *
 * したがって: ファネルの各画面は、リポジトリ既存の慣習 `screen_view` + `payload.screen` を
 * **無条件に**出す。名前は旧ビルドのものと衝突させない。
 */

const APP_DIR = path.join(__dirname, "..", "app");

/** ファネルの各段 → その画面が名乗る `payload.screen` */
const FUNNEL: Record<string, string> = {
	"[locale]/restaurant/[restaurantId].tsx": "restaurant_detail",
	"[locale]/restaurant/[restaurantId]/review.tsx": "review_form",
	"[locale]/restaurant/[restaurantId]/review-from-media/[dishMediaId].tsx": "review_from_media",
};

/**
 * 旧ビルドが出していて、現行コードに出所が無い名前。
 * **再利用すると、世代の違う数字が 1 つの名前に混ざって二度と分離できなくなる。**
 */
const RESERVED_BY_OLD_BUILDS = ["review"];

const read = (relative: string) => fs.readFileSync(path.join(APP_DIR, relative), "utf8");

describe("#1264 レビュー投稿ファネルの計測", () => {
	it.each(Object.entries(FUNNEL))("%s が screen_view を出す", (relative, screen) => {
		const source = read(relative);
		expect(source).toContain('event_name: "screen_view"');
		expect(source).toContain(`screen: "${screen}"`);
	});

	it.each(Object.entries(FUNNEL))("%s の screen_view が条件分岐の中に無い", (relative) => {
		const source = read(relative);
		// screen_view を出す useEffect は «早期 return を持たない» こと。
		// 直前の useEffect 本体に `return;` があると、キャッシュ時に記録が落ちる形へ戻る。
		const at = source.indexOf('event_name: "screen_view"');
		const effectStart = source.lastIndexOf("useEffect(() => {", at);
		expect(effectStart).toBeGreaterThan(-1);
		expect(source.slice(effectStart, at)).not.toMatch(/\breturn\b/);
	});

	it("旧ビルドの screen 名を再利用していない", () => {
		for (const screen of Object.values(FUNNEL)) {
			expect(RESERVED_BY_OLD_BUILDS).not.toContain(screen);
		}
	});

	it("screen 名が重複していない（段を見分けられること）", () => {
		const names = Object.values(FUNNEL);
		expect(new Set(names).size).toBe(names.length);
	});
});
