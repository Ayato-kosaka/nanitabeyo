// #1196 error-triage / 集計窓の計算（純関数）と時刻ユーティリティ。
//
// 横断レビュー G1 / B5 の決定:
//   #1197 §7 の「JST の前日 00:00〜当日 00:00」というカレンダー日リテラルは採らない
//   （09:00 JST 実行時点で直近9時間を絶対に見ないことになる）。
//   **#1199 のスライド窓**を採用する: run 開始時刻を **時単位で切り捨て**、そこから lookbackHours 遡る。
//   窓リテラルを SQL へ埋め込んでパーティション枝刈りを保証する方式（#1197）はそのまま活かす。
//
// 横断レビュー S12:
//   `generatedAt` / `window` を実時刻由来にすると `plan` 出力がバイト単位で一致せずテストが書けない。
//   **このモジュールは Date.now() / new Date() を一切呼ばない。** 現在時刻は必ず引数で受け取る。
//   実時刻が要るのはエントリポイント（PR2/PR3 の main.js）だけで、そこが `systemClock` を注入する。

"use strict";

const { DEFAULT_LOOKBACK_HOURS } = require("./constants");

const MS_PER_HOUR = 3600000;

/** RFC3339（UTC・秒精度）の形式。契約に現れる時刻は全てこの形。 */
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * 実時刻を返す唯一の場所（＝ clock の注入点）。
 *
 * **純関数群からは呼ばないこと。** エントリポイントが `computeWindow({ now: systemClock() })` の
 * ように明示的に渡す。テストは `new Date("2026-08-07T00:05:12Z")` を直接渡す。
 *
 * @returns {Date}
 */
const systemClock = () => new Date();

/**
 * 固定時刻を返す clock を作る（テスト用）。
 *
 * @param {string|number|Date} at
 * @returns {() => Date}
 */
const createFixedClock = (at) => {
	const fixed = toDate(at);
	return () => new Date(fixed.getTime());
};

/**
 * Date / ISO文字列 / epoch ミリ秒 のいずれかを Date にする。
 *
 * @param {string|number|Date} value
 * @returns {Date}
 */
function toDate(value) {
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) throw new TypeError("invalid Date");
		return value;
	}
	if (typeof value === "number") {
		const fromNumber = new Date(value);
		if (Number.isNaN(fromNumber.getTime())) throw new TypeError(`invalid epoch ms: ${value}`);
		return fromNumber;
	}
	if (typeof value === "string") {
		const fromString = new Date(value);
		if (Number.isNaN(fromString.getTime())) throw new TypeError(`invalid date string: ${value}`);
		return fromString;
	}
	throw new TypeError(`unsupported date value: ${JSON.stringify(value)}`);
}

/**
 * RFC3339 UTC（秒精度）へ整形する。`2026-08-07T00:00:00Z`
 *
 * @param {string|number|Date} value
 * @returns {string}
 */
const formatRfc3339Utc = (value) => `${toDate(value).toISOString().slice(0, 19)}Z`;

/**
 * 時単位で切り捨てる（UTC）。分・秒・ミリ秒を 0 にする。
 *
 * @param {string|number|Date} value
 * @returns {Date}
 */
const floorToHourUtc = (value) => new Date(Math.floor(toDate(value).getTime() / MS_PER_HOUR) * MS_PER_HOUR);

/**
 * 集計窓を計算する。
 *
 * `endUtc`   = run 開始時刻を時単位で切り捨てた時刻
 * `startUtc` = `endUtc` - lookbackHours
 *
 * 既定の 25h は 24h + 1h の重複。schedule が1時間遅延しても前回窓との間に隙間ができない。
 * 重複ぶんの二重計上は実害が小さく、契約上「occurrences は窓内の観測数であり run 間で重複し得る」
 * と明記して受け入れる（横断レビュー G6）。
 *
 * @param {{now: string|number|Date, lookbackHours?: number}} params
 * @returns {{startUtc:string, endUtc:string, lookbackHours:number}}
 */
const computeWindow = ({ now, lookbackHours = DEFAULT_LOOKBACK_HOURS }) => {
	if (!Number.isInteger(lookbackHours) || lookbackHours <= 0) {
		throw new RangeError(`lookbackHours must be a positive integer: ${lookbackHours}`);
	}
	const end = floorToHourUtc(now);
	const start = new Date(end.getTime() - lookbackHours * MS_PER_HOUR);
	return Object.freeze({
		startUtc: formatRfc3339Utc(start),
		endUtc: formatRfc3339Utc(end),
		lookbackHours,
	});
};

/**
 * 契約の `generatedAt`。run 開始時刻をそのまま（切り捨てずに）RFC3339 UTC にする。
 *
 * @param {string|number|Date} now
 * @returns {string}
 */
const computeGeneratedAt = (now) => formatRfc3339Utc(now);

/**
 * 窓に含まれるか（`[startUtc, endUtc)` の半開区間）。
 *
 * @param {string|number|Date} value
 * @param {{startUtc:string, endUtc:string}} window
 * @returns {boolean}
 */
const isWithinWindow = (value, window) => {
	const at = toDate(value).getTime();
	return at >= toDate(window.startUtc).getTime() && at < toDate(window.endUtc).getTime();
};

/**
 * 時刻へ時間を加算した新しい Date を返す。
 *
 * @param {string|number|Date} value
 * @param {number} hours
 * @returns {Date}
 */
const addHours = (value, hours) => new Date(toDate(value).getTime() + hours * MS_PER_HOUR);

/**
 * 2つの RFC3339 時刻のうち早い方を返す。どちらかが欠けていればもう一方。
 *
 * 横断レビュー G2（`firstSeen` を毎日リセットしない）で使う。
 *
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 * @returns {string|null}
 */
const minTimestamp = (a, b) => {
	if (!a) return b || null;
	if (!b) return a;
	return toDate(a).getTime() <= toDate(b).getTime() ? a : b;
};

module.exports = Object.freeze({
	MS_PER_HOUR,
	RFC3339_UTC_PATTERN,
	systemClock,
	createFixedClock,
	toDate,
	formatRfc3339Utc,
	floorToHourUtc,
	computeWindow,
	computeGeneratedAt,
	isWithinWindow,
	addHours,
	minTimestamp,
});
