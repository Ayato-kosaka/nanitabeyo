import { readFileSync } from "node:fs";

/**
 * 🛡️ migration ファイルが「適用先スキーマから出ようとしていないか」を検査する。
 *
 * 使い方:
 *   node scripts/assert-migration-schema-scoped.mjs --target-schema <dev|public> <file.sql> [<file.sql> ...]
 *
 * ## なぜ要るのか
 * このリポジトリの本番と開発は **同じ DB の別スキーマ**（本番 = public / 開発 = dev / test）です。
 * `scripts/apply-migration.sh` は各ファイルの前に `SET search_path TO $DB_SCHEMA, extensions`
 * を流すので、**スキーマ修飾のない DDL は必ず適用先スキーマに落ちます**。
 *
 * 選択先と別のアプリケーションスキーマへ SQL が届くのは、次の 2 パターンです。
 *
 * | パターン | 例 |
 * | --- | --- |
 * | 対象外スキーマを明示的に修飾している | `CREATE TABLE public.foo (...)` |
 * | `search_path` を自分で上書きしている | `SET search_path TO public;` |
 *
 * この 2 つだけを検査します。「本番を触らない」と宣言するのではなく、
 * **触れる書き方が入っていないこと**を機械的に確かめるのが目的です。
 *
 * ## ⚠️ コメントは除外すること
 * 素朴に grep すると、`-- 匿名ユーザーもあり public.users FK は張らない` のような
 * **日本語コメント**に引っかかります（実際 20260623T0000_create_dish_category_group_votes.sql が該当）。
 * コメントを落としてから検査しないと、正しい migration が流せなくなって
 * 「チェックを外す」方向へ倒れます。
 */

/**
 * SQL からコメントと文字列リテラルを取り除く。
 *
 * 文字列リテラルも落とすのは、`INSERT ... VALUES ('public.foo')` のような
 * データとしての出現で止めないため。ここで見たいのは **識別子としての** public 参照だけ。
 *
 * @param {string} sql
 * @returns {string} コメント・文字列リテラルを空白へ置換した SQL
 */
export function stripSqlNoise(sql) {
	let out = "";
	let i = 0;
	while (i < sql.length) {
		const two = sql.slice(i, i + 2);

		// 行コメント -- ... 改行まで
		if (two === "--") {
			const nl = sql.indexOf("\n", i);
			i = nl === -1 ? sql.length : nl;
			continue;
		}
		// ブロックコメント /* ... */（PostgreSQL はネストを許すので深さを数える）
		if (two === "/*") {
			let depth = 1;
			i += 2;
			while (i < sql.length && depth > 0) {
				if (sql.slice(i, i + 2) === "/*") {
					depth += 1;
					i += 2;
				} else if (sql.slice(i, i + 2) === "*/") {
					depth -= 1;
					i += 2;
				} else {
					i += 1;
				}
			}
			out += " ";
			continue;
		}
		// 単一引用符の文字列リテラル（'' でエスケープ）
		if (sql[i] === "'") {
			i += 1;
			while (i < sql.length) {
				if (sql[i] === "'" && sql[i + 1] === "'") {
					i += 2;
					continue;
				}
				if (sql[i] === "'") {
					i += 1;
					break;
				}
				i += 1;
			}
			out += " '' ";
			continue;
		}
		// ドル引用符 $tag$ ... $tag$（主に関数本体）。
		// 本体内の SQL も越境検査の対象なので、コメントと文字列だけ再帰的に除去する。
		const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
		if (dollar) {
			const tag = dollar[0];
			const end = sql.indexOf(tag, i + tag.length);
			if (end === -1) {
				i = sql.length;
				out += " ";
				continue;
			}
			const body = sql.slice(i + tag.length, end);
			out += ` ${stripSqlNoise(body)} `;
			i = end + tag.length;
			continue;
		}

		out += sql[i];
		i += 1;
	}
	return out;
}

/**
 * 1 ファイルを検査する。
 *
 * @param {string} filePath
 * @param {string} targetSchema
 * @returns {string[]} 違反の説明（空配列なら問題なし）
 */
export function findSchemaEscapes(filePath, targetSchema = "dev") {
	const stripped = stripSqlNoise(readFileSync(filePath, "utf8"));
	const violations = [];

	// 対象外のアプリケーションスキーマによる明示修飾。
	// auth / extensions など Supabase の共有スキーマ参照は許可する。
	for (const schema of ["public", "dev", "test"].filter((value) => value !== targetSchema)) {
		const pattern = new RegExp(`(^|[^A-Za-z0-9_."])${schema}\\s*\\.\\s*[A-Za-z_"]`, "gi");
		for (const match of stripped.matchAll(pattern)) {
			const line = stripped.slice(0, match.index).split("\n").length;
			violations.push(`${filePath}:${line} 対象外の ${schema} スキーマを明示的に参照しています`);
		}
	}
	// search_path の上書き
	for (const match of stripped.matchAll(/\bset\s+(local\s+)?search_path\b/gi)) {
		const line = stripped.slice(0, match.index).split("\n").length;
		violations.push(`${filePath}:${line} search_path を上書きしています（適用先スキーマへの固定が外れます）`);
	}
	return violations;
}

const args = process.argv.slice(2);
const targetOptionIndex = args.indexOf("--target-schema");
const targetSchema = targetOptionIndex === -1 ? "dev" : args[targetOptionIndex + 1];
if (!["dev", "public"].includes(targetSchema)) {
	console.error("--target-schema は dev または public を指定してください。");
	process.exit(2);
}
if (targetOptionIndex !== -1) args.splice(targetOptionIndex, 2);

const files = args;
if (files.length === 0) {
	console.error(
		"使い方: node scripts/assert-migration-schema-scoped.mjs --target-schema <dev|public> <file.sql> [...]",
	);
	process.exit(2);
}

const allViolations = files.flatMap((file) => findSchemaEscapes(file, targetSchema));

if (allViolations.length > 0) {
	console.error("❌ 適用先スキーマから出る可能性のある記述が見つかりました。");
	for (const v of allViolations) console.error(`   ${v}`);
	console.error("");
	console.error("   本番と開発は同じ DB の別スキーマです。対象外スキーマの修飾を外すか、");
	console.error("   migration の適用先が正しいか確認してください。");
	process.exit(1);
}

console.log(`✅ ${files.length} ファイルすべてが ${targetSchema} スキーマにスコープされています`);
