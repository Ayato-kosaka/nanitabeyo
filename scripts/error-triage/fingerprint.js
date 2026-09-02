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
const { restorePathLocale } = require("./normalize-rules");

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

// ---------------------------------------------------------------------------
// 旧世代 fingerprint の復元（fpalgo 1 → 2 の移行 / #1196 CLUSTERING.md 末尾の未解決課題）
// ---------------------------------------------------------------------------

/**
 * この group が **fpalgo 1 のときに持っていたはずの fingerprint** を全て復元する。
 *
 * ■ なぜ復元できるのか
 *   fpalgo 1 → 2 の変更は「`groupKey.pathName` の先頭ロケールを剥がす」の**1点だけ**で、
 *   ハッシュ合成（`buildFingerprintInput`）もキー構成（`FINGERPRINT_KEY_FIELDS`）も変えていない。
 *   剥がしたロケールは捨てずに `localeCounts` として出力へ残してあるので、
 *       v1 の pathName = '/' + locale + (v2 の pathName === '/' ? '' : v2 の pathName)
 *   でロケールごとに**厳密に**再構成でき、その pathName で同じ合成器を回せば v1 の fingerprint になる。
 *
 * ■ なぜ必要なのか
 *   ロケールで割れていた既存 Issue（`/ja-JP/...` `/en-US/...` …）は v1 の fingerprint を
 *   マーカーに持っている。ここを復元して索引を引かないと、v2 の fingerprint は
 *   「未知」に見えて**全部が新規起票**される（CLUSTERING.md 末尾の懸念そのもの）。
 *
 * ■ 将来 fpalgo 3 を作るとき
 *   合成器そのもの（キー構成 / 区切り / ハッシュ）を変える世代を作る場合、この関数は
 *   「v1 の合成器のスナップショット」を持つ必要がある。**現行の合成器を使い回してよいのは、
 *   世代差が groupKey の値の作り方だけに閉じている間だけ**。
 *
 * @param {{surface:string, groupKey?:Record<string, unknown>, messagePattern?:string|null,
 *          localeCounts?:ReadonlyArray<{locale?:string|null, count?:number}>}} group
 * @returns {Array<{fingerprint:string, algoVersion:number, locale:string, pathName:string, count:number}>}
 *          件数の多いロケール順（同数はロケール名昇順）。現行 fingerprint と一致するものは含まない
 */
const computeLegacyFingerprints = (group) => {
	// pathName を持つのは frontend だけ。backend / external は v1 と v2 で fingerprint が同一。
	if (!group || group.surface !== "frontend") return [];
	const groupKey = group.groupKey || {};
	const current = computeFingerprint(group);
	const seen = new Set([current]);
	const out = [];
	for (const entry of group.localeCounts || []) {
		const locale = entry && entry.locale;
		// locale が null の要素は「ロケール接頭辞が無かった」＝ v1 と v2 で pathName が同じ。
		if (!locale) continue;
		const pathName = restorePathLocale(locale, groupKey.pathName);
		const fingerprint = computeFingerprint({ ...group, groupKey: { ...groupKey, pathName } });
		if (seen.has(fingerprint)) continue;
		seen.add(fingerprint);
		out.push({ fingerprint, algoVersion: 1, locale, pathName, count: entry.count ?? 0 });
	}
	return out.sort((a, b) => b.count - a.count || a.locale.localeCompare(b.locale));
};

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
	computeLegacyFingerprints,
	attachFingerprint,
	attachFingerprints,
	parseSqlFpAlgoVersion,
	assertSqlFpAlgoVersion,
});
