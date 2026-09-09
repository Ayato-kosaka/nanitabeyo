// #1196 error-triage / SQL 生成器と生成物のテスト。
//
// このファイルの役割は「生成物 `sql/error-triage.sql` が、いま現在のルール表・定数から
// 生成されたものと1バイトも違わない」ことを固定することです。ズレたら CI が赤になります。
// SQL を手書きして二重管理にした瞬間、SQL 側の REGEXP_REPLACE と JS の normalize() が
// 別の結果を出し、同じエラーが2グループに割れて重複起票されます。
//
// あわせて、レビューの blocker 由来の制約（単一文 / QUALIFY / 窓リテラル / ビュー不参照 /
// TO_JSON_STRING(jsonPayload) 不使用 / 三重引用 raw 文字列）も機械的に検査します。

"use strict";

const { readFileSync } = require("node:fs");

const { EXCLUDED_HTTP_STATUSES, FP_ALGO_VERSION, GROUP_LIMIT, MESSAGE_PATTERN_MAX_LENGTH, TRANSIENT_HTTP_STATUSES } = require("./constants");
const { assertSqlFpAlgoVersion, FINGERPRINT_KEY_FIELDS, parseSqlFpAlgoVersion } = require("./fingerprint");
const { NORMALIZE_RULES, POST_RULE_STEPS, SQL_EXPR_PLACEHOLDER } = require("./normalize-rules");
const { SQL_FILE_PATH, readGeneratedSql } = require("./generate-sql");
const {
	NORMALIZED_SLOTS,
	RAW_STRING_DELIMITER,
	SOURCE_TABLE,
	WINDOW_END_PLACEHOLDER,
	WINDOW_START_PLACEHOLDER,
	buildNormalizeExpression,
	generateErrorTriageSql,
	toRawStringLiteral,
	toStringLiteral,
} = require("./sql-generator");

const generated = generateErrorTriageSql();

/**
 * コメントを落として「実際に BigQuery が解釈する部分」だけにする。
 *
 * 生成物には「なぜそうしないのか」を説明するコメントが多く、そこには禁止事項の名前
 * （`CREATE TEMP FUNCTION` / `TO_JSON_STRING(jsonPayload)` / `ANY_VALUE()` など）が
 * そのまま書かれている。禁止事項の検査を素の全文へ掛けると、説明を書いた瞬間に赤くなる。
 *
 * 行頭コメントは行ごと落とし、行末コメントは「2スペース + `-- `」だけを区切りとして落とす。
 * 正規表現パターンのリテラルに `--` が含まれないことは同ファイル内のテストで固定してある。
 *
 * @param {string} sql
 * @returns {string}
 */
const stripSqlComments = (sql) =>
	sql
		.split("\n")
		.filter((line) => !/^\s*--/.test(line))
		.map((line) => {
			const at = line.indexOf("  -- ");
			return at === -1 ? line : line.slice(0, at);
		})
		.join("\n");

const code = stripSqlComments(generated);

test("正規表現リテラルに `--` が含まれない（コメント除去が安全であることの前提）", () => {
	for (const rule of NORMALIZE_RULES) {
		expect(rule.re2Pattern.includes("--")).toBe(false);
	}
});

describe("生成物とルール表が一致している（これが PR2 の存在意義）", () => {
	test("sql/error-triage.sql は現在のルール表から生成したものと完全に一致する", () => {
		const onDisk = readGeneratedSql();
		expect(onDisk).not.toBeNull();
		// 差分が出たら `pnpm --filter error-triage generate:sql` を回して commit すること。
		expect(onDisk).toBe(generated);
	});

	test("生成は決定的（同じ入力から2回生成して同じ文字列になる）", () => {
		expect(generateErrorTriageSql()).toBe(generated);
	});

	test("全ルールの re2Pattern が生成物に1つずつ現れる", () => {
		for (const rule of NORMALIZE_RULES) {
			expect(generated).toContain(toRawStringLiteral(rule.re2Pattern));
		}
	});

	test("JS 表記（pattern）が RE2 表記と違うルールは、JS 表記の方を生成物へ入れていない", () => {
		for (const rule of NORMALIZE_RULES) {
			if (rule.pattern === rule.re2Pattern) continue;
			expect(generated).not.toContain(rule.pattern);
		}
	});

	test("POST_RULE_STEPS の SQL 断片が順に効いている（trim → 切り出し → trim）", () => {
		for (const step of POST_RULE_STEPS) {
			const fragment = step.sql.split(SQL_EXPR_PLACEHOLDER);
			for (const piece of fragment) {
				if (piece.trim() === "") continue;
				expect(generated).toContain(piece);
			}
		}
		expect(generated).toContain(`, 1, ${MESSAGE_PATTERN_MAX_LENGTH})`);
	});

	test("生成物に <expr> プレースホルダが残っていない", () => {
		expect(generated).not.toContain(SQL_EXPR_PLACEHOLDER);
	});
});

describe("1-3: SQL 冒頭の `-- fpalgo: N` が JS の FP_ALGO_VERSION と一致する", () => {
	test("マーカーが読める", () => {
		expect(parseSqlFpAlgoVersion(generated)).toBe(FP_ALGO_VERSION);
	});

	test("ディスク上の生成物でも一致する", () => {
		const result = assertSqlFpAlgoVersion(readFileSync(SQL_FILE_PATH, "utf8"));
		expect(result).toEqual({ ok: true, sqlVersion: FP_ALGO_VERSION, jsVersion: FP_ALGO_VERSION, message: null });
	});

	test("片方だけ変えたら落ちる（検査が実際に効く）", () => {
		const tampered = generated.replace(`-- fpalgo: ${FP_ALGO_VERSION}`, `-- fpalgo: ${FP_ALGO_VERSION + 1}`);
		expect(assertSqlFpAlgoVersion(tampered).ok).toBe(false);
	});
});

describe("PR #1200 申し送り: re2Pattern を三重引用 raw 文字列で埋め込む", () => {
	test("どの re2Pattern も ''' を含まない（三重引用で安全に収まる）", () => {
		for (const rule of NORMALIZE_RULES) {
			expect(rule.re2Pattern.includes(RAW_STRING_DELIMITER)).toBe(false);
			expect(rule.pattern.includes(RAW_STRING_DELIMITER)).toBe(false);
		}
	});

	test("どの re2Pattern も末尾が ' ではない（区切りが 4 連続になると構文エラー）", () => {
		for (const rule of NORMALIZE_RULES) {
			expect(rule.re2Pattern.endsWith("'")).toBe(false);
		}
	});

	test("どの re2Pattern も奇数個のバックスラッシュで終わらない", () => {
		for (const rule of NORMALIZE_RULES) {
			expect(/(\\*)$/.exec(rule.re2Pattern)[1].length % 2).toBe(0);
		}
	});

	test("ルール6（url-query）は ' と \" を両方含むので、r'...' / r\"...\" では埋め込めない", () => {
		const urlQuery = NORMALIZE_RULES.find((rule) => rule.name === "url-query");
		// これが前提。前提が崩れたら三重引用にした理由も消えるので、ここで気づけるようにする。
		expect(urlQuery.re2Pattern).toContain("'");
		expect(urlQuery.re2Pattern).toContain('"');
		expect(generated).toContain(`r'''${urlQuery.re2Pattern}'''`);
	});

	test("埋め込めないパターンは生成器が例外を投げる（黙って壊れた SQL を吐かない）", () => {
		expect(() => toRawStringLiteral("a'''b")).toThrow(/''' を含む/);
		expect(() => toRawStringLiteral("abc'")).toThrow(/末尾が '/);
		expect(() => toRawStringLiteral("abc\\")).toThrow(/バックスラッシュ/);
	});

	test("置換後文字列は raw ではない通常のリテラルとしてエスケープされる", () => {
		expect(toStringLiteral("<ts>")).toBe("'<ts>'");
		expect(toStringLiteral("a'b")).toBe("'a\\'b'");
		expect(toStringLiteral("a\\b")).toBe("'a\\\\b'");
	});
});

describe("B3: 単一文であること（multi-statement script にすると dry-run が見積りを返さない）", () => {
	test("CREATE TEMP FUNCTION を使っていない", () => {
		expect(code).not.toMatch(/CREATE\s+(?:TEMP|TEMPORARY)\s+FUNCTION/i);
		expect(code).not.toMatch(/\bCREATE\b/i);
	});

	test("文の区切り（;）が1つも無い", () => {
		expect(generated.includes(";")).toBe(false);
	});

	test("正規化式は1回しか書かれていない（UNNEST + WITH OFFSET 方式）", () => {
		// 最も長い（＝コピペしたら必ず増える）ルール8 のパターンの出現回数で数える。
		const opaque = NORMALIZE_RULES.find((rule) => rule.name === "opaque-token");
		const occurrences = generated.split(toRawStringLiteral(opaque.re2Pattern)).length - 1;
		expect(occurrences).toBe(1);
		expect(generated).toContain("WITH OFFSET off");
	});

	test("正規化の対象は 5 スロットで、SQL が全て OFFSET(n) で取り出している", () => {
		expect(NORMALIZED_SLOTS).toHaveLength(5);
		for (const slot of NORMALIZED_SLOTS) {
			expect(generated).toContain(`IFNULL(${slot.source}, '')`);
			expect(generated).toContain(`OFFSET(${slot.offset})`);
		}
	});

	test("buildNormalizeExpression は最内に渡した式を含み、ルール数ぶんの層を持つ", () => {
		const expression = buildNormalizeExpression({ innerExpr: "someColumn", baseLevel: 0 });
		expect(expression).toContain("someColumn");
		expect(expression.split("REGEXP_REPLACE(").length - 1).toBe(NORMALIZE_RULES.length);
	});
});

describe("S6: LIMIT ではなく QUALIFY。groupCount は制限「前」から数える", () => {
	test("QUALIFY ROW_NUMBER() で上限を掛けている", () => {
		expect(generated).toMatch(/QUALIFY ROW_NUMBER\(\) OVER \(/);
		expect(generated).toContain(`) <= ${GROUP_LIMIT}`);
	});

	test("グループ行の出力側に LIMIT が無い（切り捨て件数が数えられなくなる）", () => {
		expect(code).not.toMatch(/\nLIMIT \d+/);
	});

	test("groupCount は QUALIFY を掛ける前の grouped から数えている", () => {
		expect(generated).toContain("(SELECT COUNT(*) FROM grouped)                    AS groupCount");
		// 制限後の limited から数えていたら切り捨て検知が原理的に不能になる
		expect(generated).not.toContain("FROM limited) AS groupCount");
	});

	test("groupLimit は constants.js の GROUP_LIMIT と一致する", () => {
		expect(generated).toContain(`AS groupLimit`);
		expect(generated).toContain(String(GROUP_LIMIT));
	});

	test("集合演算の入力に ORDER BY / LIMIT を付けていない（括弧が要るので構文エラーの元）", () => {
		const [groupBranch, summaryBranch] = generated.split("\nUNION ALL\n");
		expect(groupBranch).toContain("FROM limited g");
		expect(groupBranch).not.toMatch(/\nORDER BY /);
		expect(summaryBranch).not.toMatch(/\nORDER BY /);
	});
});

describe("B5 / G1: 25h スライド窓はリテラル埋め込み", () => {
	test("テンプレート変数は窓の2つだけ", () => {
		const placeholders = [...generated.matchAll(/\{\{[A-Za-z0-9_]+\}\}/g)].map((match) => match[0]);
		expect(new Set(placeholders)).toEqual(new Set([WINDOW_START_PLACEHOLDER, WINDOW_END_PLACEHOLDER]));
	});

	test("timestamp によるパーティション枝刈りが両端とも入っている", () => {
		expect(generated).toContain(`timestamp >= TIMESTAMP '${WINDOW_START_PLACEHOLDER}'`);
		expect(generated).toContain(`timestamp <  TIMESTAMP '${WINDOW_END_PLACEHOLDER}'`);
	});

	test("CURRENT_TIMESTAMP() を SQL 内で使っていない（枝刈りの保証が崩れる）", () => {
		expect(code).not.toMatch(/CURRENT_TIMESTAMP\s*\(/i);
		expect(code).not.toMatch(/CURRENT_DATE\s*\(/i);
	});
});

describe("#1196 確定事項: 何を読み、何を読まないか", () => {
	test("生 Sink テーブルを直読みしている", () => {
		expect(generated).toContain(`FROM \`${SOURCE_TABLE}\``);
	});

	test("ビュー（frontend_event_logs 等）を FROM に置いていない", () => {
		for (const view of ["frontend_event_logs", "backend_event_logs", "external_api_logs"]) {
			// log_type の値としては出てくるので、FROM 句に出てこないことを見る
			expect(generated).not.toMatch(new RegExp(`FROM\\s+\`?[\\w.-]*${view}\`?`));
		}
	});

	test("*_legacy テーブルを参照していない", () => {
		expect(code).not.toContain("_legacy");
	});

	test("TO_JSON_STRING(jsonPayload) を使っていない（全リーフ読み = 18.4GB/日 の再現）", () => {
		expect(code).not.toMatch(/TO_JSON_STRING\(\s*jsonPayload\s*\)/);
	});

	test("jsonPayload.error_message を直接参照していない（STRUCT に存在せずクエリ全体が失敗する）", () => {
		expect(code).not.toMatch(/jsonPayload\.error_message/);
		// 存在しない列は NULL 定数に固定してある（横断レビュー §6-3 / #1197 §8-1 の退避策）
		expect(code).toContain("CAST(NULL AS STRING)                        AS extErrorMessage");
	});

	test("参照している jsonPayload.* の列が、移行 SQL で実在が裏付けられているものだけ", () => {
		// infra/big-query/migration/20251203T0000_... のビュー定義が直接参照している列
		//（＝ビュー作成時に BigQuery が解決できた＝実在する）だけを使う。
		const verified = new Set([
			"log_type",
			"error_level",
			"event_name",
			"path_name",
			"function_name",
			"user_id",
			"created_commit_id",
			"created_app_version",
			"api_name",
			"endpoint",
			"method",
			"status_code",
			"payload",
		]);
		const referenced = new Set([...code.matchAll(/jsonPayload\.([A-Za-z0-9_]+)/g)].map((match) => match[1]));
		expect(referenced.size).toBeGreaterThan(0);
		for (const column of referenced) expect(verified.has(column)).toBe(true);
	});

	test("SELECT * を使っていない", () => {
		expect(code).not.toMatch(/SELECT\s+\*/);
		expect(code).not.toMatch(/\.\*\s+EXCEPT/);
	});
});

describe("B1 / 契約の不変条件 1: SQL の GROUP BY が fingerprint のキー集合と一致する", () => {
	const groupByLine = /GROUP BY\n\s+(surface[\s\S]*?keyMessagePattern)/.exec(generated);

	test("GROUP BY 句が読み取れる", () => {
		expect(groupByLine).not.toBeNull();
	});

	test("FINGERPRINT_KEY_FIELDS の全フィールドが key* 列として GROUP BY に入っている", () => {
		const groupBy = groupByLine[1].replace(/\s+/g, " ");
		const allKeyFields = new Set(Object.values(FINGERPRINT_KEY_FIELDS).flat());
		for (const field of allKeyFields) {
			const column = `key${field[0].toUpperCase()}${field.slice(1)}`;
			expect(groupBy).toContain(column);
		}
		// messagePattern（frontend / backend の fingerprint に入る）も忘れず入っていること
		expect(groupBy).toContain("keyMessagePattern");
		expect(groupBy).toContain("surface");
	});

	test("fingerprint に含めないフィールド（errorCode）はグルーピングキーに入れていない", () => {
		const groupBy = groupByLine[1].replace(/\s+/g, " ");
		expect(groupBy).not.toContain("errorCode");
	});

	test("fingerprint / schemaVersion / fpAlgoVersion は SQL 側では出さない（JS が注入する）", () => {
		expect(generated).not.toContain("AS fingerprint");
		expect(generated).not.toContain("AS schemaVersion");
		expect(generated).not.toContain("AS fpAlgoVersion");
		expect(generated).not.toMatch(/TO_HEX\(MD5\(/);
	});

	test("非決定的な ANY_VALUE() を使っていない（同じ入力から違う本文が出る）", () => {
		expect(code).not.toMatch(/ANY_VALUE\s*\(/);
	});
});

describe("契約 §7: 出力フィールドが揃っている（camelCase で統一）", () => {
	const expectedGroupFields = [
		"surface",
		"groupKey",
		"messagePattern",
		"occurrences",
		"affectedUsers",
		"anonymousOccurrences",
		"firstSeenUtc",
		"lastSeenUtc",
		"hourlyCounts",
		"commits",
		"appVersions",
		"representativeCommit",
	];

	test.each(expectedGroupFields)("group 行に %s がある", (field) => {
		expect(generated).toContain(`AS ${field}`);
	});

	const expectedGroupKeyFields = [
		"eventName",
		"pathName",
		"functionName",
		"apiName",
		"endpoint",
		"method",
		"statusCode",
		"httpStatus",
		"route",
		"errorCode",
	];

	test.each(expectedGroupKeyFields)("groupKey に %s がある", (field) => {
		expect(generated).toContain(`AS ${field}`);
	});

	const expectedRunSummaryFields = ["groupCount", "groupLimit", "keptRows", "excludedRows", "excludedBreakdown"];

	test.each(expectedRunSummaryFields)("run_summary に %s がある", (field) => {
		expect(generated).toContain(`AS ${field}`);
	});

	test("kind は group / run_summary の2値", () => {
		expect(generated).toContain("'group'                AS kind");
		expect(generated).toContain("'run_summary' AS kind");
	});

	test("時刻は RFC3339 UTC（秒精度）で出す", () => {
		expect(generated).toContain("FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ'");
		expect(generated).toContain("FORMAT_TIMESTAMP('%Y-%m-%dT%H:00:00Z'");
	});

	test("dailyCounts ではなく hourlyCounts（矛盾B / S5）", () => {
		expect(code).not.toContain("dailyCounts");
		expect(generated).toContain("AS hourlyCounts");
	});
});

describe("不変条件 3 / 4: 生値と禁止フィールドを契約へ出さない", () => {
	test("route / endpoint / pathName / messagePattern は全て正規化後の norm[] 由来", () => {
		expect(generated).toContain("NULLIF(n.norm[OFFSET(0)], '')");
		// OFFSET(1)（pathName）は norm[] のあとに先頭ロケール剥がしを1段挟むので NULLIF が離れる（fpalgo 2）
		expect(generated).toContain("n.norm[OFFSET(1)]");
		expect(generated).toContain("NULLIF(n.norm[OFFSET(2)], '')");
		expect(generated).toContain("NULLIF(n.norm[OFFSET(3)], '')");
		expect(generated).toContain("NULLIF(n.norm[OFFSET(4)], '')");
	});

	test("payload / request_payload / response_payload をそのまま出力していない", () => {
		const [output] = generated.split("SELECT TO_JSON_STRING(STRUCT(").slice(1);
		for (const forbidden of ["payloadText", "requestPayload", "responsePayload", "rawMessage"]) {
			expect(output).not.toContain(forbidden);
		}
	});

	test("user_id の値そのものを出力していない（数えるだけ）", () => {
		expect(generated).toContain("COUNT(DISTINCT userId)");
		expect(generated).toContain("COUNTIF(userId IS NULL)");
		expect(generated).not.toContain("AS userId,\n  g.");
	});
});

describe("除外ルール: constants.js が唯一の正", () => {
	/*
	#1834 **frontend（E4）と backend（E6）は別の定数を使う。**

	403 / 404 を除外する理由は «Cloud Run が公開エンドポイントなので外部スキャナが来る» で、
	これは backend 側の性質である。frontend のログは自分たちのアプリが呼んだときにしか
	出ないのでスキャナは 1 行も作れず、frontend の 404 は «存在しない URL を自分で叩いた»
	＝ 実バグである。**同じ定数を共有していると、この違いが消える。**
	*/
	test("backend（E6）は EXCLUDED_HTTP_STATUSES を 1 回だけ使う", () => {
		const list = EXCLUDED_HTTP_STATUSES.join(", ");
		expect(generated.split(`IN (${list})`).length - 1).toBe(1);
		expect(generated).toContain(`SAFE_CAST(n.beHttpStatus AS INT64) IN (${list})`);
	});

	test("frontend（E4）は TRANSIENT_HTTP_STATUSES を使う（403 / 404 を除外しない）", () => {
		const list = TRANSIENT_HTTP_STATUSES.join(", ");
		expect(generated).toContain(`SAFE_CAST(n.feHttpStatus AS INT64) IN (${list})`);
		for (const status of [403, 404]) {
			expect(TRANSIENT_HTTP_STATUSES).not.toContain(status);
		}
	});

	/*
	#1834 **タイムアウト（timedOut: true）は «端末の回線起因» ではない。**
	自前の 30 秒タイマーだけが立てるフラグで、«届いたがサーバが返さなかった» を意味する。
	*/
	test("E3 は timedOut: true を除外しない", () => {
		expect(generated).toContain("IFNULL(n.feTimedOut, '') != 'true'");
	});

	/*
	#1834 **外部 API の 3xx は «成功» ではない。**
	SafeFetch はリダイレクトを追わないので、3xx が返った時点でデータは取れていない。
	*/
	test("external の収集条件は 3xx も拾う", () => {
		expect(generated).toContain("SAFE_CAST(jsonPayload.status_code AS INT64) >= 300");
		expect(generated).not.toContain("SAFE_CAST(jsonPayload.status_code AS INT64) >= 400");
	});

	/*
	#1834 **status_code = 0（接続そのものが成立しない）は «外部の一時障害» ではない。**
	相手が落ちているのか、こちらの出口が塞がれているのかを区別しないため。
	*/
	test("E7 は status_code = 0 を除外しない", () => {
		expect(generated).toContain("n.extStatusCode IN (408, 429, 502, 503, 504)");
	});

	test("400 / 409 / 422 は除外リストに入っていない（レビュー §6-4）", () => {
		for (const status of [400, 409, 422]) {
			expect(EXCLUDED_HTTP_STATUSES).not.toContain(status);
		}
	});

	test("E5 は denied / timeout / unavailable を除外する（unsupported はオーナー判断で残す）", () => {
		expect(generated).toContain("n.feKind IN ('denied', 'timeout', 'unavailable')");
		expect(code).not.toContain("'unsupported'");
		expect(code).not.toContain("'permission_denied'");
	});

	test("E5 は current_location_* の event に閉じている", () => {
		// ⚠️ kind の値だけで判定すると、位置情報と無関係な機能が将来 `kind: 'timeout'` を
		// 積んだときに、その不具合が理由も告げずに除外される（＝ 見えない失敗）。
		// event 名で閉じることで、取りこぼしても «Issue が立つ» 側へ倒す。
		expect(generated).toContain("STARTS_WITH(IFNULL(n.eventName, ''), 'current_location_')");
	});

	test("除外行は WHERE で消さず理由付きで残している", () => {
		expect(generated).toContain("AS excludedReason");
		expect(generated).toContain("WHERE excludedReason IS NOT NULL");
		expect(generated).toContain("WHERE excludedReason IS NULL");
	});

	test("excludedBreakdown は (reason, eventName, httpStatus) 単位", () => {
		expect(generated).toContain("GROUP BY reason, eventName, httpStatus");
	});

	test("EXCLUSION_REASONS の識別子が全て SQL に現れる", () => {
		const { EXCLUSION_REASONS } = require("./constants");
		for (const reason of EXCLUSION_REASONS) {
			expect(generated).toContain(`'${reason}'`);
		}
	});
});
