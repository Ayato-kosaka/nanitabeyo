/**
 * #288 `shared/utils/timeSlot.ts` の境界値固定テスト。
 * 検索画面の自動選択（端末時刻→timeSlot）と openingHours.ts の窓判定が同じ境界を
 * 見ていることの土台なので、境界そのものをここで固定する。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { getTimeSlotWindow, resolveTimeSlotForMinutes } from "../timeSlot";

test("境界値: 4:59は late_night, 5:00は morning", () => {
	assert.equal(resolveTimeSlotForMinutes(4 * 60 + 59), "late_night");
	assert.equal(resolveTimeSlotForMinutes(5 * 60), "morning");
});

test("境界値: 9:59は morning, 10:00は lunch", () => {
	assert.equal(resolveTimeSlotForMinutes(9 * 60 + 59), "morning");
	assert.equal(resolveTimeSlotForMinutes(10 * 60), "lunch");
});

test("境界値: 14:59は lunch, 15:00は dinner", () => {
	assert.equal(resolveTimeSlotForMinutes(14 * 60 + 59), "lunch");
	assert.equal(resolveTimeSlotForMinutes(15 * 60), "dinner");
});

test("境界値: 21:59は dinner, 22:00は late_night", () => {
	assert.equal(resolveTimeSlotForMinutes(21 * 60 + 59), "dinner");
	assert.equal(resolveTimeSlotForMinutes(22 * 60), "late_night");
});

test("深夜0:00も late_night（日をまたいだ側）", () => {
	assert.equal(resolveTimeSlotForMinutes(0), "late_night");
});

test("getTimeSlotWindow は late_night の窓を crossesMidnight 相当（end <= start）で返す", () => {
	const window = getTimeSlotWindow("late_night");
	assert.equal(window.startMinutes, 22 * 60);
	assert.equal(window.endMinutesExclusive, 5 * 60);
	assert.ok(window.endMinutesExclusive <= window.startMinutes);
});
