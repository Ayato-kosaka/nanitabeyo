/**
 * `parseSnsUrl` の仕様固定テスト（#1399 PR1）。
 *
 * この関数は純粋関数なので、**実際に共有される URL の形を全部ここへ書き切れる**。
 * 「それらしい正規表現が通ること」ではなく「どの形を通し、どの形を弾くか」を固定するのが目的。
 *
 * ネットワークは一切叩かない。ここに出てくる ID / shortcode は形式だけが本物に合わせてある。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSnsUrl, SNS_PROVIDERS, type SnsUrlContent, type SnsUrlShortlink } from "../snsUrl";

/** 実在の Shorts と同じ 11 文字の形 */
const YT_ID = "SXHMnicI6Pg";
/** 実測した TikTok の 19 桁 ID */
const TT_ID = "7431518433935641888";
/** Instagram の shortcode（11 文字が多いが固定ではない） */
const IG_CODE = "DAbcDefGhIj";

function expectContent(input: string): SnsUrlContent {
	const result = parseSnsUrl(input);
	assert.notEqual(result, null, `parseSnsUrl が null を返した: ${input}`);
	assert.equal(result!.kind, "content", `content ではなかった: ${input}`);
	return result as SnsUrlContent;
}

function expectShortlink(input: string): SnsUrlShortlink {
	const result = parseSnsUrl(input);
	assert.notEqual(result, null, `parseSnsUrl が null を返した: ${input}`);
	assert.equal(result!.kind, "shortlink", `shortlink ではなかった: ${input}`);
	return result as SnsUrlShortlink;
}

function expectNull(input: string): void {
	assert.equal(parseSnsUrl(input), null, `null になるはずが通ってしまった: ${input}`);
}

// ---------------------------------------------------------------------------
// provider の値域
// ---------------------------------------------------------------------------

test("対象 provider は instagram / tiktok / youtube の 3 つだけ（migration の CHECK と一致）", () => {
	assert.deepEqual([...SNS_PROVIDERS].sort(), ["instagram", "tiktok", "youtube"]);
});

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

test("YouTube: /shorts/{id} をそのまま確定する", () => {
	const result = expectContent(`https://www.youtube.com/shorts/${YT_ID}`);
	assert.deepEqual(result, {
		kind: "content",
		provider: "youtube",
		externalContentId: YT_ID,
		canonicalUrl: `https://www.youtube.com/shorts/${YT_ID}`,
	});
});

test("YouTube: ホストの表記ゆれ（www 無し / m. / 大文字）を吸収する", () => {
	for (const input of [
		`https://youtube.com/shorts/${YT_ID}`,
		`https://m.youtube.com/shorts/${YT_ID}`,
		`HTTPS://WWW.YOUTUBE.COM/shorts/${YT_ID}`,
		`http://www.youtube.com/shorts/${YT_ID}`,
		`https://www.youtube.com./shorts/${YT_ID}`,
	]) {
		assert.equal(expectContent(input).canonicalUrl, `https://www.youtube.com/shorts/${YT_ID}`, input);
	}
});

test("YouTube: トラッキングパラメータとフラグメントを canonical から落とす", () => {
	for (const input of [
		`https://www.youtube.com/shorts/${YT_ID}?si=Ab12Cd34EfGh`,
		`https://www.youtube.com/shorts/${YT_ID}?feature=share&hl=ja&gl=JP`,
		`https://www.youtube.com/shorts/${YT_ID}?utm_source=x&utm_medium=y`,
		`https://www.youtube.com/shorts/${YT_ID}#t=10`,
	]) {
		const result = expectContent(input);
		assert.equal(result.canonicalUrl, `https://www.youtube.com/shorts/${YT_ID}`, input);
		assert.equal(result.externalContentId, YT_ID, input);
	}
});

test("YouTube: youtu.be / watch?v= は ID は取れるが Shorts 判定が未確定である", () => {
	// 実測: youtu.be/{id} は /watch?v={id} へ 303 するだけで、縦動画かどうかは URL から分からない。
	// null にすると「YouTube の共有ボタンから来た URL が全部非対応」になるので、
	// 確定していないことを requiresShortsCheck で申告して呼び出し側の HEAD 判定へ回す。
	for (const input of [
		`https://youtu.be/${YT_ID}`,
		`https://youtu.be/${YT_ID}?si=Ab12Cd34EfGh&t=30`,
		`https://www.youtube.com/watch?v=${YT_ID}`,
		`https://m.youtube.com/watch?v=${YT_ID}&feature=youtu.be`,
	]) {
		assert.deepEqual(
			parseSnsUrl(input),
			{
				kind: "content",
				provider: "youtube",
				externalContentId: YT_ID,
				canonicalUrl: `https://www.youtube.com/shorts/${YT_ID}`,
				requiresShortsCheck: true,
			},
			input,
		);
	}
});

test("YouTube: /shorts/ 由来のときは requiresShortsCheck を立てない", () => {
	assert.equal(expectContent(`https://www.youtube.com/shorts/${YT_ID}`).requiresShortsCheck, undefined);
});

test("YouTube: 投稿 URL でない形は弾く", () => {
	expectNull(`https://www.youtube.com/embed/${YT_ID}`); // プレイヤー URL
	expectNull(`https://www.youtube-nocookie.com/embed/${YT_ID}`); // 埋め込み専用ホスト
	expectNull(`https://www.youtube.com/live/${YT_ID}`); // ライブは Shorts ではない
	expectNull("https://www.youtube.com/@faie_charms"); // チャンネル
	expectNull("https://www.youtube.com/watch?list=PL123456"); // v が無い
	expectNull("https://www.youtube.com/shorts/"); // ID が無い
	expectNull(`https://www.youtube.com/shorts/${YT_ID}/extra`); // 余分なセグメント
	expectNull("https://www.youtube.com/shorts/short"); // 11 文字でない
	expectNull("https://www.youtube.com/shorts/TOO_LONG_IDENT_1234"); // 11 文字でない
	expectNull("https://www.youtube.com/shorts/SXHMnicI6P%20"); // パーセントエンコード混じり
});

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

test("TikTok: /@{user}/video/{id} を確定する", () => {
	const result = expectContent(`https://www.tiktok.com/@scout2015/video/${TT_ID}`);
	assert.deepEqual(result, {
		kind: "content",
		provider: "tiktok",
		externalContentId: TT_ID,
		canonicalUrl: `https://www.tiktok.com/@scout2015/video/${TT_ID}`,
	});
});

test("TikTok: ユーザー名が空の解決先（/@/video/{id}）も受ける", () => {
	// 実測: vm.tiktok.com の解決先が https://www.tiktok.com/@/video/{id} になることがある。
	// この形は実際に 200 を返し oEmbed も通るので、canonical としても使える。
	for (const input of [`https://www.tiktok.com/@/video/${TT_ID}`, `https://www.tiktok.com/video/${TT_ID}`]) {
		const result = expectContent(input);
		assert.equal(result.externalContentId, TT_ID, input);
		assert.equal(result.canonicalUrl, `https://www.tiktok.com/@/video/${TT_ID}`, input);
	}
});

test("TikTok: 共有テキストが付ける追跡パラメータを canonical から落とす", () => {
	const input =
		`https://www.tiktok.com/@scout2015/video/${TT_ID}` +
		"?is_from_webapp=1&sender_device=pc&web_id=123456&_r=1&_t=ZS-abc";
	assert.equal(expectContent(input).canonicalUrl, `https://www.tiktok.com/@scout2015/video/${TT_ID}`);
});

test("TikTok: 短縮 URL は展開が要ることを申告する（ネットワークを使わないので ID は取れない）", () => {
	for (const [input, expandUrl] of [
		["https://vm.tiktok.com/ZMhqRBmXW/", "https://vm.tiktok.com/ZMhqRBmXW/"],
		["https://vt.tiktok.com/ZSabcdefg", "https://vt.tiktok.com/ZSabcdefg/"],
		["https://www.tiktok.com/t/ZTabcdefg/", "https://www.tiktok.com/t/ZTabcdefg/"],
		["https://vm.tiktok.com/ZMhqRBmXW/?_r=1", "https://vm.tiktok.com/ZMhqRBmXW/"],
	] as const) {
		const result = expectShortlink(input);
		assert.equal(result.provider, "tiktok", input);
		assert.equal(result.expandUrl, expandUrl, input);
	}
});

test("TikTok: 対象外・壊れた形は弾く", () => {
	expectNull(`https://www.tiktok.com/@scout2015/photo/${TT_ID}`); // 写真投稿は今回のスコープ外
	expectNull("https://www.tiktok.com/@scout2015"); // プロフィール
	expectNull("https://www.tiktok.com/@scout2015/video/123"); // 桁が足りない
	expectNull(`https://www.tiktok.com/@scout2015/video/${TT_ID}x`); // 数字以外が混じる
	expectNull(`https://www.tiktok.com/@scout 2015/video/${TT_ID}`); // ユーザー名に空白
	expectNull("https://www.tiktok.com/t/"); // code が無い
	expectNull("https://vm.tiktok.com/"); // code が無い
	expectNull("https://vm.tiktok.com/ZM-hq/"); // 短縮コードに使われない文字
});

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

test("Instagram: reel / reels / {username} 付きを同じ canonical へ寄せる", () => {
	for (const input of [
		`https://www.instagram.com/reel/${IG_CODE}/`,
		`https://www.instagram.com/reels/${IG_CODE}/`,
		`https://www.instagram.com/reel/${IG_CODE}`,
		`https://www.instagram.com/scout2015/reel/${IG_CODE}/`,
		`https://instagram.com/reel/${IG_CODE}/`,
		`https://m.instagram.com/reel/${IG_CODE}/`,
		`https://instagr.am/reel/${IG_CODE}/`,
	]) {
		const result = expectContent(input);
		assert.equal(result.externalContentId, IG_CODE, input);
		assert.equal(result.canonicalUrl, `https://www.instagram.com/reel/${IG_CODE}/`, input);
	}
});

test("Instagram: feed 投稿（/p/）は /p/ のまま正規化する", () => {
	for (const input of [
		`https://www.instagram.com/p/${IG_CODE}/`,
		`https://www.instagram.com/scout2015/p/${IG_CODE}/`,
		`https://instagr.am/p/${IG_CODE}/`,
	]) {
		const result = expectContent(input);
		assert.equal(result.provider, "instagram", input);
		assert.equal(result.canonicalUrl, `https://www.instagram.com/p/${IG_CODE}/`, input);
	}
});

test("Instagram: igsh などの追跡パラメータを canonical から落とす", () => {
	// igsh は共有した人を特定しうる値なので、保存する前に必ず落とす。
	const input = `https://www.instagram.com/reel/${IG_CODE}/?igsh=MzRlODBiNWFlZA%3D%3D&utm_source=ig_web_copy_link`;
	const result = expectContent(input);
	assert.equal(result.canonicalUrl, `https://www.instagram.com/reel/${IG_CODE}/`);
	assert.equal(result.mediaIndex, undefined);
});

test("Instagram: カルーセルの img_index は canonical から外し、独立した値として返す", () => {
	// canonical に混ぜると「同じ投稿の 1 枚目と 2 枚目」で別 URL になり、自然キーの意味が壊れる。
	const result = expectContent(`https://www.instagram.com/p/${IG_CODE}/?img_index=2&igsh=abc`);
	assert.deepEqual(result, {
		kind: "content",
		provider: "instagram",
		externalContentId: IG_CODE,
		canonicalUrl: `https://www.instagram.com/p/${IG_CODE}/`,
		mediaIndex: 2,
	});
});

test("Instagram: 壊れた img_index は黙って捨てる（推測で補完しない）", () => {
	for (const raw of ["0", "-1", "abc", "1.5", "999", ""]) {
		const result = expectContent(`https://www.instagram.com/p/${IG_CODE}/?img_index=${raw}`);
		assert.equal(result.mediaIndex, undefined, raw);
	}
});

test("Instagram: 同じ投稿は path が違っても externalContentId が一致する（自然キーが割れない）", () => {
	const asReel = expectContent(`https://www.instagram.com/reel/${IG_CODE}/`);
	const asPost = expectContent(`https://www.instagram.com/p/${IG_CODE}/`);
	assert.equal(asReel.externalContentId, asPost.externalContentId);
});

test("Instagram: 対象外の形は弾く", () => {
	expectNull(`https://www.instagram.com/tv/${IG_CODE}/`); // IGTV
	expectNull("https://www.instagram.com/stories/scout2015/1234567890/"); // story
	expectNull(`https://www.instagram.com/share/reel/${IG_CODE}/`); // 解決先が未検証
	expectNull("https://www.instagram.com/scout2015/"); // プロフィール
	expectNull("https://www.instagram.com/p/ab/"); // shortcode が短すぎる
	expectNull(`https://www.instagram.com/p/${IG_CODE}/liked_by/`); // 余分なセグメント
	expectNull("https://www.instagram.com/p/DAbc!DefGh/"); // 使われない文字
});

// ---------------------------------------------------------------------------
// 共有テキスト・空白・入力の揺れ
// ---------------------------------------------------------------------------

test("前後の空白と、モバイルアプリが付ける余分なテキストを跨いで URL を拾う", () => {
	for (const input of [
		`   https://www.youtube.com/shorts/${YT_ID}   `,
		`\n\thttps://www.youtube.com/shorts/${YT_ID}\n`,
		`この動画をチェック https://www.youtube.com/shorts/${YT_ID} `,
		`「めちゃうまラーメン」 https://www.youtube.com/shorts/${YT_ID} via @someone`,
	]) {
		assert.equal(expectContent(input).canonicalUrl, `https://www.youtube.com/shorts/${YT_ID}`, input);
	}
});

test("日本語の句読点や閉じ括弧が URL に食い込んでも落とす", () => {
	for (const input of [
		`見て → https://www.youtube.com/shorts/${YT_ID}。`,
		`(https://www.youtube.com/shorts/${YT_ID})`,
		`「https://www.youtube.com/shorts/${YT_ID}」`,
	]) {
		assert.equal(expectContent(input).canonicalUrl, `https://www.youtube.com/shorts/${YT_ID}`, input);
	}
});

test("全角で貼られた URL を NFKC で救う", () => {
	const fullWidth = `ｈｔｔｐｓ：／／ｗｗｗ．ｙｏｕｔｕｂｅ．ｃｏｍ／ｓｈｏｒｔｓ／${YT_ID}`;
	assert.equal(expectContent(fullWidth).canonicalUrl, `https://www.youtube.com/shorts/${YT_ID}`);
});

test("複数の URL が含まれるときは最初の 1 件を使う", () => {
	const input = `https://www.youtube.com/shorts/${YT_ID} と https://www.tiktok.com/@scout2015/video/${TT_ID}`;
	assert.equal(expectContent(input).provider, "youtube");
});

test("URL を含まない入力・空・null・非文字列は null", () => {
	expectNull("");
	expectNull("   ");
	expectNull("ラーメン食べたい");
	expectNull("www.tiktok.com/@scout2015/video/" + TT_ID); // スキームが無いものは推測で補完しない
	assert.equal(parseSnsUrl(null), null);
	assert.equal(parseSnsUrl(undefined), null);
	assert.equal(parseSnsUrl(123 as unknown as string), null);
});

test("極端に長い入力は正規表現に食わせる前に落とす", () => {
	expectNull(`https://www.youtube.com/shorts/${YT_ID}?pad=${"a".repeat(5000)}`);
});

// ---------------------------------------------------------------------------
// 悪意のある入力
// ---------------------------------------------------------------------------

test("javascript: / data: / file: スキームは通さない", () => {
	expectNull("javascript:alert(1)");
	expectNull("javascript:void(0)");
	expectNull("data:text/html,<script>alert(1)</script>");
	expectNull(`file:///etc/passwd`);
	// 危険なスキームの後ろに正規 URL を紛れ込ませても、拾うのは http(s) の側だけ
	assert.equal(
		expectContent(`javascript:alert(1);https://www.youtube.com/shorts/${YT_ID}`).canonicalUrl,
		`https://www.youtube.com/shorts/${YT_ID}`,
	);
});

test("ホスト名は完全一致で判定する（部分一致・サフィックス偽装を通さない）", () => {
	// 後ろに足したもの
	expectNull(`https://tiktok.com.evil.example/@scout2015/video/${TT_ID}`);
	expectNull(`https://www.youtube.com.evil.example/shorts/${YT_ID}`);
	expectNull(`https://instagram.com.evil.example/reel/${IG_CODE}/`);
	// 前に足したもの
	expectNull(`https://evil-tiktok.com/@scout2015/video/${TT_ID}`);
	expectNull(`https://notyoutube.com/shorts/${YT_ID}`);
	expectNull(`https://xinstagram.com/reel/${IG_CODE}/`);
	// パスに入れただけのもの
	expectNull(`https://evil.example/tiktok.com/@scout2015/video/${TT_ID}`);
	expectNull(`https://evil.example/?url=https://www.youtube.com/shorts/${YT_ID}`);
	// 許可していないサブドメイン
	expectNull(`https://evil.www.youtube.com/shorts/${YT_ID}`);
	expectNull(`https://api.tiktok.com/@scout2015/video/${TT_ID}`);
});

test("user:pass@ でホストを誤認させる形を弾く", () => {
	expectNull(`https://www.youtube.com@evil.example/shorts/${YT_ID}`);
	expectNull(`https://user:pass@www.youtube.com/shorts/${YT_ID}`);
	expectNull(`https://www.tiktok.com:pass@evil.example/@scout2015/video/${TT_ID}`);
});

test("非既定ポートを明示した URL を弾く", () => {
	expectNull(`https://www.youtube.com:8080/shorts/${YT_ID}`);
	expectNull(`http://www.youtube.com:1337/shorts/${YT_ID}`);
	// 既定ポートの明示は URL API が正規化するので通ってよい
	assert.equal(
		expectContent(`https://www.youtube.com:443/shorts/${YT_ID}`).canonicalUrl,
		`https://www.youtube.com/shorts/${YT_ID}`,
	);
});

test("同形異字（キリル文字）のドメインを弾く", () => {
	// "https://www.tiktоk.com/..." の o がキリル文字。NFKC ではラテン文字にならず、
	// punycode 化されたホスト名は許可リストに一致しない。
	expectNull(`https://www.tiktоk.com/@scout2015/video/${TT_ID}`);
	expectNull(`https://www.yоutube.com/shorts/${YT_ID}`);
});

test("IP アドレスや localhost へ向いた URL を弾く", () => {
	expectNull(`https://127.0.0.1/shorts/${YT_ID}`);
	expectNull(`https://localhost/shorts/${YT_ID}`);
	expectNull(`https://169.254.169.254/latest/meta-data/`);
	expectNull(`https://[::1]/shorts/${YT_ID}`);
});

test("対象外 provider（X / threads）は例外を投げずに null を返す", () => {
	// migration の dmee_provider_check が instagram / tiktok / youtube しか許さないため、
	// ここで通してしまうと保存時まで失敗が遅れる。
	expectNull("https://x.com/scout2015/status/1234567890123456789");
	expectNull("https://twitter.com/scout2015/status/1234567890123456789");
	expectNull("https://t.co/abcdefghij");
	expectNull(`https://www.threads.net/@scout2015/post/${IG_CODE}`);
	expectNull(`https://www.threads.com/@scout2015/post/${IG_CODE}`);
	expectNull("https://www.facebook.com/reel/1234567890");
});

test("パス走査で許可パスへ潜り込めない", () => {
	expectNull(`https://www.youtube.com/shorts/../embed/${YT_ID}`); // URL の正規化で /embed/ になる
	expectNull(`https://www.instagram.com/reel/..%2f${IG_CODE}/`); // %2f はデコードしないので shortcode に一致しない
	expectNull(`https://www.tiktok.com/x/@scout2015/video/${TT_ID}`); // 手前に余分なセグメント
});

test("重複スラッシュは無視するが、セグメントの並びは崩さない", () => {
	// 空セグメントを落とすだけなので、同じ投稿として解釈される
	assert.equal(
		expectContent(`https://www.tiktok.com//@scout2015//video//${TT_ID}`).canonicalUrl,
		`https://www.tiktok.com/@scout2015/video/${TT_ID}`,
	);
});
