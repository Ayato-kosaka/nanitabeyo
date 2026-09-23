/**
 * 共有定数と migration の CHECK 制約が**同じ集合**であることを固定する。
 *
 * ## なぜ要るか
 *
 * `contentReports.ts` にも `restaurantReports.ts` にも、こう書いてある。
 *
 * > ⚠️ ここの配列は CHECK 制約と同じ集合でなければならない。
 * > 片方だけ増やすと、API は 201 を返すのに INSERT が落ちる。
 *
 * **その «同じ集合であること» を確かめる仕掛けが、どこにも無かった**（2026-09-23 に
 * `restaurant_reports` を足すとき気づいた）。注意書きは事故を防がない。
 *
 * ⚠️ これは «値» ではなく **«2 か所に書かれた同じ判定がずれないこと»** を縛るテストである
 * （CLAUDE.md「本番のロジックをテストへ写経しない / 同じ判定を 2 箇所に書いた時点でずれる」）。
 * 値を増やすときは、migration と定数の**両方**を直せば自動的に通る。
 *
 * DB もネットワークも使わない。migration の SQL をファイルとして読むだけである。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	CONTENT_REPORT_REASON_CODES,
	CONTENT_REPORT_STATUSES,
	CONTENT_REPORT_TARGET_TYPES,
} from "../../api/v1/constants/contentReports";
import {
	RESTAURANT_REPORT_FIELDS,
	RESTAURANT_REPORT_STATUSES,
} from "../../api/v1/constants/restaurantReports";

const MIGRATIONS = join(__dirname, "..", "..", "..", "infra", "supabase", "migrations");

/**
 * `CHECK (<column> IN ('a', 'b', …))` から値の集合を取り出す。
 *
 * ⚠️ **最後に現れたものを採る。** この repo の migration は «既存テーブルを現行仕様へ
 * 揃え直す» ブロックで同じ制約を DROP → ADD し直すので、ファイルの後ろにあるものが
 * 現行の値域である（先頭の CREATE TABLE 側は IF NOT EXISTS でスキップされうる）。
 */
function checkValues(sql: string, column: string): string[] {
	// ⚠️ `matchAll` のイテレータを spread しない。shared の tsconfig は target が低く、
	//    `--downlevelIteration` も無いのでコンパイルが通らない（実際に踏んだ）。
	//    `exec` を回す形にすると target に依存しない。
	const re = new RegExp(`${column}\\s+IN\\s*\\(([^)]*)\\)`, "g");
	let last: string | null = null;
	let m: RegExpExecArray | null;
	while ((m = re.exec(sql)) !== null) last = m[1];
	assert.ok(last, `${column} の CHECK (... IN (...)) が見つからない`);

	const valueRe = /'([^']+)'/g;
	const values: string[] = [];
	let v: RegExpExecArray | null;
	while ((v = valueRe.exec(last)) !== null) values.push(v[1]);
	return values;
}

const CASES: {
	migration: string;
	column: string;
	constant: readonly string[];
	label: string;
}[] = [
	{
		migration: "20260826T0300_create_content_reports.sql",
		column: "target_type",
		constant: CONTENT_REPORT_TARGET_TYPES,
		label: "content_reports.target_type",
	},
	{
		migration: "20260826T0300_create_content_reports.sql",
		column: "reason_code",
		constant: CONTENT_REPORT_REASON_CODES,
		label: "content_reports.reason_code",
	},
	{
		migration: "20260826T0300_create_content_reports.sql",
		column: "status",
		constant: CONTENT_REPORT_STATUSES,
		label: "content_reports.status",
	},
	{
		migration: "20260923T0000_create_restaurant_reports.sql",
		column: "field",
		constant: RESTAURANT_REPORT_FIELDS,
		label: "restaurant_reports.field",
	},
	{
		migration: "20260923T0000_create_restaurant_reports.sql",
		column: "status",
		constant: RESTAURANT_REPORT_STATUSES,
		label: "restaurant_reports.status",
	},
];

for (const { migration, column, constant, label } of CASES) {
	test(`${label} — 定数と CHECK 制約が同じ集合`, () => {
		const sql = readFileSync(join(MIGRATIONS, migration), "utf8");
		assert.deepEqual(
			[...checkValues(sql, column)].sort(),
			[...constant].sort(),
			`${label}: 片方だけ変えると、API は 201 を返すのに INSERT が落ちる`,
		);
	});
}

test("値の抽出そのものが壊れていないこと（空集合を «一致» と呼ばない）", () => {
	const sql = readFileSync(join(MIGRATIONS, CASES[0].migration), "utf8");
	assert.ok(checkValues(sql, CASES[0].column).length > 0);
});
