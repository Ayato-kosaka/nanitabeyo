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
import { readdirSync, readFileSync } from "node:fs";
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
 * テーブル名から migration ファイルを **探して** 読む。
 *
 * ⚠️ **ファイル名を書かない。** migration の名前は «適用列に並ぶ順序» なので、
 * main が別の migration を得ると rename されることがある（`migrations/README.md`）。
 * 実際に `20260923T0000_create_restaurant_reports.sql` は
 * `20260924T0200_...` へ rename され、**名前を書いていたこのテストが落ちた**（#1933 / 2026-09-24）。
 *
 * 日付を書かず、**ファイル名にそのテーブル名を含むもの**を名前順に連結する
 * （`…_create_restaurant_reports.sql` / 将来の `…_add_restaurant_reports_*.sql`）。
 * 連結するのは、あとから別の migration が同じ制約を DROP → ADD し直しても
 * «最後に現れたもの» を採れば現行の値域になるためである（`checkValues` の注記）。
 *
 * ⚠️ **中身の grep で «そのテーブルに触れているファイル» を集めてはいけない。**
 * 最初そう書いて `content_reports.status` が落ちた。`restaurant_reports` の migration は
 * コメントで `content_reports` に言及しているので拾われ、**そちらの `status IN (...)` が
 * «最後に現れたもの» になって別のテーブルの値域を上書きした**。
 * 列の正規表現はテーブルで絞られていないので、集める側で絞る。
 */
function migrationSqlForTable(table: string): string {
	const files = readdirSync(MIGRATIONS)
		.filter((f) => f.endsWith(".sql") && f.includes(table))
		.sort();
	assert.ok(
		files.length > 0,
		`ファイル名に ${table} を含む migration が 1 本も無い（テーブル名が変わった？）`,
	);
	return files.map((f) => readFileSync(join(MIGRATIONS, f), "utf8")).join("\n");
}

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
	table: string;
	column: string;
	constant: readonly string[];
	label: string;
}[] = [
	{
		table: "content_reports",
		column: "target_type",
		constant: CONTENT_REPORT_TARGET_TYPES,
		label: "content_reports.target_type",
	},
	{
		table: "content_reports",
		column: "reason_code",
		constant: CONTENT_REPORT_REASON_CODES,
		label: "content_reports.reason_code",
	},
	{
		table: "content_reports",
		column: "status",
		constant: CONTENT_REPORT_STATUSES,
		label: "content_reports.status",
	},
	{
		table: "restaurant_reports",
		column: "field",
		constant: RESTAURANT_REPORT_FIELDS,
		label: "restaurant_reports.field",
	},
	{
		table: "restaurant_reports",
		column: "status",
		constant: RESTAURANT_REPORT_STATUSES,
		label: "restaurant_reports.status",
	},
];

for (const { table, column, constant, label } of CASES) {
	test(`${label} — 定数と CHECK 制約が同じ集合`, () => {
		const sql = migrationSqlForTable(table);
		assert.deepEqual(
			[...checkValues(sql, column)].sort(),
			[...constant].sort(),
			`${label}: 片方だけ変えると、API は 201 を返すのに INSERT が落ちる`,
		);
	});
}

test("値の抽出そのものが壊れていないこと（空集合を «一致» と呼ばない）", () => {
	const sql = migrationSqlForTable(CASES[0].table);
	assert.ok(checkValues(sql, CASES[0].column).length > 0);
});

test("migration を «名前» ではなくテーブル名で探していること", () => {
	// ⚠️ ファイル名を書き戻すと、rename で黙って落ちる（#1933 / 2026-09-24 に実際に落ちた）。
	//    migration の名前は «適用列に並ぶ順序» なので、main の状況で変わる。
	const source = readFileSync(__filename.replace(/\.js$/, ".ts"), "utf8");
	const hardcoded = source.match(/"\d{8}T\d{4}_[^"]*\.sql"/g);
	assert.equal(
		hardcoded,
		null,
		`migration のファイル名が直接書かれている: ${hardcoded?.join(", ")}`,
	);
});
