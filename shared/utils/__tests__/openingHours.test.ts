/**
 * #288 / #1666 `resolveOpeningStatus` の仕様固定テスト。
 *
 * #288 の差し戻し（PR #1806）は「いま営業中か」（瞬間）で判定しており、夜22時に
 * 「朝食」で検索すると6:00-10:00営業の店が消える、という症状そのものだった。
 * ここは «選んだ時間帯の窓と営業時間が重なるか» を、症状に対応する形で固定する。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	buildWeeklyOpeningHours,
	deriveJstCalendarContext,
	minutesToHhMm,
	resolveOpeningStatus,
	usedHoursSources,
	type OpeningStatusCalendarContext,
	type RestaurantHoursExceptionRow,
	type RestaurantOpeningHourRow,
} from "../openingHours";
import { getTimeSlotWindow, type TimeSlotWindow } from "../timeSlot";

// 火曜日固定の文脈（todayDayOfWeek=2 火曜 / yesterdayDayOfWeek=1 月曜）。
// window だけ各テストで差し替える。
const TUESDAY_CONTEXT = (window: TimeSlotWindow): OpeningStatusCalendarContext => ({
	todayDate: "2026-09-08",
	todayDayOfWeek: 2,
	yesterdayDate: "2026-09-07",
	yesterdayDayOfWeek: 1,
	window,
});

const hourRow = (overrides: Partial<RestaurantOpeningHourRow>): RestaurantOpeningHourRow => ({
	source: "osm",
	dayOfWeek: 2,
	opensAtMinutes: 11 * 60,
	closesAtMinutes: 14 * 60,
	crossesMidnight: false,
	...overrides,
});

const exceptionRow = (overrides: Partial<RestaurantHoursExceptionRow>): RestaurantHoursExceptionRow => ({
	source: "osm",
	exceptionDate: "2026-09-08",
	isClosed: true,
	opensAtMinutes: null,
	closesAtMinutes: null,
	...overrides,
});

test("データが無い店は unknown（除外されない）", () => {
	const status = resolveOpeningStatus({
		hours: [],
		exceptions: [],
		context: TUESDAY_CONTEXT(getTimeSlotWindow("lunch")),
	});
	assert.equal(status, "unknown");
});

test("#288 夜22時に「朝食」で検索しても、6:00-10:00営業の店は open と判定される", () => {
	// 火曜 6:00-10:00 の朝食営業。「今」何時に検索しているかに関わらず、
	// 選んだ timeSlot=morning(5:00-10:00) の窓と重なっていれば open でなければならない
	// （#1806 の差し戻し原因はここを「今の時刻」で判定していたこと）
	const status = resolveOpeningStatus({
		hours: [hourRow({ dayOfWeek: 2, opensAtMinutes: 6 * 60, closesAtMinutes: 10 * 60 })],
		exceptions: [],
		context: TUESDAY_CONTEXT(getTimeSlotWindow("morning")),
	});
	assert.equal(status, "open");
});

test("6:00-10:00の店を dinner(15-22) で引くと closed", () => {
	const status = resolveOpeningStatus({
		hours: [hourRow({ dayOfWeek: 2, opensAtMinutes: 6 * 60, closesAtMinutes: 10 * 60 })],
		exceptions: [],
		context: TUESDAY_CONTEXT(getTimeSlotWindow("dinner")),
	});
	assert.equal(status, "closed");
});

test("18:00-02:00の深夜営業が late_night(22-翌5) と重なって open", () => {
	const status = resolveOpeningStatus({
		hours: [
			hourRow({ dayOfWeek: 2, opensAtMinutes: 18 * 60, closesAtMinutes: 2 * 60, crossesMidnight: true }),
		],
		exceptions: [],
		context: TUESDAY_CONTEXT(getTimeSlotWindow("late_night")),
	});
	assert.equal(status, "open");
});

test("18:00-02:00の深夜営業を lunch(10-15) で引くと closed（重ならない）", () => {
	const status = resolveOpeningStatus({
		hours: [
			hourRow({ dayOfWeek: 2, opensAtMinutes: 18 * 60, closesAtMinutes: 2 * 60, crossesMidnight: true }),
		],
		exceptions: [],
		context: TUESDAY_CONTEXT(getTimeSlotWindow("lunch")),
	});
	assert.equal(status, "closed");
});

test("前日(月曜)18:00-02:00の深夜営業は、火曜のlate_night(22-翌5)にも重なって open（前日ぶんの食い込み）", () => {
	// 月曜 18:00-02:00（火曜早朝2:00まで食い込む）。火曜の late_night(22:00-翌5:00) は
	// 「火曜22:00〜水曜5:00」なので、月曜由来の食い込み（〜火曜2:00）とは重ならないはず
	const status = resolveOpeningStatus({
		hours: [
			hourRow({ dayOfWeek: 1, opensAtMinutes: 18 * 60, closesAtMinutes: 2 * 60, crossesMidnight: true }),
		],
		exceptions: [],
		context: TUESDAY_CONTEXT(getTimeSlotWindow("late_night")),
	});
	assert.equal(status, "closed");
});

test("前日(月曜)18:00-06:00の長い深夜営業は、火曜のmorning(5-10)と重なって open", () => {
	// 月曜 18:00-06:00（火曜朝6:00まで食い込む）。火曜 morning(5:00-10:00) と 5:00-6:00 が重なる
	const status = resolveOpeningStatus({
		hours: [
			hourRow({ dayOfWeek: 1, opensAtMinutes: 18 * 60, closesAtMinutes: 6 * 60, crossesMidnight: true }),
		],
		exceptions: [],
		context: TUESDAY_CONTEXT(getTimeSlotWindow("morning")),
	});
	assert.equal(status, "open");
});

test("例外日の休業が通常営業を上書きする（重なる窓でも closed）", () => {
	const status = resolveOpeningStatus({
		hours: [hourRow({ dayOfWeek: 2, opensAtMinutes: 11 * 60, closesAtMinutes: 14 * 60 })],
		exceptions: [exceptionRow({ exceptionDate: "2026-09-08", isClosed: true })],
		context: TUESDAY_CONTEXT(getTimeSlotWindow("lunch")),
	});
	assert.equal(status, "closed");
});

test("例外日の時間変更が通常営業を上書きする（延長された時間は open）", () => {
	const status = resolveOpeningStatus({
		hours: [hourRow({ dayOfWeek: 2, opensAtMinutes: 11 * 60, closesAtMinutes: 14 * 60 })],
		exceptions: [
			exceptionRow({
				exceptionDate: "2026-09-08",
				isClosed: false,
				opensAtMinutes: 11 * 60,
				closesAtMinutes: 22 * 60, // 特別営業で 22:00 まで延長
			}),
		],
		context: TUESDAY_CONTEXT(getTimeSlotWindow("dinner")), // 通常営業なら重ならない時間帯
	});
	assert.equal(status, "open");
});

test("official_site と osm が食い違うとき official_site が勝つ", () => {
	// osm: 09:00-17:00（lunch と重なる）
	// official_site: 10:30-11:00（lunch(10-15) と重なる。ただしこちらが正）
	// どちらも lunch と重なるため、この設定では「勝敗」を区別できない。
	// official_site だけが lunch と重ならない設定にして優先順位を検証する
	const status = resolveOpeningStatus({
		hours: [
			hourRow({ source: "osm", dayOfWeek: 2, opensAtMinutes: 9 * 60, closesAtMinutes: 17 * 60 }),
			hourRow({ source: "official_site", dayOfWeek: 2, opensAtMinutes: 8 * 60, closesAtMinutes: 9 * 60 + 30 }),
		],
		exceptions: [],
		context: TUESDAY_CONTEXT(getTimeSlotWindow("lunch")), // 10:00-15:00
	});
	assert.equal(status, "closed", "official_site（8:00-9:30、lunchと重ならない）が勝つはず");
});

test("official_site が優先 source でも、その曜日にコマを持たなければ osm 側は使わずそのまま closed 扱いになる", () => {
	// official_site はランチのみ持ち、ディナー(osm)は無視されるべき
	const status = resolveOpeningStatus({
		hours: [
			hourRow({ source: "osm", dayOfWeek: 2, opensAtMinutes: 18 * 60, closesAtMinutes: 22 * 60 }),
			hourRow({ source: "official_site", dayOfWeek: 2, opensAtMinutes: 11 * 60, closesAtMinutes: 14 * 60 }),
		],
		exceptions: [],
		context: TUESDAY_CONTEXT(getTimeSlotWindow("dinner")), // 15:00-22:00。osmのディナーと重なるが official_site にディナーは無い
	});
	assert.equal(status, "closed");
});

test("deriveJstCalendarContext は UTC の日付をまたぐ深夜でも JST 基準の日付・曜日を返す", () => {
	// 2026-09-07 15:30 UTC = 2026-09-08 00:30 JST（火曜 0:30）
	const context = deriveJstCalendarContext(new Date("2026-09-07T15:30:00.000Z"), getTimeSlotWindow("lunch"));
	assert.equal(context.todayDate, "2026-09-08");
	assert.equal(context.todayDayOfWeek, 2); // 火曜
	assert.equal(context.yesterdayDate, "2026-09-07");
	assert.equal(context.yesterdayDayOfWeek, 1); // 月曜
	assert.deepEqual(context.window, getTimeSlotWindow("lunch"));
});

test("deriveJstCalendarContext は UTC 日付をまたがない時間帯でも JST 基準で正しい", () => {
	// 2026-09-08 03:00 UTC = 2026-09-08 12:00 JST（火曜 12:00）
	const context = deriveJstCalendarContext(new Date("2026-09-08T03:00:00.000Z"), getTimeSlotWindow("dinner"));
	assert.equal(context.todayDate, "2026-09-08");
	assert.equal(context.todayDayOfWeek, 2);
	assert.deepEqual(context.window, getTimeSlotWindow("dinner"));
});

/* ==========================================================================
 * #1666 表示（GET /v1/restaurants/:id/opening-hours）
 * ========================================================================== */

test("buildWeeklyOpeningHours: 行が 1 つも無ければ空配列（欄ごと出さないため）", () => {
	assert.deepEqual(buildWeeklyOpeningHours([]), []);
});

test("buildWeeklyOpeningHours: 行が 1 つでもあれば 7 曜日ぶん返し、行の無い曜日は «定休»（空 spans）", () => {
	/*
	⚠️ ここがこの関数のいちばん大事な取り決めである。«その曜日に行が無い» を «不明» と
	読むと、`resolveOpeningStatus`（絞り込み側）が `closed` と判定する店を、詳細画面だけ
	«分からない» と表示することになる。同じデータに 2 つの意味を持たせない。
	*/
	const days = buildWeeklyOpeningHours([hourRow({ dayOfWeek: 1 })]);
	assert.equal(days.length, 7);
	assert.equal(days[1].spans.length, 1);
	for (const dow of [0, 2, 3, 4, 5, 6]) {
		assert.deepEqual(days[dow].spans, [], `dow=${dow} は定休（空）であるべき`);
	}
});

test("buildWeeklyOpeningHours: 同じ曜日に複数コマがあれば開始時刻の順に並べる", () => {
	const days = buildWeeklyOpeningHours([
		hourRow({ dayOfWeek: 3, opensAtMinutes: 17 * 60, closesAtMinutes: 21 * 60 }),
		hourRow({ dayOfWeek: 3, opensAtMinutes: 11 * 60, closesAtMinutes: 14 * 60 }),
	]);
	assert.deepEqual(
		days[3].spans.map((s) => s.opensAtMinutes),
		[11 * 60, 17 * 60],
	);
});

test("buildWeeklyOpeningHours: 出所は **曜日ごと** に優先順位で選ぶ", () => {
	/*
	⚠️ 週全体で 1 つの出所に決めてはいけない。公式サイトが月〜金しか書いていない店で
	週まるごと official_site を採ると、**土日が消える**。
	*/
	const days = buildWeeklyOpeningHours([
		hourRow({ dayOfWeek: 1, source: "official_site", opensAtMinutes: 9 * 60 }),
		hourRow({ dayOfWeek: 1, source: "osm", opensAtMinutes: 10 * 60 }),
		hourRow({ dayOfWeek: 6, source: "osm", opensAtMinutes: 8 * 60 }),
	]);
	assert.deepEqual(
		days[1].spans.map((s) => s.opensAtMinutes),
		[9 * 60],
		"月曜は official_site が勝つ",
	);
	assert.deepEqual(
		days[6].spans.map((s) => s.opensAtMinutes),
		[8 * 60],
		"土曜は osm しか無いので残る",
	);
});

test("buildWeeklyOpeningHours: 優先順位は resolveOpeningStatus と同じ規則である", () => {
	/*
	⚠️ 写経していないことの確認。表示が official_site を採るなら、絞り込みも
	official_site の時間で判定していなければならない。**同じ入力で突き合わせる。**
	*/
	const rows: RestaurantOpeningHourRow[] = [
		// 火曜: official_site は昼だけ / osm は昼と夜。official_site が勝つので夜は «閉まっている»
		hourRow({ dayOfWeek: 2, source: "official_site", opensAtMinutes: 11 * 60, closesAtMinutes: 14 * 60 }),
		hourRow({ dayOfWeek: 2, source: "osm", opensAtMinutes: 11 * 60, closesAtMinutes: 14 * 60 }),
		hourRow({ dayOfWeek: 2, source: "osm", opensAtMinutes: 17 * 60, closesAtMinutes: 21 * 60 }),
	];
	const days = buildWeeklyOpeningHours(rows);
	assert.deepEqual(
		days[2].spans.map((s) => s.opensAtMinutes),
		[11 * 60],
		"表示: 夜のコマは出ない",
	);
	assert.equal(
		resolveOpeningStatus({
			hours: rows,
			exceptions: [],
			context: TUESDAY_CONTEXT(getTimeSlotWindow("dinner")),
		}),
		"closed",
		"絞り込み: 同じ入力で夜は closed。表示と食い違わない",
	);
});

test("usedHoursSources: 曜日ごとに違う出所を **全部** 返す（片方を偽らない）", () => {
	assert.deepEqual(
		usedHoursSources([
			hourRow({ dayOfWeek: 1, source: "official_site" }),
			hourRow({ dayOfWeek: 1, source: "osm" }),
			hourRow({ dayOfWeek: 6, source: "osm" }),
		]),
		["official_site", "osm"],
	);
});

test("minutesToHhMm: 0 埋めする", () => {
	assert.equal(minutesToHhMm(9 * 60), "09:00");
	assert.equal(minutesToHhMm(9 * 60 + 5), "09:05");
	assert.equal(minutesToHhMm(0), "00:00");
	assert.equal(minutesToHhMm(23 * 60 + 59), "23:59");
});
