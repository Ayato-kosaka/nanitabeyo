#!/usr/bin/env node
// #1196 error-triage / `sql/error-triage.sql` を書き出す唯一の入口。
//
//   pnpm --filter error-triage generate:sql
//
// 生成物はリポジトリへ commit する。生成物とルール表がズレていないことは
// `sql-generator.test.js` が CI で固定するので、ルール表を変えたらここを回して commit すること。

"use strict";

const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const { generateErrorTriageSql } = require("./sql-generator");

/** 生成物の置き場所（テストからも参照するのでエクスポートする）。 */
const SQL_FILE_PATH = join(__dirname, "sql", "error-triage.sql");

/**
 * 生成物を読む。存在しなければ null。
 *
 * @returns {string|null}
 */
const readGeneratedSql = () => {
	try {
		return readFileSync(SQL_FILE_PATH, "utf8");
	} catch (error) {
		if (error && error.code === "ENOENT") return null;
		throw error;
	}
};

/**
 * 生成して書き出す。
 *
 * @returns {{path:string, changed:boolean, bytes:number}}
 */
const writeGeneratedSql = () => {
	const sql = generateErrorTriageSql();
	const before = readGeneratedSql();
	mkdirSync(dirname(SQL_FILE_PATH), { recursive: true });
	writeFileSync(SQL_FILE_PATH, sql, "utf8");
	return { path: SQL_FILE_PATH, changed: before !== sql, bytes: Buffer.byteLength(sql, "utf8") };
};

if (require.main === module) {
	const result = writeGeneratedSql();
	process.stdout.write(
		`${result.changed ? "更新しました" : "変更ありません"}: ${result.path} (${result.bytes} bytes)\n`,
	);
}

module.exports = Object.freeze({ SQL_FILE_PATH, readGeneratedSql, writeGeneratedSql });
