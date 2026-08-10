#!/usr/bin/env node
// scripts/verify-share-link-seo.mjs
//
// #721 共有リンク `/s/:token` の OGP が «実データから動的に» 生成されているかを、
// デプロイ済みの環境に対して実 HTTP で確認する。
//
// ## なぜユニットテスト / E2E では足りないのか
// - ユニットテストは `renderSharePage()` の出力を見るだけで、Firebase Hosting の
//   rewrite が `/s/**` を Cloud Run へ回しているかを検証できない。rewrite が
//   catch-all（`** -> /index.html`）に食われると、**200 でアプリのシェルが返る**。
//   これは「壊れている」のに一見成功して見える、最もたちの悪い壊れ方になる。
// - e2e-web は `scripts/serve-dist.mjs` で dist をローカル配信するため、
//   そもそも rewrite が存在しない。
//
// したがって、この検証は «実際にデプロイされた Hosting の URL» を叩く必要がある。
//
// ## 何を «動的» の証拠とするか
// 「200 が返った」「title タグがある」では足りない。静的な index.html でも
// その両方を満たすため。ここでは次を根拠にする。
//
//   1. 同じ形の 2 本のリンク（別 locale・別 dish_media）が **別々の** title /
//      description / og:locale を返すこと（＝ token ごとに内容が変わる）
//   2. title が DB 由来の文字列（店名・料理名）を含むこと
//   3. og:image が `/s/<token>/og-image` を指し、それが 302 で署名 URL へ飛ぶこと
//   4. 存在しない token が 404 になること（index.html の 200 ではない）
//   5. 通常のアプリのパスは今までどおり index.html の 200 であること
//      （＝ `/s/**` の rewrite が SPA の catch-all を壊していない）
//
// ## 出力
// 判定はすべて標準出力へ書く。Artifact に頼らない（ログだけで結論が読める形にする）。
// 共有 token は伏せ字にする。公開リポジトリの Actions ログに残るため。

const WEB_BASE_URL = requireEnv('WEB_BASE_URL').replace(/\/+$/, '');
const BACKEND_BASE_URL = requireEnv('BACKEND_BASE_URL').replace(/\/+$/, '');
const SUPABASE_URL = requireEnv('SUPABASE_URL').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = requireEnv('SUPABASE_ANON_KEY');
/** dev の実データから拾った dish_media.id（カンマ区切りで 2 件以上） */
const DISH_MEDIA_IDS = requireEnv('DISH_MEDIA_IDS')
	.split(',')
	.map((v) => v.trim())
	.filter(Boolean);

function requireEnv(name) {
	const value = process.env[name];
	if (!value) {
		console.error(`::error::${name} が未設定です`);
		process.exit(1);
	}
	return value;
}

/* ------------------------------------------------------------------ */
/*                             判定の記録                             */
/* ------------------------------------------------------------------ */

const results = [];

/** 1 件の判定を記録する。`actual` は伏せ字済みの文字列を渡すこと */
function check(name, ok, expected, actual) {
	results.push({ name, ok, expected, actual });
	console.log(`${ok ? "✅" : "❌"} ${name}`);
	console.log(`     期待: ${expected}`);
	console.log(`     実測: ${actual}`);
}

/** 共有 token を伏せる。ログは公開されるため、本文へそのまま出さない */
let redactions = [];
function redact(text) {
	let out = String(text);
	for (const token of redactions) {
		out = out.split(token).join(`${token.slice(0, 6)}…<redacted>`);
	}
	return out;
}

/* ------------------------------------------------------------------ */
/*                              HTTP                                  */
/* ------------------------------------------------------------------ */

/** meta タグを 1 つ抜き出す。属性の順序は実装依存なので両方の並びを許す */
function meta(html, key) {
	const attr = key.startsWith("og:") || key.startsWith("article:") ? "property" : "name";
	const patterns = [
		new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`, "i"),
		new RegExp(`<meta\\s+content="([^"]*)"\\s+${attr}="${key}"`, "i"),
	];
	for (const re of patterns) {
		const m = html.match(re);
		if (m) return m[1];
	}
	return null;
}

function title(html) {
	const m = html.match(/<title>([\s\S]*?)<\/title>/i);
	return m ? m[1].trim() : null;
}

/**
 * expo export が吐いた静的 HTML かどうか。
 *
 * ⚠️ 「title タグがあるか」では判定できない。#281 / #721 のプリレンダで
 * 静的側にも title と OGP が入っているため、両者は表面的にはよく似ている。
 * 見分けられるのは «アプリのバンドルを読み込んでいるか» だけ。
 * SSR 側（share-page.html.ts）は script を 1 つも吐かない。
 */
function looksLikeExpoStatic(html) {
	return /_expo\/static\//.test(html) || /id="root"/.test(html);
}

async function anonymousSignIn() {
	// supabase-js の signInAnonymously() と同じ要求。SDK を入れずに済ませる
	const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
		method: "POST",
		headers: {
			apikey: SUPABASE_ANON_KEY,
			Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ data: {}, gotrue_meta_security: {} }),
	});
	const body = await res.text();
	if (!res.ok) {
		// token を含みうるので body はそのまま出さない
		console.error(`::error::匿名サインインに失敗しました (${res.status})`);
		console.error(body.slice(0, 300));
		process.exit(1);
	}
	const json = JSON.parse(body);
	const accessToken = json.access_token;
	if (!accessToken) {
		console.error("::error::匿名サインインのレスポンスに access_token がありません");
		process.exit(1);
	}
	return accessToken;
}

async function createShareLink(accessToken, ids, locale) {
	const res = await fetch(`${BACKEND_BASE_URL}/v1/share-links`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ target: { type: "dish_media", params: { ids } }, locale }),
	});
	const body = await res.text();
	if (res.status !== 201 && res.status !== 200) {
		console.error(`::error::共有リンクの作成に失敗しました (${res.status}) locale=${locale}`);
		console.error(body.slice(0, 500));
		process.exit(1);
	}
	// ResponseWrapInterceptor で { success, data } に包まれる
	const json = JSON.parse(body);
	const data = json.data ?? json;
	if (!data.token) {
		console.error("::error::作成レスポンスに token がありません");
		console.error(body.slice(0, 500));
		process.exit(1);
	}
	redactions.push(data.token);
	return data;
}

/* ------------------------------------------------------------------ */
/*                              本体                                  */
/* ------------------------------------------------------------------ */

async function main() {
	console.log("=== 検証対象 ===");
	console.log(`WEB_BASE_URL     : ${WEB_BASE_URL}`);
	console.log(`BACKEND_BASE_URL : ${BACKEND_BASE_URL}`);
	console.log(`dish_media 件数  : ${DISH_MEDIA_IDS.length}`);
	console.log("");

	if (DISH_MEDIA_IDS.length < 2) {
		console.error("::error::dish_media が 2 件必要です（別内容の 2 本を突き合わせて動的性を判定するため）");
		process.exit(1);
	}

	const accessToken = await anonymousSignIn();
	console.log("匿名サインイン: OK");

	// ── 別 dish_media・別 locale で 2 本作る ──
	const a = await createShareLink(accessToken, [DISH_MEDIA_IDS[0]], "ja-JP");
	const b = await createShareLink(accessToken, [DISH_MEDIA_IDS[1]], "en-US");
	console.log(`共有リンクを 2 本作成: ${redact(a.token)} / ${redact(b.token)}`);
	console.log("");

	// ── 1. Hosting 経由で SSR が返るか ──
	const pages = {};
	for (const [label, link] of [
		["A(ja-JP)", a],
		["B(en-US)", b],
	]) {
		const url = `${WEB_BASE_URL}/s/${link.token}`;
		const res = await fetch(url, { redirect: "manual" });
		const html = await res.text();
		pages[label] = { res, html, link };

		check(
			`${label} /s/:token が 200 を返す`,
			res.status === 200,
			"200",
			String(res.status),
		);
		check(
			`${label} Content-Type が HTML`,
			(res.headers.get("content-type") ?? "").includes("text/html"),
			"text/html を含む",
			res.headers.get("content-type") ?? "(なし)",
		);
		// 静的な index.html が返っていないことの直接的な証拠。
		// rewrite の順序を間違えると catch-all（`** -> /index.html`）に食われ、
		// **200 でアプリのシェルが返る**。これは一見成功して見える壊れ方なので必ず見る
		check(
			`${label} 静的 index.html ではない`,
			!looksLikeExpoStatic(html),
			"アプリのバンドル(_expo/static/)を含まない",
			looksLikeExpoStatic(html) ? "アプリのシェルが返っている（catch-all に食われている）" : "SSR の HTML",
		);
		// token 固有の値が HTML に埋まっていること。静的 HTML では原理的に不可能
		check(
			`${label} HTML に token 固有の canonical が入っている`,
			html.includes(`${WEB_BASE_URL}/s/${link.token}`),
			"canonical / og:url が この token を指す",
			redact(meta(html, "og:url") ?? "(なし)"),
		);
	}

	// ── 2. OGP が実データから作られているか ──
	const titleA = title(pages["A(ja-JP)"].html);
	const titleB = title(pages["B(en-US)"].html);
	const descA = meta(pages["A(ja-JP)"].html, "og:description");
	const descB = meta(pages["B(en-US)"].html, "og:description");

	check("A の <title> が空でない", Boolean(titleA), "1 文字以上", JSON.stringify(titleA));
	check("B の <title> が空でない", Boolean(titleB), "1 文字以上", JSON.stringify(titleB));
	check(
		"og:title が <title> と一致する",
		meta(pages["A(ja-JP)"].html, "og:title") === titleA,
		"一致",
		JSON.stringify(meta(pages["A(ja-JP)"].html, "og:title")),
	);

	// ★ これが «動的更新» の中心的な根拠。
	//   静的 HTML なら token が違っても同じ内容が返る
	check(
		"token ごとに <title> が変わる（＝動的）",
		Boolean(titleA) && Boolean(titleB) && titleA !== titleB,
		"A と B で異なる",
		`A=${JSON.stringify(titleA)} / B=${JSON.stringify(titleB)}`,
	);
	check(
		"token ごとに og:description が変わる（＝動的）",
		Boolean(descA) && Boolean(descB) && descA !== descB,
		"A と B で異なる",
		`A=${JSON.stringify(descA)} / B=${JSON.stringify(descB)}`,
	);

	// ── 3. locale が共有時点で固定されているか ──
	check(
		"A の og:locale が ja_JP",
		meta(pages["A(ja-JP)"].html, "og:locale") === "ja_JP",
		"ja_JP",
		String(meta(pages["A(ja-JP)"].html, "og:locale")),
	);
	check(
		"B の og:locale が en_US",
		meta(pages["B(en-US)"].html, "og:locale") === "en_US",
		"en_US",
		String(meta(pages["B(en-US)"].html, "og:locale")),
	);
	// ラベルは locale ごとの定数なので、HTML 本体まで locale が効いていることを見る
	check(
		"A の本文が日本語ラベル、B が英語ラベル",
		pages["A(ja-JP)"].html.includes("アプリで開く") && pages["B(en-US)"].html.includes("Open in app"),
		"A に「アプリで開く」/ B に「Open in app」",
		`A:${pages["A(ja-JP)"].html.includes("アプリで開く")} B:${pages["B(en-US)"].html.includes("Open in app")}`,
	);

	// ── 3-B. まとめて共有したときに «一括だと分かる» 文言になるか（#1194）──
	// 実機フィードバックで「文言が一括シェアに見えない」と指摘された。
	// 先頭 1 件の「料理名 - 店名」だけだと、受け取った側には単品の共有にしか見えない。
	const multi = await createShareLink(accessToken, DISH_MEDIA_IDS.slice(0, 2), "ja-JP");
	const multiRes = await fetch(`${WEB_BASE_URL}/s/${multi.token}`, { redirect: "manual" });
	const multiHtml = await multiRes.text();
	const multiTitle = title(multiHtml);

	check(
		"複数件の共有はタイトルに件数が出る",
		Boolean(multiTitle) && /ほか\d+件/.test(multiTitle ?? ""),
		"「ほかN件」を含む",
		JSON.stringify(multiTitle),
	);
	check(
		"複数件のタイトルは 1 件のときと別物",
		Boolean(multiTitle) && multiTitle !== titleA,
		"1 件共有の title と異なる",
		`複数=${JSON.stringify(multiTitle)} / 単品=${JSON.stringify(titleA)}`,
	);
	check(
		"複数件の description も件数を含む",
		/\d+\s*件/.test(meta(multiHtml, "og:description") ?? ""),
		"件数を含む",
		JSON.stringify(meta(multiHtml, "og:description")),
	);

	// ── 3-C. 人間は中間画面に留まらない（#1194）──
	// ⚠️ ここは «HTML に redirect が入っているか» までしか見られない。
	// このスクリプトは fetch（JS を実行しない）ので、実際に遷移するかは
	// e2e-web の `share-link-ogp.spec.ts` が実ブラウザで見ている。
	//
	// 逆に言うと、**JS を実行しない経路（＝ SNS のクローラ）では OGP がそのまま読める**
	// ことを、上の判定群がそのまま証明している（出し分けになっていない）。
	check(
		"人間向けの自動遷移が仕込まれている",
		pages["A(ja-JP)"].html.includes("window.location.replace("),
		"window.location.replace( を含む",
		pages["A(ja-JP)"].html.includes("window.location.replace(") ? "含む" : "含まない",
	);
	check(
		"自動遷移の行き先が対象ページ（中間画面へ戻さない）",
		pages["A(ja-JP)"].html.includes(`${WEB_BASE_URL}/${"ja-JP"}/posts`),
		"WEB_BASE_URL/ja-JP/posts を指す",
		pages["A(ja-JP)"].html.includes(`${WEB_BASE_URL}/ja-JP/posts`) ? "対象ページ" : "不明",
	);

	// ── 4. og:url / canonical が Hosting のドメインを指すか ──
	// ここが API のドメインになっていると、SNS のカードから API が露出する
	const ogUrlA = meta(pages["A(ja-JP)"].html, "og:url") ?? "";
	check(
		"og:url が WEB_BASE_URL 起点",
		ogUrlA.startsWith(`${WEB_BASE_URL}/s/`),
		`${WEB_BASE_URL}/s/... で始まる`,
		redact(ogUrlA),
	);

	// ── 5. og:image が /s/:token/og-image を指し、302 で署名 URL へ飛ぶか ──
	const ogImageA = meta(pages["A(ja-JP)"].html, "og:image") ?? "";
	check(
		"og:image が /s/:token/og-image",
		ogImageA === `${ogUrlA}/og-image`,
		"og:url + /og-image",
		redact(ogImageA),
	);
	if (ogImageA) {
		const imgRes = await fetch(ogImageA, { redirect: "manual" });
		const location = imgRes.headers.get("location") ?? "";
		check(
			"og-image が 302 でリダイレクトする",
			imgRes.status === 302,
			"302",
			String(imgRes.status),
		);
		check(
			"og-image のリダイレクト先が署名 URL",
			/^https:\/\//.test(location) && location.includes("?"),
			"https の署名付き URL",
			location ? `${location.split("?")[0]}?<signature redacted>` : "(Location なし)",
		);
	}

	// ── 6. 存在しない token が 404（index.html の 200 ではない） ──
	const bogus = "s1_0123456789abcdefghijkl";
	const notFound = await fetch(`${WEB_BASE_URL}/s/${bogus}`, { redirect: "manual" });
	const notFoundBody = await notFound.text();
	check(
		"存在しない token は 404",
		notFound.status === 404,
		"404",
		`${notFound.status}${notFound.status === 200 && looksLikeExpoStatic(notFoundBody) ? "（index.html が返っている＝rewrite 未適用）" : ""}`,
	);

	// ── 7. 通常のアプリのパスは今までどおり index.html ──
	//    `/s/**` の rewrite が catch-all より «前» にある以上、順序を間違えると
	//    こちらが壊れる。両方を同時に見ないと片側の破壊に気付けない
	const spa = await fetch(`${WEB_BASE_URL}/ja-JP/posts`, { redirect: "manual" });
	const spaBody = await spa.text();
	check(
		"通常パスは今までどおり静的 HTML",
		spa.status === 200 && looksLikeExpoStatic(spaBody),
		"200 かつアプリのバンドルを含む",
		`${spa.status} / アプリのバンドル: ${looksLikeExpoStatic(spaBody)}`,
	);

	/* ---------------------------------------------------------------- */
	/*                            まとめ                                */
	/* ---------------------------------------------------------------- */

	console.log("");
	console.log("=== 判定一覧 ===");
	console.log("| 判定 | 項目 | 期待 | 実測 |");
	console.log("| --- | --- | --- | --- |");
	for (const r of results) {
		const cell = (v) => String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
		console.log(`| ${r.ok ? "OK" : "NG"} | ${cell(r.name)} | ${cell(r.expected)} | ${cell(r.actual)} |`);
	}

	const failed = results.filter((r) => !r.ok);
	console.log("");
	console.log(`合計 ${results.length} 件 / 失敗 ${failed.length} 件`);
	if (failed.length > 0) {
		for (const r of failed) console.log(`::error::${r.name}: 期待 ${r.expected} / 実測 ${r.actual}`);
		process.exit(1);
	}
	console.log("✅ すべて期待どおり");
}

main().catch((err) => {
	console.error(`::error::検証中に例外が発生しました: ${err?.message ?? err}`);
	console.error(err?.stack ?? "");
	process.exit(1);
});
