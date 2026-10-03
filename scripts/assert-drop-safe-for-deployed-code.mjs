import { readFileSync } from "node:fs";

import { stripSqlNoise } from "./assert-migration-schema-scoped.mjs";

/**
 * 🛡️ 「列を落とす migration」を、**いま動いているコードがその列を読まなくなったこと**を
 * 確かめてから当てるための門番。
 *
 * 使い方:
 *   node scripts/assert-drop-safe-for-deployed-code.mjs --target-schema <dev|public> <file.sql> [...]
 *
 * ## なぜ要るのか（[#2052](https://github.com/Ayato-kosaka/nanitabeyo/issues/2052)）
 *
 * 2026-09-24 10:59、`20260924T0100_drop_google_derived_columns.sql` を dev へ当てた 33 秒後から
 * **dev の API が全件 500 になり、14 時間直らなかった**（約 15 万件）。原因は 1 つだけである。
 *
 * > expand → **アプリを出す** → contract の **真ん中が抜けていた**。
 * > dev に載っていた API は 2026-09-10 の版で、落とした列をまだ読んでいた。
 *
 * ⚠️ **既にある門番はここを守らない。**
 * `db-migrate.yml` は適用後に introspect して `shared` のビルドを検算するが、
 * ① 見ているのは **リポジトリのコード**であって «いま載っているコード» ではない、
 * ② しかも **DDL が当たった後**に走るので、落ちても列は戻らない。
 *
 * ## 何を見るか
 *
 * 落とす列を «いま載っているコードが読んでいるか» を、**その版の
 * `shared/prisma/schema.prisma`** で見る。Prisma の schema は「その版のコードが
 * DB に何があると思っているか」そのものなので、生 SQL でもクエリビルダでも
 * **同じ 1 枚**で判定できる（#2052 で落ちたのは生クエリだが、その commit の
 * schema.prisma には当該列がまだ宣言されていた）。
 *
 * その版の commit は **`api-deploy.yml` の «成功した最新 run» の head_sha** から引く。
 * Cloud Run へ問い合わせる資格情報が要らず、`actions: read` だけで済む。
 *
 * ## 落ちる向きの設計
 *
 * | 状況 | 結果 |
 * | --- | --- |
 * | 落とす DDL が 1 つも無い | **通す**（見るものが無い。ほとんどの migration がここ） |
 * | 落とす列が、その版の schema に**もう無い** | **通す**（コードが先に出ている＝正しい順番） |
 * | 落とす列が、その版の schema に**まだある** | **落とす**。先にコードを出す |
 * | 落とす DDL があるのに、その版が分からない | **落とす**（`--allow-unknown-deployment` で明示的に降りられる） |
 *
 * ⚠️ **最後の行を «通す» にしないこと。** 分からないときに通すと、この門番は
 * «GitHub API が機嫌よく答えたときだけ働く» ものになる。#2052 はまさに
 * «誰も見ていなかった» ことで起きている。
 */

/** DB_SCHEMA と API の出し先の対応。`api-deploy.yml` の job 名がこの語を含む。 */
export const SCHEMA_TO_DEPLOY_TARGET = { dev: "development", public: "production" };

/**
 * migration から «落とす / 名前を変える» 対象を拾う。
 *
 * ⚠️ `stripSqlNoise` を通してから見ること。日本語コメントに `DROP COLUMN` と
 *    書いてあるだけの行で migration が流せなくなる（既存の門番が踏んだ形と同じ）。
 *
 * @param {string} sql
 * @returns {{kind: "column"|"table", table: string, column?: string, how: string}[]}
 */
export function findDestructiveChanges(sql) {
	const stripped = stripSqlNoise(sql);
	const found = [];
	const ident = `(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
	const unquote = (value) => value.replace(/^"|"$/g, "");

	// ALTER TABLE [IF EXISTS] [schema.]t ... DROP [COLUMN] [IF EXISTS] c
	// ⚠️ 1 つの ALTER TABLE に DROP が複数並ぶ（`DROP COLUMN a, DROP COLUMN b`）ので、
	//    ALTER 文ごとに «その文の中の DROP を全部» 拾う。
	const alterRe = new RegExp(
		`\\balter\\s+table\\s+(?:if\\s+exists\\s+)?(?:${ident}\\s*\\.\\s*)?(${ident})([^;]*)`,
		"gi",
	);
	for (const alter of stripped.matchAll(alterRe)) {
		const table = unquote(alter[1]);
		const rest = alter[2] ?? "";
		const dropRe = new RegExp(`\\bdrop\\s+(?:column\\s+)?(?:if\\s+exists\\s+)?(${ident})`, "gi");
		for (const drop of rest.matchAll(dropRe)) {
			// DROP CONSTRAINT / DROP DEFAULT / DROP NOT NULL は列を消さない
			const name = unquote(drop[1]);
			if (/^(constraint|default|not|identity|expression)$/i.test(name)) continue;
			found.push({ kind: "column", table, column: name, how: "DROP COLUMN" });
		}
		const renameRe = new RegExp(`\\brename\\s+(?:column\\s+)?(${ident})\\s+to\\b`, "gi");
		for (const rename of rest.matchAll(renameRe)) {
			// ⚠️ 改名は «落として足す» と同じである。古い名前で読んでいるコードは落ちる
			found.push({ kind: "column", table, column: unquote(rename[1]), how: "RENAME COLUMN" });
		}
	}

	// DROP TABLE [IF EXISTS] [schema.]t
	const dropTableRe = new RegExp(`\\bdrop\\s+table\\s+(?:if\\s+exists\\s+)?(?:${ident}\\s*\\.\\s*)?(${ident})`, "gi");
	for (const match of stripped.matchAll(dropTableRe)) {
		found.push({ kind: "table", table: unquote(match[1]), how: "DROP TABLE" });
	}
	return found;
}

/**
 * Prisma の schema から 1 つの model の本文を取り出す。見つからなければ null。
 *
 * @param {string} prisma
 * @param {string} model
 * @returns {string | null}
 */
export function prismaModelBody(prisma, model) {
	const re = new RegExp(`^model\\s+${model}\\s*\\{([\\s\\S]*?)^\\}`, "m");
	const match = re.exec(prisma);
	return match ? match[1] : null;
}

/**
 * その版の schema が、その列（または table）を **まだ持っているか**。
 *
 * @param {string} prisma その版の schema.prisma
 * @param {{kind: "column"|"table", table: string, column?: string}} change
 * @returns {boolean}
 */
export function deployedSchemaStillHas(prisma, change) {
	const body = prismaModelBody(prisma, change.table);
	if (body === null) return false; // その版にそもそも model が無い
	if (change.kind === "table") return true;
	// フィールドは行頭（インデントのみ）に名前が来る。`@map` や relation もこの形。
	// ⚠️ 単語境界だけで探すと `name` が `name_language_code` に当たる。行頭に固定する
	const fieldRe = new RegExp(`^[ \\t]*${change.column}[ \\t]+\\S`, "m");
	return fieldRe.test(body);
}

// ─────────────────────────────────────────────────────────────────────────────
// ここから下は I/O（GitHub API）。上の関数は純関数なのでテストから直接呼べる。
// ─────────────────────────────────────────────────────────────────────────────

const GITHUB_API = process.env.GITHUB_API_URL ?? "https://api.github.com";

async function githubJson(path) {
	const token = process.env.GITHUB_TOKEN;
	if (!token) throw new Error("GITHUB_TOKEN が無いため、いま載っている版を引けません");
	const response = await fetch(`${GITHUB_API}${path}`, {
		headers: {
			authorization: `Bearer ${token}`,
			accept: "application/vnd.github+json",
			"x-github-api-version": "2022-11-28",
		},
	});
	if (!response.ok) throw new Error(`GitHub API ${path} → ${response.status}`);
	return response.json();
}

/**
 * `api-deploy.yml` の «成功した最新 run» のうち、その環境へ出したものの head_sha を返す。
 *
 * ⚠️ run の一覧には dispatch の inputs が入らない。job 名（`Deploy (development)`）で
 *    見分ける。workflow 側の `name:` を変えるとここが効かなくなるので、
 *    自己テストで job 名の形を縛っている。
 *
 * @param {string} repo "owner/name"
 * @param {string} deployTarget "development" | "production"
 * @returns {Promise<string | null>}
 */
export async function findDeployedSha(repo, deployTarget) {
	const runs = await githubJson(`/repos/${repo}/actions/workflows/api-deploy.yml/runs?status=success&per_page=30`);
	for (const run of runs.workflow_runs ?? []) {
		const jobs = await githubJson(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=50`);
		const matched = (jobs.jobs ?? []).some(
			(job) => job.name === `Deploy (${deployTarget})` && job.conclusion === "success",
		);
		if (matched) return run.head_sha;
	}
	return null;
}

async function fetchPrismaAt(repo, sha) {
	const meta = await githubJson(`/repos/${repo}/contents/shared/prisma/schema.prisma?ref=${encodeURIComponent(sha)}`);
	if (typeof meta.content !== "string") throw new Error("schema.prisma の内容が取れませんでした");
	return Buffer.from(meta.content, meta.encoding === "base64" ? "base64" : "utf8").toString("utf8");
}

async function main() {
	const args = process.argv.slice(2);
	const take = (flag) => {
		const i = args.indexOf(flag);
		if (i === -1) return null;
		const value = args[i + 1];
		args.splice(i, 2);
		return value;
	};
	const has = (flag) => {
		const i = args.indexOf(flag);
		if (i === -1) return false;
		args.splice(i, 1);
		return true;
	};

	const targetSchema = take("--target-schema") ?? "dev";
	const shaOverride = take("--deployed-sha");
	const prismaOverride = take("--deployed-prisma-file");
	const allowUnknown = has("--allow-unknown-deployment");
	const repo = process.env.GITHUB_REPOSITORY ?? "Ayato-kosaka/nanitabeyo";

	if (!Object.hasOwn(SCHEMA_TO_DEPLOY_TARGET, targetSchema)) {
		console.error("--target-schema は dev または public を指定してください。");
		return 2;
	}
	const files = args;
	if (files.length === 0) {
		console.error(
			"使い方: node scripts/assert-drop-safe-for-deployed-code.mjs --target-schema <dev|public> <file.sql> [...]",
		);
		return 2;
	}

	const changes = files.flatMap((file) =>
		findDestructiveChanges(readFileSync(file, "utf8")).map((change) => ({ ...change, file })),
	);
	if (changes.length === 0) {
		console.log(`✅ ${files.length} ファイルに列やテーブルを落とす DDL はありません`);
		return 0;
	}

	console.log("── 落とす / 改名する対象 ──");
	for (const c of changes) {
		console.log(`   ${c.how}  ${c.table}${c.column ? `.${c.column}` : ""}  (${c.file})`);
	}

	let prisma;
	let sha = shaOverride;
	try {
		if (prismaOverride) {
			prisma = readFileSync(prismaOverride, "utf8");
			sha ??= "(ローカル指定)";
		} else {
			sha ??= await findDeployedSha(repo, SCHEMA_TO_DEPLOY_TARGET[targetSchema]);
			if (!sha) throw new Error(`api-deploy.yml の成功 run が見つかりません（${targetSchema}）`);
			prisma = await fetchPrismaAt(repo, sha);
		}
	} catch (error) {
		console.error(`⚠️ いま動いているコードを特定できませんでした: ${error.message}`);
		if (allowUnknown) {
			console.error("   --allow-unknown-deployment が指定されているので通します。");
			return 0;
		}
		console.error("");
		console.error("   列を落とす migration は «そのコードが出ていること» を確かめないと当てられません。");
		console.error("   確かめられないまま流すなら --allow-unknown-deployment を明示してください。");
		return 1;
	}

	console.log(`── いま ${SCHEMA_TO_DEPLOY_TARGET[targetSchema]} に載っているコード: ${sha} ──`);
	const blocking = changes.filter((change) => deployedSchemaStillHas(prisma, change));
	if (blocking.length > 0) {
		console.error("❌ いま動いているコードが、これから落とす列／テーブルをまだ読んでいます。");
		for (const c of blocking) {
			console.error(`   ${c.table}${c.column ? `.${c.column}` : ""} … ${sha} の schema.prisma にまだある`);
		}
		console.error("");
		console.error("   expand → **コードを出す** → contract の順です。先に API を出してください。");
		console.error("   （#2052: この順番を飛ばして dev の API が 14 時間 500 を返しました）");
		return 1;
	}

	console.log(`✅ 落とす ${changes.length} 件はどれも ${sha} のコードが読んでいません`);
	return 0;
}

// テストから import されたときは実行しない
if (import.meta.url === `file://${process.argv[1]}`) {
	process.exitCode = await main();
}
