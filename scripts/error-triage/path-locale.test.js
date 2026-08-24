// #1196 error-triage / pathName の先頭ロケール剥がし（fpalgo 2 / CLUSTERING.md 類型1）のテスト。
//
// このファイルが守るもの:
//   1. 剥がすべきものを剥がす（実データにある形を全部）
//   2. **剥がしてはいけないものを剥がさない**（画面名を消したら Issue の意味が変わる）
//   3. RE2（BigQuery）と JS が同じ意味になる ← 過去に `\s` の定義差で事故った箇所（PR #1200 B-1）
//   4. 剥がした結果、ロケール違いが**同じ fingerprint** に畳まれる
//   5. 剥がしたロケールを捨てず、Issue 本文へ内訳が出る

"use strict";

const { FP_ALGO_VERSION } = require("./constants");
const { computeFingerprint } = require("./fingerprint");
const {
	LOCALE_PREFIX_PATTERN,
	PATH_LOCALE_EXTRACT,
	PATH_LOCALE_RULES,
	extractPathLocale,
	isPathLocaleStripped,
	normalize,
	normalizePathName,
	restorePathLocale,
	stripPathLocale,
} = require("./normalize-rules");
const { renderIssueBody, renderJobSummary } = require("./render");
const { RAW_STRING_DELIMITER, generateErrorTriageSql, toRawStringLiteral } = require("./sql-generator");
const { buildEnvelope, buildPlan, validateEnvelope } = require("./triage");
const { computeWindow } = require("./window");

const WINDOW = computeWindow({ now: "2026-08-07T00:05:12Z" });
const GENERATED_AT = "2026-08-07T00:05:12Z";

// ---------------------------------------------------------------------------
// 1) 剥がすべきものを剥がす
// ---------------------------------------------------------------------------

describe("剥がす — #1196 の実データにある path_name の形", () => {
	// オーナーが本番ログで確認した実例。ここに無い形を勝手に足さない（推測で広げると剥がしすぎる）。
	it.each([
		["/ja-JP", "/", "ja-JP"],
		["/ja", "/", "ja"],
		["/en-US", "/", "en-US"],
		["/en-IE/search/result", "/search/result", "en-IE"],
		["/ja-JP/search/result", "/search/result", "ja-JP"],
		["/zh-CN/contribution-tasks/dish-copy-survey", "/contribution-tasks/dish-copy-survey", "zh-CN"],
		["/ar/contribution-tasks/dish-ranking-summary", "/contribution-tasks/dish-ranking-summary", "ar"],
		["/hi/contribution-tasks/dish-copy-survey", "/contribution-tasks/dish-copy-survey", "hi"],
		["/zh/posts", "/posts", "zh"],
		// `[locale]` が未解決のまま載った実例。**同じ画面**なので同じく剥がす（判断は PR 本文を参照）
		[
			"/es-ES/[locale]/contribution-tasks/dish-category-manual-image-supply",
			"/contribution-tasks/dish-category-manual-image-supply",
			"es-ES/[locale]",
		],
		["/ko-KR/[locale]/profile/blocked-dish-categories", "/profile/blocked-dish-categories", "ko-KR/[locale]"],
		["/fr-FR/[locale]/review/selectRestaurant", "/review/selectRestaurant", "fr-FR/[locale]"],
		// ロケールが1つも解決していないパターン
		["/[locale]/profile/settings", "/profile/settings", "[locale]"],
		["/[locale]", "/", "[locale]"],
		// BCP-47 のスクリプト付き / 数値リージョン（数値は先に走る正規化ルール9 で <n> になっている）
		["/zh-Hant/posts", "/posts", "zh-Hant"],
		["/zh-Hant-TW/posts", "/posts", "zh-Hant-TW"],
		["/es-<n>/posts", "/posts", "es-<n>"],
	])("%s → %s（ロケール %s）", (input, expected, locale) => {
		expect(stripPathLocale(input)).toBe(expected);
		expect(extractPathLocale(input)).toBe(locale);
	});

	it("UUID を含むパスは既存の正規化ルールで先に潰れている（投票ごとに別 Issue にならない）", () => {
		// `dish-category-group-votes/<shareToken>/vote` の shareToken は
		// randomUUID().replace(/-/g,'') の 32桁 hex（既存ルール7 hex-run が <hex> にする）。
		expect(normalizePathName("/ja-JP/search/dish-category-group-votes/b8bbd62775a549be8218eb3e60e4a3d1/vote")).toBe(
			"/search/dish-category-group-votes/<hex>/vote",
		);
		// ハイフン付きの UUID も既存ルール2 で <uuid> になる
		expect(normalizePathName("/en-US/review/post/9c1e77aa-2b31-41d0-9f2e-77aa2b3141d0")).toBe("/review/post/<uuid>");
		// 投票が2件あっても同じ pathName ＝ 同じ fingerprint
		expect(normalizePathName("/ja-JP/search/dish-category-group-votes/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/vote")).toBe(
			normalizePathName("/en-US/search/dish-category-group-votes/b8bbd62775a549be8218eb3e60e4a3d1/vote"),
		);
	});
});

// ---------------------------------------------------------------------------
// 2) 剥がしてはいけないもの
// ---------------------------------------------------------------------------

describe("剥がさない — app-expo のルーティングに実在する形", () => {
	// `app-expo/app/` のファイル一覧から拾った実在セグメント。
	// 画面は全て `app/[locale]/` 配下だが、剥がしたあとに**先頭へ来る**セグメントが
	// ロケールに見えてしまうと2段目が消える（`/ja-JP/map` → `/map` → `/` の事故）。
	it.each([
		["/map"], // ★ 3文字の小文字。素の3文字言語タグを許すと消える
		["/food"],
		["/post"],
		["/vote"],
		["/auth"],
		["/store"], // app/store.tsx（ロケール配下ではない実在ルート）
		["/posts"],
		["/dish-categories"],
		["/search"],
		["/profile"],
		["/review"],
		["/notifications"],
		["/contribution-tasks"],
		["/search/result"],
		["/profile/blocked-dish-categories"],
		["/review/selectRestaurant"],
		["/"],
	])("%s は1文字も変えない", (input) => {
		expect(stripPathLocale(input)).toBe(input);
		expect(extractPathLocale(input)).toBeNull();
		expect(isPathLocaleStripped(input)).toBe(true);
	});

	it("ロケールを剥がしたあと、2段目のセグメントを続けて剥がさない（/ja-JP/map → /map で止まる）", () => {
		expect(stripPathLocale("/ja-JP/map")).toBe("/map");
		expect(stripPathLocale(stripPathLocale("/ja-JP/map"))).toBe("/map");
	});

	it("正準でない大小文字は畳まない（畳み損ねる = 安全側。誤って画面名を消さない）", () => {
		expect(stripPathLocale("/ja-jp/search")).toBe("/ja-jp/search");
		expect(stripPathLocale("/JA-JP/search")).toBe("/JA-JP/search");
	});

	it("ロケール以外のスロット（backend の route / external の endpoint）には掛かっていない", () => {
		// PATH_LOCALE_RULES は pathName スロット専用。normalize() 単体は触らない。
		expect(normalize("/ja-JP/search/result")).toBe("/ja-JP/search/result");
		expect(normalize("/v1/dishes/bulk-import")).toBe("/v<n>/dishes/bulk-import");
	});

	it("冪等（剥がしたあとの値をもう一度通しても変わらない）", () => {
		for (const input of [
			"/ja-JP/search/result",
			"/ja-JP/map",
			"/ja-JP",
			"/[locale]",
			"/es-ES/[locale]/contribution-tasks/x",
			"/store",
			"/",
		]) {
			const once = stripPathLocale(input);
			expect(stripPathLocale(once)).toBe(once);
			expect(isPathLocaleStripped(once)).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// 2-b) ★ Minor-2（PR #1256 レビュー）: ロケール2段のパスは冪等にならない
// ---------------------------------------------------------------------------
//
// `stripPathLocale()` は PATH_LOCALE_RULES を各1回しか掛けないため、
// `/ja/en/foo` は `/en/foo` になり、その結果は「まだ剥がせる」＝ 冪等でない。
// 発生確率は低い（`app-expo/app/` にロケール直下の2文字小文字セグメントは無い）が、
// `+not-found.tsx` が任意 URL を拾うのでゼロではない。
// **この形が1グループ出ただけでその日のトリアージ全体が止まってはいけない。**

describe("ロケール2段のパス — そのグループだけを invalid にし、run 全体は止めない", () => {
	it.each([
		["/ja/en/foo", "/en/foo"],
		["/[locale]/es-ES/search", "/es-ES/search"],
	])("%s は1回しか剥がれないので冪等でない（既知の限界）", (input, once) => {
		expect(stripPathLocale(input)).toBe(once);
		expect(isPathLocaleStripped(stripPathLocale(input))).toBe(false);
	});

	const rowFor = (pathName) => ({
		surface: "frontend",
		groupKey: {
			eventName: "api_call_error",
			pathName,
			functionName: null,
			apiName: null,
			endpoint: null,
			method: null,
			statusCode: null,
			httpStatus: 500,
			route: "/v<n>/dishes/bulk-import",
			errorCode: null,
		},
		messagePattern: "Internal server error",
		occurrences: 3,
		affectedUsers: 2,
		anonymousOccurrences: 0,
		firstSeenUtc: "2026-08-06T01:00:00Z",
		lastSeenUtc: "2026-08-06T23:00:00Z",
		hourlyCounts: [],
		commits: [],
		appVersions: [],
		localeCounts: [{ locale: "ja", count: 3 }],
		representativeCommit: null,
	});

	const RUN_SUMMARY = { groupCount: 2, groupLimit: 500, keptRows: 6, excludedRows: 0, excludedBreakdown: [] };
	const QUERY = { estimatedBytes: 1, maxBytesBilled: 200000000, totalRows: 2 };
	const envelopeOf = (rows) =>
		buildEnvelope({ rows, runSummary: RUN_SUMMARY, window: WINDOW, generatedAt: GENERATED_AT, query: QUERY }).envelope;

	// 1件だけ2段ロケール、もう1件は普通のパス
	const envelope = envelopeOf([rowFor("/en/foo"), rowFor("/search/result")]);

	it("エンベロープ全体は valid のまま（run は止まらない）", () => {
		const validation = validateEnvelope(envelope);
		expect(validation.ok).toBe(true);
		expect(validation.errors).toEqual([]);
		expect(validation.groupErrors.map((entry) => entry.fingerprint)).toEqual([envelope.groups[0].fingerprint]);
	});

	it("★ 奇妙なパスのグループだけ invalid になり、他のグループは普通に処理される", () => {
		const plan = buildPlan({ envelope, issues: [] });
		expect(plan.valid).toBe(true);
		expect(plan.errors).toEqual([]);
		const byFingerprint = Object.fromEntries(plan.items.map((item) => [item.fingerprint, item.action]));
		expect(byFingerprint[envelope.groups[0].fingerprint]).toBe("invalid");
		expect(byFingerprint[envelope.groups[1].fingerprint]).toBe("create");
		expect(plan.counts.create).toBe(1);
	});

	it("保留したグループは数えられ、理由も残る（黙って落とさない）", () => {
		const plan = buildPlan({ envelope, issues: [] });
		expect(plan.counts.invalid).toBe(1);
		expect(plan.invalidGroups.map((entry) => entry.fingerprint)).toEqual([envelope.groups[0].fingerprint]);
		expect(plan.warnings.join("\n")).toContain("先頭ロケールが剥がれていません");
		expect(renderJobSummary({ envelope, plan, mode: "apply" })).toContain("invalid");
	});

	it("invalid にしたグループは起票も突合もしない（body 更新の対象にもならない）", () => {
		const plan = buildPlan({ envelope, issues: [] });
		const item = plan.items.find((entry) => entry.fingerprint === envelope.groups[0].fingerprint);
		expect(item.issueNumber).toBeNull();
		expect(item.matchedBy).toBe("none");
	});

	it("他の envelope 検査は緩めていない（正規化違反は従来どおり run 全体を止める）", () => {
		const dirty = envelopeOf([rowFor("/search/result")]);
		dirty.groups[0].messagePattern = "畳まれていない　全角スペース";
		const validation = validateEnvelope(dirty);
		expect(validation.ok).toBe(false);
		expect(buildPlan({ envelope: dirty, issues: [] }).valid).toBe(false);
	});
});

describe("restorePathLocale() は stripPathLocale() の逆写像（移行の前提）", () => {
	it.each([
		["/ja-JP"],
		["/ja"],
		["/en-IE/search/result"],
		["/es-ES/[locale]/contribution-tasks/dish-category-manual-image-supply"],
		["/[locale]/profile/settings"],
		["/zh-Hant-TW/posts"],
		["/es-<n>/posts"],
	])("%s は locale + 剥がし後から厳密に復元できる", (input) => {
		expect(restorePathLocale(extractPathLocale(input), stripPathLocale(input))).toBe(input);
	});

	it("ロケールが無いパスは復元しても変わらない", () => {
		expect(restorePathLocale(null, "/store")).toBe("/store");
		expect(restorePathLocale("", "/store")).toBe("/store");
	});
});

// ---------------------------------------------------------------------------
// 3) RE2（BigQuery）と JS の等価性 — PR #1200 B-1 と同じ検査を新ルールへも掛ける
// ---------------------------------------------------------------------------

describe("RE2 / JS の共通部分集合に収まっている（B-1 と同じ機械検査）", () => {
	const patterns = [...PATH_LOCALE_RULES, PATH_LOCALE_EXTRACT];

	it.each(patterns.map((rule) => [rule.name, rule]))(
		"%s: 先読み・後読み・後方参照・インラインフラグを使わない",
		(_name, rule) => {
			for (const source of [rule.pattern, rule.re2Pattern]) {
				expect(source).not.toMatch(/\(\?=/);
				expect(source).not.toMatch(/\(\?!/);
				expect(source).not.toMatch(/\(\?</);
				expect(source).not.toMatch(/\(\?[ims]+[):]/);
				expect(source).not.toMatch(/\\[1-9]/);
			}
		},
	);

	it.each(patterns.map((rule) => [rule.name, rule]))(
		"%s: Unicode 差のあるショートハンド（\\s / \\S / \\w / \\W）を使わない",
		(_name, rule) => {
			for (const source of [rule.pattern, rule.re2Pattern]) {
				expect(source).not.toMatch(/\\[sSwW]/);
			}
		},
	);

	it.each(patterns.map((rule) => [rule.name, rule]))(
		"%s: JS 表記と RE2 表記が同一（ASCII だけで書いてある）",
		(_name, rule) => {
			expect(rule.re2Pattern).toBe(rule.pattern);
			// 非 ASCII が混じると表記差（\uXXXX と \x{XXXX}）が生まれ、両者が同一ではいられなくなる
			expect(/^[\x20-\x7e]*$/.test(rule.pattern)).toBe(true);
		},
	);

	it.each(PATH_LOCALE_RULES.map((rule) => [rule.name, rule]))("%s: 置換文字列に後方参照を含まない", (_name, rule) => {
		expect(rule.replacement).not.toMatch(/[$\\][0-9]/);
	});

	it("三重引用 raw 文字列へ安全に埋め込める（''' を含まない / 末尾が ' や奇数バックスラッシュでない）", () => {
		for (const rule of patterns) {
			expect(rule.re2Pattern.includes(RAW_STRING_DELIMITER)).toBe(false);
			expect(() => toRawStringLiteral(rule.re2Pattern)).not.toThrow();
		}
	});

	it("SQL のコメント除去を壊さない（パターンに `--` を含まない）", () => {
		for (const rule of patterns) {
			expect(rule.re2Pattern.includes("--")).toBe(false);
		}
	});

	it("RE2 の量指定子・文字クラスしか使っていない（JS 固有の \\uXXXX / \\p{...} が無い）", () => {
		for (const rule of patterns) {
			expect(rule.pattern).not.toMatch(/\\u[0-9A-Fa-f]{4}/);
			expect(rule.pattern).not.toMatch(/\\p\{/);
			expect(rule.pattern).not.toMatch(/\\x\{/);
		}
	});

	it("PATH_LOCALE_EXTRACT の捕獲グループはちょうど1つ（BigQuery の REGEXP_EXTRACT の要件）", () => {
		// 非捕獲 `(?:` を除いた `(` の数を数える。
		const capturing = PATH_LOCALE_EXTRACT.re2Pattern.replace(/\(\?:/g, "").match(/\(/g) || [];
		expect(capturing).toHaveLength(1);
	});
});

describe("生成された SQL がルール表と一致している（二重管理を作らない）", () => {
	const sql = generateErrorTriageSql();

	it("fpalgo マーカーが現行世代", () => {
		expect(sql).toContain(`-- fpalgo: ${FP_ALGO_VERSION}`);
	});

	it("PATH_LOCALE_RULES の re2Pattern が SQL に1つずつ現れる", () => {
		for (const rule of PATH_LOCALE_RULES) {
			expect(sql.split(toRawStringLiteral(rule.re2Pattern)).length - 1).toBe(1);
		}
	});

	it("ロケール剥がしは pathName（norm[OFFSET(1)]）にだけ掛かっている", () => {
		// 掛ける対象が増えていないことを、剥がし式の出現回数で固定する。
		const [prefixRule] = PATH_LOCALE_RULES;
		const occurrences = sql.split(toRawStringLiteral(prefixRule.re2Pattern)).length - 1;
		expect(occurrences).toBe(1);
		expect(sql).toContain("n.norm[OFFSET(1)]");
	});

	it("剥がしたロケールは localeTag として残り、localeCounts に集計される", () => {
		expect(sql).toContain(toRawStringLiteral(PATH_LOCALE_EXTRACT.re2Pattern));
		expect(sql).toContain("AS localeTag");
		expect(sql).toContain("AS localeCounts");
		expect(sql).toContain("localeTag                         AS locale");
	});

	it("ロケールの文法が SQL 側にも同じ文字列として埋まっている", () => {
		expect(sql).toContain(LOCALE_PREFIX_PATTERN);
	});
});

// ---------------------------------------------------------------------------
// 4) 同一 fingerprint に畳まれる
// ---------------------------------------------------------------------------

describe("ロケール違いが同じ fingerprint に畳まれる（#1221 / #1226 / #1229 / #1236 の再現）", () => {
	const groupFor = (rawPathName) => ({
		surface: "frontend",
		groupKey: {
			eventName: "api_call_error",
			pathName: normalizePathName(rawPathName),
			functionName: null,
			apiName: null,
			endpoint: null,
			method: null,
			statusCode: null,
			httpStatus: 500,
			route: "/v<n>/dishes/bulk-import",
			errorCode: null,
		},
		messagePattern: "Internal server error",
	});

	// CLUSTERING.md 類型1 に載っている実例そのもの
	const LOCALES = ["/ja-JP/search/result", "/en-IE/search/result", "/ja/search/result", "/en-US/search/result"];

	it("4ロケールが1つの fingerprint になる", () => {
		const fingerprints = new Set(LOCALES.map((path) => computeFingerprint(groupFor(path))));
		expect(fingerprints.size).toBe(1);
	});

	it("pathName は `/search/result`（ロケールが消えた形）", () => {
		expect(groupFor("/ja-JP/search/result").groupKey.pathName).toBe("/search/result");
	});

	it("画面が違えば依然として別 fingerprint（畳みすぎていない）", () => {
		expect(computeFingerprint(groupFor("/ja-JP/search/result"))).not.toBe(
			computeFingerprint(groupFor("/ja-JP/search/dish-categories")),
		);
		expect(computeFingerprint(groupFor("/ja-JP/map"))).not.toBe(computeFingerprint(groupFor("/ja-JP")));
	});
});

// ---------------------------------------------------------------------------
// 5) ロケール内訳が Issue 本文に出る
// ---------------------------------------------------------------------------

describe("剥がしたロケールを捨てない（Issue 本文の内訳）", () => {
	const group = {
		surface: "frontend",
		fingerprint: "0123456789ab",
		groupKey: { eventName: "api_call_error", pathName: "/search/result", route: "/v<n>/dishes/bulk-import" },
		messagePattern: "Internal server error",
		occurrences: 61,
		affectedUsers: 22,
		anonymousOccurrences: 0,
		firstSeenUtc: "2026-08-06T03:02:11Z",
		lastSeenUtc: "2026-08-06T22:10:48Z",
		hourlyCounts: [],
		commits: [],
		appVersions: [],
		localeCounts: [
			{ locale: "ja-JP", count: 30 },
			{ locale: "en-US", count: 20 },
			{ locale: "ja", count: 11 },
		],
	};

	const body = renderIssueBody({ group, window: WINDOW, generatedAt: GENERATED_AT });

	it("「どのロケール」行に内訳が件数付きで出る", () => {
		expect(body).toContain("**どのロケール**");
		expect(body).toContain("`ja-JP` 30件");
		expect(body).toContain("`en-US` 20件");
		expect(body).toContain("`ja` 11件");
	});

	it("件数の多い順に並ぶ（run ごとに並びがぶれない）", () => {
		const row = body.split("\n").find((line) => line.includes("どのロケール"));
		expect(row.indexOf("ja-JP")).toBeLessThan(row.indexOf("en-US"));
		expect(row.indexOf("en-US")).toBeLessThan(row.indexOf("` 11件"));
	});

	it("1ロケールしか出ていないときは「ロケール固有の不具合の可能性」を注意書きする（CLUSTERING.md 類型1）", () => {
		const single = renderIssueBody({
			group: { ...group, localeCounts: [{ locale: "ja-JP", count: 61 }] },
			window: WINDOW,
			generatedAt: GENERATED_AT,
		});
		expect(single).toContain("**1ロケールのみ**");
	});

	// Nit（PR #1256 レビュー）: `/store` のようなロケール配下でない frontend パスは
	// `(ロケールなし) 5件` の1件だけになる。ここに「1ロケールのみ。ロケール固有の不具合の
	// 可能性を確認すること」を出すのは、そもそもロケールで分岐し得ない画面なので不適切。
	it("`(ロケールなし)` 1件だけのときは「1ロケールのみ」の注意書きを出さない", () => {
		const noLocale = renderIssueBody({
			group: {
				...group,
				groupKey: { ...group.groupKey, pathName: "/store" },
				localeCounts: [{ locale: null, count: 5 }],
			},
			window: WINDOW,
			generatedAt: GENERATED_AT,
		});
		expect(noLocale).toContain("(ロケールなし)` 5件");
		expect(noLocale).not.toContain("**1ロケールのみ**");
	});

	it("ロケールが多いときは上位だけ並べ、残りは「他 N 種」に畳む（body を膨らませない）", () => {
		const many = renderIssueBody({
			group: {
				...group,
				localeCounts: Array.from({ length: 20 }, (_, index) => ({ locale: `l${index}-XX`, count: 20 - index })),
			},
			window: WINDOW,
			generatedAt: GENERATED_AT,
		});
		expect(many).toContain("他 12 種");
	});

	it("ロケール内訳が無い surface（backend / external）では行ごと出ない", () => {
		const backend = renderIssueBody({
			group: { ...group, surface: "backend", localeCounts: [] },
			window: WINDOW,
			generatedAt: GENERATED_AT,
		});
		expect(backend).not.toContain("どのロケール");
	});

	it("ロケール名は表示直前にサニタイズされる（markdown を壊さない / M-1 と同じ防御）", () => {
		const nasty = renderIssueBody({
			group: { ...group, localeCounts: [{ locale: "a|b`c<!-- error-triage:auto:end -->", count: 1 }] },
			window: WINDOW,
			generatedAt: GENERATED_AT,
		});
		// 自動領域の終了マーカーが本文中に**そのままの形で**2つ現れてはいけない
		expect(nasty.split("<!-- error-triage:auto:end -->")).toHaveLength(2);
		expect(nasty).toContain("a\\|b'c");
	});
});
