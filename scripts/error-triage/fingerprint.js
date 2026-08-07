// #1196 error-triage / fingerprint のハッシュ合成（純関数）。
//
// 横断レビュー 1-2 の決定（第3案）:
//   ① 正規化           → SQL（normalize-rules.js が唯一の正。PR2 で SQL を生成する）
//   ② グルーピング + COUNT(DISTINCT user_id) → SQL（JS で再 group すると affectedUsers が
//                        occurrences に退化し、#1198 §4-A の優先順位付けが設計意図と逆転する = B1）
//   ③ fingerprint = md5(surface | k1 | ... | messagePattern)[0:12] → **ここ（JS）**
//
// したがって本モジュールは「SQL が出した1行」を受け取り、そこへ fingerprint を1つ載せるだけ。
// **絶対に再グルーピングしない**（契約の不変条件 1）。

"use strict";

const { createHash } = require("node:crypto");

const { FP_ALGO_VERSION, SURFACES } = require("./constants");

/** fingerprint の桁数（#1196 のマーカー形式 `<!-- fp:xxxxxxxxxxxx -->` に合わせて 12 桁）。 */
const FINGERPRINT_LENGTH = 12;

/** fingerprint の形式。12 桁の小文字 hex。 */
const FINGERPRINT_PATTERN = /^[0-9a-f]{12}$/;

/**
 * surface ごとの fingerprint 構成キー（**順序に意味がある**）。
 *
 * #1197 §3-3 / 横断レビュー §5 の決定:
 *   - backend は `function_name` が常に `'ApiExceptionFilter'`、`event_name` が5種しかないため、
 *     `httpStatus` と `route` を独立フィールドに昇格させないと 5 グループに潰れる。
 *   - external は message 非依存（#1196 どおり `apiName + endpoint + method + statusCode`）。
 *
 * ここに載っていないフィールド（`errorCode` / `occurrences` 等）は fingerprint に混ぜない
 * （契約の不変条件 5）。
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
const FINGERPRINT_KEY_FIELDS = Object.freeze({
	frontend: Object.freeze(["pathName", "eventName", "route", "httpStatus"]),
	backend: Object.freeze(["functionName", "eventName", "httpStatus", "route"]),
	external: Object.freeze(["apiName", "endpoint", "method", "statusCode"]),
});

/** surface ごとに messagePattern を fingerprint に含めるか。external は含めない。 */
const SURFACE_USES_MESSAGE = Object.freeze({
	frontend: true,
	backend: true,
	external: false,
});

/** fingerprint 入力のフィールド区切り。 */
const FIELD_SEPARATOR = "|";

/**
 * フィールド値を1つの文字列へ落とす。
 *
 * `|` と `\` をエスケープするのが要点。素朴に `|` で連結すると
 * `("a|b", "c")` と `("a", "b|c")` が同じ入力文字列になり、**別グループが同一 fingerprint に衝突**する
 * （#1199 §7-3-A テストケース10）。合成は JS 側だけで行う（SQL は各フィールドを素で出す）ので、
 * ここでエスケープしても SQL には一切影響しない。
 *
 * null / undefined は空文字にする（SQL の `IFNULL(x, '')` と同義）。
 *
 * @param {unknown} value
 * @returns {string}
 */
const encodeField = (value) => {
	if (value === null || value === undefined) return "";
	return String(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
};

/**
 * fingerprint のハッシュ入力文字列を組み立てる。
 *
 * @param {{surface:string, groupKey?:Record<string, unknown>, messagePattern?:string|null}} group
 * @returns {string}
 */
const buildFingerprintInput = (group) => {
	const surface = group && group.surface;
	if (!SURFACES.includes(surface)) {
		throw new TypeError(`unknown surface: ${JSON.stringify(surface)}`);
	}
	const groupKey = (group && group.groupKey) || {};
	const parts = [surface];
	for (const field of FINGERPRINT_KEY_FIELDS[surface]) {
		parts.push(encodeField(groupKey[field]));
	}
	if (SURFACE_USES_MESSAGE[surface]) {
		parts.push(encodeField(group.messagePattern));
	}
	return parts.join(FIELD_SEPARATOR);
};

/**
 * fingerprint を計算する。`md5(...)` の先頭 12 桁小文字 hex。
 *
 * 純関数。`groupKey` と `messagePattern` のみに依存し、`occurrences` などの可変値には依存しない
 * （契約の不変条件 5）。
 *
 * @param {{surface:string, groupKey?:Record<string, unknown>, messagePattern?:string|null}} group
 * @returns {string} 12 桁小文字 hex
 */
const computeFingerprint = (group) =>
	createHash("md5").update(buildFingerprintInput(group), "utf8").digest("hex").slice(0, FINGERPRINT_LENGTH);

/**
 * SQL の1出力行へ fingerprint を1つ載せた新しいオブジェクトを返す。入力は変更しない。
 *
 * @template {{surface:string}} T
 * @param {T} row
 * @returns {T & {fingerprint:string}}
 */
const attachFingerprint = (row) => ({ ...row, fingerprint: computeFingerprint(row) });

/**
 * SQL の出力行の配列へ fingerprint を載せる。
 *
 * **要素数は必ず入力と同じ**（1行 ⇔ 1グループ。契約の不変条件 1）。
 * 同じ fingerprint が2行出てきたとしても、ここでは決してマージしない
 * （マージすると affectedUsers の合算＝ B1 の退化が起きる）。
 *
 * @template {{surface:string}} T
 * @param {ReadonlyArray<T>} rows
 * @returns {Array<T & {fingerprint:string}>}
 */
const attachFingerprints = (rows) => rows.map(attachFingerprint);

/** SQL ファイル冒頭に書く fingerprint 世代マーカー。 */
const SQL_FP_ALGO_MARKER_PATTERN = /^[ \t]*--[ \t]*fpalgo:[ \t]*(\d{1,3})[ \t]*$/m;

/**
 * SQL テキストから `-- fpalgo: N` を読み取る（**引数で受け取るだけ。ファイルは読まない**）。
 *
 * 横断レビュー 1-3 の一致検査の土台。SQL 本体（`sql/error-triage.sql`）は PR2 の成果物なので、
 * PR1 ではこのパーサと `FP_ALGO_VERSION` のエクスポートまでを用意する。
 * PR2 でファイルを読み込んで `assertSqlFpAlgoVersion()` に渡すテストを1本足せば、
 * 「片方だけ変えて全件再起票」が構造的に防げる。
 *
 * @param {string} sqlText
 * @returns {number|null} 見つからなければ null
 */
const parseSqlFpAlgoVersion = (sqlText) => {
	const matched = SQL_FP_ALGO_MARKER_PATTERN.exec(String(sqlText));
	return matched ? Number.parseInt(matched[1], 10) : null;
};

/**
 * SQL テキストの `-- fpalgo: N` が JS の FP_ALGO_VERSION と一致することを検査する。
 *
 * @param {string} sqlText
 * @returns {{ok:boolean, sqlVersion:number|null, jsVersion:number, message:string|null}}
 */
const assertSqlFpAlgoVersion = (sqlText) => {
	const sqlVersion = parseSqlFpAlgoVersion(sqlText);
	if (sqlVersion === null) {
		return {
			ok: false,
			sqlVersion: null,
			jsVersion: FP_ALGO_VERSION,
			message: "SQL に `-- fpalgo: N` マーカーがありません",
		};
	}
	if (sqlVersion !== FP_ALGO_VERSION) {
		return {
			ok: false,
			sqlVersion,
			jsVersion: FP_ALGO_VERSION,
			message: `fpalgo 不一致: SQL=${sqlVersion} JS=${FP_ALGO_VERSION}`,
		};
	}
	return { ok: true, sqlVersion, jsVersion: FP_ALGO_VERSION, message: null };
};

module.exports = Object.freeze({
	FP_ALGO_VERSION,
	FINGERPRINT_LENGTH,
	FINGERPRINT_PATTERN,
	FINGERPRINT_KEY_FIELDS,
	SURFACE_USES_MESSAGE,
	FIELD_SEPARATOR,
	SQL_FP_ALGO_MARKER_PATTERN,
	encodeField,
	buildFingerprintInput,
	computeFingerprint,
	attachFingerprint,
	attachFingerprints,
	parseSqlFpAlgoVersion,
	assertSqlFpAlgoVersion,
});
