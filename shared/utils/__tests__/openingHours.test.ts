/**
 * #1666 `resolveOpeningStatus` の仕様固定テスト。
 *
 * ここは「営業時間データが無い店を誤って除外しないこと」と「深夜営業を日をまたいで
 * 正しく拾うこと」が本番（Issue #1666 / #288）そのものなので、症状に対応する形で書く。
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

// 火曜日固定の文脈（todayDayOfWeek=2 火曜 / yesterdayDayOfWeek=1 月曜）。
// nowMinutes だけ各テストで差し替える。
const TUESDAY_CONTEXT = (nowMinutes: number): OpeningStatusCalendarContext => ({
	todayDate: "2026-09-08",
	todayDayOfWeek: 2,
	yesterdayDate: "2026-09-07",
	yesterdayDayOfWeek: 1,
	nowMinutes,
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
		context: TUESDAY_CONTEXT(12 * 60),
	});
	assert.equal(status, "unknown");
});

test("営業時間が分かっていて今閉まっている店は closed", () => {
	// 火曜 11:00-14:00 のランチのみ。15:00 は閉店中
	const status = resolveOpeningStatus({
		hours: [hourRow({ dayOfWeek: 2, opensAtMinutes: 11 * 60, closesAtMinutes: 14 * 60 })],
		exceptions: [],
		context: TUESDAY_CONTEXT(15 * 60),
	});
	assert.equal(status, "closed");
});

test("18:00-02:00 の深夜営業は、深夜1:00 に open と判定される（前日ぶんを拾う）", () => {
	// 月曜 18:00-02:00（火曜へ食い込む）。今は火曜 1:00
	const status = resolveOpeningStatus({
		hours: [
			hourRow({
				dayOfWeek: 1, // 月曜（yesterday）
				opensAtMinutes: 18 * 60,
				closesAtMinutes: 2 * 60,
				crossesMidnight: true,
			}),
		],
		exceptions: [],
		context: TUESDAY_CONTEXT(1 * 60), // 火曜 1:00
	});
	assert.equal(status, "open");
});

test("18:00-02:00 の深夜営業は、午前10:00 には closed と判定される", () => {
	// 火曜 18:00-02:00（水曜へ食い込む）。今は火曜 10:00 で、前日（月曜）の営業データは無い
	const status = resolveOpeningStatus({
		hours: [
			hourRow({
				dayOfWeek: 2, // 火曜（today）
				opensAtMinutes: 18 * 60,
				closesAtMinutes: 2 * 60,
				crossesMidnight: true,
			}),
		],
		exceptions: [],
		context: TUESDAY_CONTEXT(10 * 60), // 火曜 10:00
	});
	assert.equal(status, "closed");
});

test("例外日の休業が通常営業を上書きする（本来開いているはずの時間でも closed）", () => {
	const status = resolveOpeningStatus({
		hours: [hourRow({ dayOfWeek: 2, opensAtMinutes: 11 * 60, closesAtMinutes: 14 * 60 })],
		exceptions: [exceptionRow({ exceptionDate: "2026-09-08", isClosed: true })],
		context: TUESDAY_CONTEXT(12 * 60), // 通常営業なら開いている時間帯
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
		context: TUESDAY_CONTEXT(20 * 60), // 通常営業なら閉まっている時間帯
	});
	assert.equal(status, "open");
});

test("official_site と osm が食い違うとき official_site が勝つ", () => {
	// osm: 09:00-17:00（今 09:30 は営業中の主張）
	// official_site: 10:00-16:00（今 09:30 はまだ開店前の主張）→ こちらが勝つべき
	const status = resolveOpeningStatus({
		hours: [
			hourRow({ source: "osm", dayOfWeek: 2, opensAtMinutes: 9 * 60, closesAtMinutes: 17 * 60 }),
			hourRow({ source: "official_site", dayOfWeek: 2, opensAtMinutes: 10 * 60, closesAtMinutes: 16 * 60 }),
		],
		exceptions: [],
		context: TUESDAY_CONTEXT(9 * 60 + 30), // 09:30
	});
	assert.equal(status, "closed", "official_site の 10:00 開店前なので closed のはず");
});

test("official_site が優先 source でも、その曜日にコマを持たなければ osm 側は使わずそのまま closed 扱いになる", () => {
	// official_site はランチのみ持ち、ディナー(osm)は無視されるべき
	const status = resolveOpeningStatus({
		hours: [
			hourRow({ source: "osm", dayOfWeek: 2, opensAtMinutes: 18 * 60, closesAtMinutes: 22 * 60 }),
			hourRow({ source: "official_site", dayOfWeek: 2, opensAtMinutes: 11 * 60, closesAtMinutes: 14 * 60 }),
		],
		exceptions: [],
		context: TUESDAY_CONTEXT(19 * 60), // 19:00。osm のディナー営業時間帯だが official_site にディナーは無い
	});
	assert.equal(status, "closed");
});

test("deriveJstCalendarContext は UTC の日付をまたぐ深夜でも JST 基準の日付・曜日を返す", () => {
	// 2026-09-07 15:30 UTC = 2026-09-08 00:30 JST（火曜 0:30）
	const context = deriveJstCalendarContext(new Date("2026-09-07T15:30:00.000Z"));
	assert.equal(context.todayDate, "2026-09-08");
	assert.equal(context.todayDayOfWeek, 2); // 火曜
	assert.equal(context.yesterdayDate, "2026-09-07");
	assert.equal(context.yesterdayDayOfWeek, 1); // 月曜
	assert.equal(context.nowMinutes, 30);
});

test("deriveJstCalendarContext は UTC 日付をまたがない時間帯でも JST 基準で正しい", () => {
	// 2026-09-08 03:00 UTC = 2026-09-08 12:00 JST（火曜 12:00）
	const context = deriveJstCalendarContext(new Date("2026-09-08T03:00:00.000Z"));
	assert.equal(context.todayDate, "2026-09-08");
	assert.equal(context.todayDayOfWeek, 2);
	assert.equal(context.nowMinutes, 12 * 60);
});
