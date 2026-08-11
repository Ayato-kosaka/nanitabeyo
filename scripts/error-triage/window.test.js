"use strict";

const { DEFAULT_LOOKBACK_HOURS } = require("./constants");
const {
	RFC3339_UTC_PATTERN,
	computeGeneratedAt,
	computeWindow,
	createFixedClock,
	floorToHourUtc,
	formatRfc3339Utc,
	isWithinWindow,
	minTimestamp,
	systemClock,
} = require("./window");

describe("computeWindow() — 25h スライド窓（G1 / B5）", () => {
	it("run 開始時刻を時単位で切り捨て、そこから lookbackHours 遡る", () => {
		// 契約 §7 の例そのまま: generatedAt 2026-08-07T00:05:12Z → 窓 2026-08-05T23:00 〜 2026-08-07T00:00
		expect(computeWindow({ now: "2026-08-07T00:05:12Z" })).toEqual({
			startUtc: "2026-08-05T23:00:00Z",
			endUtc: "2026-08-07T00:00:00Z",
			lookbackHours: 25,
		});
	});

	it("既定の遡り時間は 25h（24h + 1h の重複）", () => {
		expect(DEFAULT_LOOKBACK_HOURS).toBe(25);
		expect(computeWindow({ now: "2026-08-07T00:05:12Z" }).lookbackHours).toBe(25);
	});

	it("窓幅がちょうど lookbackHours になる", () => {
		for (const lookbackHours of [1, 24, 25, 48]) {
			const window = computeWindow({ now: "2026-08-07T09:59:59Z", lookbackHours });
			const width = (Date.parse(window.endUtc) - Date.parse(window.startUtc)) / 3600000;
			expect(width).toBe(lookbackHours);
		}
	});

	it("RFC3339 UTC（秒精度）のリテラルで出力する", () => {
		const window = computeWindow({ now: "2026-08-07T00:05:12.987Z" });
		expect(window.startUtc).toMatch(RFC3339_UTC_PATTERN);
		expect(window.endUtc).toMatch(RFC3339_UTC_PATTERN);
	});

	it("月末をまたいでも壊れない", () => {
		expect(computeWindow({ now: "2026-03-01T00:30:00Z" })).toEqual({
			startUtc: "2026-02-27T23:00:00Z",
			endUtc: "2026-03-01T00:00:00Z",
			lookbackHours: 25,
		});
	});

	it("年末をまたいでも壊れない", () => {
		expect(computeWindow({ now: "2027-01-01T00:05:00Z" })).toEqual({
			startUtc: "2026-12-30T23:00:00Z",
			endUtc: "2027-01-01T00:00:00Z",
			lookbackHours: 25,
		});
	});

	it("うるう日をまたいでも壊れない", () => {
		expect(computeWindow({ now: "2028-03-01T00:00:00Z" })).toEqual({
			startUtc: "2028-02-28T23:00:00Z",
			endUtc: "2028-03-01T00:00:00Z",
			lookbackHours: 25,
		});
	});

	it("schedule が1時間遅延しても前回窓との間に隙間ができない", () => {
		// GitHub Actions の cron は毎時00分が最も混雑し、数分〜1時間の遅延が起こりうる（#1199 §3）。
		const onTime = computeWindow({ now: "2026-08-07T00:03:00Z" });
		const delayedNextDay = computeWindow({ now: "2026-08-08T01:40:00Z" });
		expect(Date.parse(delayedNextDay.startUtc)).toBeLessThanOrEqual(Date.parse(onTime.endUtc));
	});

	it("2時間遅延すると隙間ができる（25h が守っている余裕はちょうど1時間ぶんであることの明示）", () => {
		const onTime = computeWindow({ now: "2026-08-07T00:03:00Z" });
		const delayed = computeWindow({ now: "2026-08-08T02:40:00Z" });
		expect(Date.parse(delayed.startUtc)).toBeGreaterThan(Date.parse(onTime.endUtc));
	});

	it("lookbackHours が正の整数でなければ例外", () => {
		for (const lookbackHours of [0, -1, 1.5, NaN]) {
			expect(() => computeWindow({ now: "2026-08-07T00:00:00Z", lookbackHours })).toThrow(RangeError);
		}
	});

	it("戻り値は凍結されている", () => {
		expect(Object.isFrozen(computeWindow({ now: "2026-08-07T00:00:00Z" }))).toBe(true);
	});
});

describe("clock の注入（S12）", () => {
	it("computeWindow / computeGeneratedAt は現在時刻を引数からしか取らない", () => {
		// Date.now / new Date をモックしても結果が変わらない = 実時刻に依存していない。
		const spy = jest.spyOn(Date, "now").mockReturnValue(0);
		try {
			expect(computeWindow({ now: "2026-08-07T00:05:12Z" }).endUtc).toBe("2026-08-07T00:00:00Z");
			expect(computeGeneratedAt("2026-08-07T00:05:12Z")).toBe("2026-08-07T00:05:12Z");
		} finally {
			spy.mockRestore();
		}
	});

	it("createFixedClock() は常に同じ時刻を返し、返り値を変更されても壊れない", () => {
		const clock = createFixedClock("2026-08-07T00:05:12Z");
		const first = clock();
		first.setUTCFullYear(1999);
		expect(formatRfc3339Utc(clock())).toBe("2026-08-07T00:05:12Z");
	});

	it("systemClock() が実時刻の唯一の入口として公開されている", () => {
		expect(typeof systemClock).toBe("function");
		expect(systemClock()).toBeInstanceOf(Date);
	});
});

describe("時刻ユーティリティ", () => {
	it("floorToHourUtc() が分・秒・ミリ秒を落とす", () => {
		expect(formatRfc3339Utc(floorToHourUtc("2026-08-07T13:59:59.999Z"))).toBe("2026-08-07T13:00:00Z");
	});

	it("formatRfc3339Utc() はミリ秒を落とす", () => {
		expect(formatRfc3339Utc("2026-08-07T13:59:59.999Z")).toBe("2026-08-07T13:59:59Z");
	});

	it("JST 表記の入力を渡しても UTC で解釈・出力される（#1198 §7-13 のタイムゾーン混在）", () => {
		expect(formatRfc3339Utc("2026-08-07T09:00:00+09:00")).toBe("2026-08-07T00:00:00Z");
	});

	it("isWithinWindow() は [start, end) の半開区間", () => {
		const window = computeWindow({ now: "2026-08-07T00:00:00Z" });
		expect(isWithinWindow("2026-08-05T23:00:00Z", window)).toBe(true);
		expect(isWithinWindow("2026-08-05T22:59:59Z", window)).toBe(false);
		expect(isWithinWindow("2026-08-06T23:59:59Z", window)).toBe(true);
		expect(isWithinWindow("2026-08-07T00:00:00Z", window)).toBe(false);
	});

	it("minTimestamp() は早い方を返し、欠損に耐える", () => {
		expect(minTimestamp("2026-08-06T00:00:00Z", "2026-07-01T00:00:00Z")).toBe("2026-07-01T00:00:00Z");
		expect(minTimestamp("2026-07-01T00:00:00Z", "2026-08-06T00:00:00Z")).toBe("2026-07-01T00:00:00Z");
		expect(minTimestamp(null, "2026-08-06T00:00:00Z")).toBe("2026-08-06T00:00:00Z");
		expect(minTimestamp("2026-08-06T00:00:00Z", null)).toBe("2026-08-06T00:00:00Z");
		expect(minTimestamp(null, null)).toBeNull();
	});

	it("壊れた日付文字列は例外にする", () => {
		expect(() => formatRfc3339Utc("not-a-date")).toThrow(TypeError);
	});
});
