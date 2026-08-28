/*
#1403 (PR2) my-dishes の計測 payload を固定する。

ここで守りたいのは 2 つだけである。

1. **個人を特定しうる値が payload に混ざらないこと。** 店名・料理名・レビュー本文は id で済ませ、
   生の緯度経度はエリアの粒度まで丸める。ここが緩むと `frontend_event_logs` を読む全員が
   «誰がどこで何を食べたか» を素の文字列で見られる状態になる
2. **「どの絞り込みを使ったか」に答えられる粒度が揃っていること。** #1396 の時点では
   `featureKeys` が落ちており、確定B（時間帯・シチュエーションを並び替えとして出す）
   が実際に使われているかを後から答えられなかった

「適用したときだけ 1 回出る」（レンダーごとに出さない）は画面側の性質なので
`__tests__/myDishesAnalytics.test.tsx` が受け持つ。2 つで 1 組。
*/
import {
	LOG_COORDINATE_PRECISION,
	MY_DISHES_EVENTS,
	buildFilterAppliedPayload,
	buildMapAreaPayload,
	buildMarkAsEatenCompletedPayload,
	buildViewSelectedPayload,
	roundCoordinateForLog,
} from "./analytics";
import { DEFAULT_MY_DISHES_FILTER, type MyDishesFilter } from "./stores/useMyDishesFilterStore";

describe("#1403 my-dishes のイベント名", () => {
	it("すべて my_dishes_ 接頭辞で、重複がない", () => {
		const names = Object.values(MY_DISHES_EVENTS);
		names.forEach((name) => expect(name.startsWith("my_dishes_")).toBe(true));
		expect(new Set(names).size).toBe(names.length);
	});

	// 命名の «語尾» を揃える。`my_dishes_record_button_clicked` だけ `_clicked` だったのを
	// この PR で `my_dishes_record_pressed` へ改名しており、再発をここで止める
	it("語尾は pressed / selected / applied / completed / cleared / undone のいずれかで、_clicked は使わない", () => {
		const allowed = /_(pressed|selected|applied|completed|cleared|undone|closed|expanded|see_all_in_list|this_area)$/;
		Object.values(MY_DISHES_EVENTS).forEach((name) => {
			expect(name).not.toMatch(/_clicked$/);
			expect(name).toMatch(allowed);
		});
	});

	it("保存→食べた の入口と出口が対で存在する", () => {
		expect(MY_DISHES_EVENTS.markAsEatenPressed).toBe("my_dishes_mark_as_eaten_pressed");
		expect(MY_DISHES_EVENTS.markAsEatenCompleted).toBe("my_dishes_mark_as_eaten_completed");
	});
});

describe("#1403 座標はログ用に丸める", () => {
	it(`小数 ${LOG_COORDINATE_PRECISION} 桁（約 110m）まで落とす`, () => {
		expect(roundCoordinateForLog(35.681236)).toBe(35.681);
		expect(roundCoordinateForLog(139.767125)).toBe(139.767);
	});

	it("負の座標でも桁数が同じで、-0 を作らない", () => {
		expect(roundCoordinateForLog(-33.868821)).toBe(-33.869);
		expect(Object.is(roundCoordinateForLog(-0.0001), 0)).toBe(true);
	});

	it("NaN / Infinity は 0 に潰す（ログのために例外を投げない）", () => {
		expect(roundCoordinateForLog(Number.NaN)).toBe(0);
		expect(roundCoordinateForLog(Number.POSITIVE_INFINITY)).toBe(0);
	});

	// 半径は «居場所» ではなく «どのくらい広く探したか» なので丸めない。
	// ここを潰すと「エリアが広すぎて 0 件だったのか」を後から追えなくなる
	it("エリアの payload は lat/lng だけ丸め、radius はそのまま載せる", () => {
		expect(buildMapAreaPayload({ lat: 35.681236, lng: 139.767125, radius: 1234 })).toEqual({
			lat: 35.681,
			lng: 139.767,
			radius: 1234,
		});
	});

	it("エリアの payload は label（店名や地名が入りうる）を載せない", () => {
		const payload = buildMapAreaPayload({ lat: 35.681236, lng: 139.767125, radius: 1234, label: "東京駅" } as never);
		expect(Object.keys(payload).sort()).toEqual(["lat", "lng", "radius"]);
	});
});

describe("#1403 filter_applied の payload", () => {
	it("既定のフィルタでは «何も絞っていない» ことが読み取れる", () => {
		expect(buildFilterAppliedPayload(DEFAULT_MY_DISHES_FILTER)).toEqual({
			status: "",
			sort: DEFAULT_MY_DISHES_FILTER.sort,
			minRating: null,
			hasRatings: false,
			categoryCount: 0,
			featureKeys: "",
			hasArea: false,
			hasPeriod: false,
		});
	});

	// #1396 確定B: 時間帯・シチュエーションは «絞り込み» ではなく «並び替え» として出している。
	// キーが落ちていると「その並び替えが実際に使われたか」を後から答えられない
	it("並び替えに同伴する軸（featureKeys）を載せる。選んだ順に依存しないようソートして積む", () => {
		const filter: MyDishesFilter = {
			...DEFAULT_MY_DISHES_FILTER,
			sort: "-featureScore",
			featureKeys: ["timeSlot:dinner", "scene:date"],
		};
		expect(buildFilterAppliedPayload(filter)).toMatchObject({
			sort: "-featureScore",
			featureKeys: "scene:date,timeSlot:dinner",
		});
	});

	it("エリアは真偽だけにし、座標を重ねて撒かない", () => {
		const filter: MyDishesFilter = {
			...DEFAULT_MY_DISHES_FILTER,
			area: { lat: 35.681236, lng: 139.767125, radius: 1200, label: "東京駅" },
		};
		const payload = buildFilterAppliedPayload(filter);
		expect(payload.hasArea).toBe(true);
		expect(JSON.stringify(payload)).not.toContain("35.68");
		expect(JSON.stringify(payload)).not.toContain("東京駅");
	});

	it("料理カテゴリは件数だけにする（id を並べない）", () => {
		const filter: MyDishesFilter = { ...DEFAULT_MY_DISHES_FILTER, categoryIds: ["a", "b", "c"] };
		const payload = buildFilterAppliedPayload(filter);
		expect(payload.categoryCount).toBe(3);
		expect(JSON.stringify(payload)).not.toContain('"a"');
	});

	it("期間は真偽だけにする（from / to の日時そのものは載せない）", () => {
		const filter: MyDishesFilter = { ...DEFAULT_MY_DISHES_FILTER, from: "2026-01-01T00:00:00.000Z", to: null };
		const payload = buildFilterAppliedPayload(filter);
		expect(payload.hasPeriod).toBe(true);
		expect(JSON.stringify(payload)).not.toContain("2026-01-01");
	});
});

describe("#1403 view_selected / mark_as_eaten_completed の payload", () => {
	it("ビュー切替は «どこからどこへ» を持つ", () => {
		expect(buildViewSelectedPayload("map", "list")).toEqual({ from: "map", to: "list" });
	});

	// 入口（pressed）と出口（completed）を join しなくても、1 行で
	// «押した人が何秒で書き終えたか» を出せるようにしている
	it("完了イベントは id と所要時間だけを持ち、レビュー本文や評点を持たない", () => {
		const payload = buildMarkAsEatenCompletedPayload({
			from: "list",
			itemKey: "item-1",
			restaurantId: "rest-1",
			dishMediaId: "media-1",
			dishReviewId: "review-1",
			durationMs: 42_000,
		});
		expect(payload).toEqual({
			from: "list",
			itemKey: "item-1",
			restaurantId: "rest-1",
			dishMediaId: "media-1",
			dishReviewId: "review-1",
			durationMs: 42_000,
		});
		expect(Object.keys(payload)).not.toContain("comment");
		expect(Object.keys(payload)).not.toContain("rating");
	});
});
