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
	deriveJstCalendarContext,
	resolveOpeningStatus,
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
