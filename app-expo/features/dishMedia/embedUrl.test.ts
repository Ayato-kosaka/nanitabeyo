import {
	EMBED_IFRAME_BASE_URL,
	buildEmbedIframeHtml,
	buildExternalEmbedPlayerSource,
	isAllowedEmbedNavigation,
	isInlineEmbedUrl,
} from "./embedUrl";

describe("buildExternalEmbedPlayerSource", () => {
	it("instagram はリールのコードでも /p/{code}/embed/ を組む（captioned は白カードが付くので使わない）", () => {
		expect(buildExternalEmbedPlayerSource("instagram", "DZnIRziT70s")).toEqual({
			embedUrl: "https://www.instagram.com/p/DZnIRziT70s/embed/",
			providerLabel: "Instagram",
			mode: "document",
		});
	});

	it("tiktok は embed/v2、youtube は playsinline 付き embed", () => {
		expect(buildExternalEmbedPlayerSource("tiktok", "6718335390845095173")?.embedUrl).toBe(
			"https://www.tiktok.com/embed/v2/6718335390845095173",
		);
		expect(buildExternalEmbedPlayerSource("youtube", "abc123")?.embedUrl).toBe(
			"https://www.youtube.com/embed/abc123?playsinline=1&autoplay=1&enablejsapi=1",
		);
	});

	/*
	#1641 ⚠️ **YouTube のループを URL（`loop=1&playlist=`）へ戻さないこと。**

	一度そう実装したが、**オーナーの実機で不具合になった**（2026-08-30、スクリーンショット）。
	`playlist` を渡すと YouTube は **プレイリストのプレイヤー**として振る舞い、映像の上に
	**前後ボタン（⏮ ▶ ⏭）が出る**。単一動画の埋め込みには無いもので、しかもそのコマは
	0:00 のまま止まっていた。ループのためにプレイヤーの種類ごと変える代償が大きすぎる。

	こちらは `enablejsapi=1` で IFrame API を握っているので、**終わったことを検知して
	撃ち直す**（`buildEmbedIframeHtml` の playerState 0 = ENDED）。
	*/
	it("youtube のループは URL ではなく包みの JS が撃つ（playlist を渡さない）", () => {
		const url = buildExternalEmbedPlayerSource("youtube", "abc123")?.embedUrl ?? "";
		// ここが落ちたら、プレイヤーがプレイリスト用に変わって前後ボタンが出る
		expect(url).not.toContain("playlist=");
		expect(url).not.toContain("loop=1");
		// API を握っていること自体がループの前提（外すとループの手段が無くなる）
		expect(url).toContain("enablejsapi=1");

		const html = buildEmbedIframeHtml(url);
		// ENDED（playerState 0）で頭へ戻して撃ち直す
		expect(html).toContain("data.info.playerState === 0");
		expect(html).toContain("seekTo");
	});

	/*
	#1641 オーナー報告「YouTube shorts がアプリ内再生できない」の真因。

	YouTube の埋め込みは **トップレベル文書として開かれると必ずエラー 153** になる。
	実測では、誰でも埋め込める `dQw4w9WgXcQ` ですら直接開くと 153 で、
	実 https オリジンのページに iframe として置くと無音で自動再生した。

	WebView は URL を渡すとトップレベル文書として開くので、
	**YouTube だけは包みの HTML が要る**。ここが `document` へ戻ると、また再生できなくなる。
	*/
	it("youtube だけ iframe モード（直接開くとエラー 153 になる）", () => {
		expect(buildExternalEmbedPlayerSource("youtube", "abc123")?.mode).toBe("iframe");
		expect(buildExternalEmbedPlayerSource("instagram", "abc123")?.mode).toBe("document");
		expect(buildExternalEmbedPlayerSource("tiktok", "123")?.mode).toBe("document");
	});

	it("id は URL エンコードする（パス注入をさせない）", () => {
		expect(buildExternalEmbedPlayerSource("instagram", "a/../b")?.embedUrl).toBe(
			"https://www.instagram.com/p/a%2F..%2Fb/embed/",
		);
	});

	it("未知 provider と空 id は null（呼び出し側が外部で開くへ縮退）", () => {
		expect(buildExternalEmbedPlayerSource("x", "abc")).toBeNull();
		expect(buildExternalEmbedPlayerSource("instagram", "")).toBeNull();
	});
});

describe("buildEmbedIframeHtml", () => {
	const html = buildEmbedIframeHtml("https://www.youtube.com/embed/abc123?enablejsapi=1");

	it("埋め込みを iframe として置く", () => {
		expect(html).toContain('src="https://www.youtube.com/embed/abc123?enablejsapi=1"');
		expect(html).toContain('allow="autoplay; encrypted-media; picture-in-picture"');
	});

	/*
	⚠️ **中身は第三者のページである。**
	送る側は宛先オリジンを固定し、受ける側は `event.origin` を検査する。
	`*` で送ると、埋め込みが差し替わったときに任意の相手へ送ってしまう。
	*/
	it("postMessage の相手を YouTube に限定する（送信先・受信元の両方）", () => {
		expect(html).toContain("var ORIGIN = 'https://www.youtube.com'");
		expect(html).toContain("event.origin !== ORIGIN");
		expect(html).not.toContain("postMessage(JSON.stringify(message), '*')");
	});

	/*
	⚠️ 状態は `onStateChange` では飛んでこない。実測すると `infoDelivery` の中の
	   `info.playerState` に入る（再生できる動画は 1、埋め込み不可の動画は -1 → 3 のまま）。
	*/
	it("再生開始は infoDelivery の playerState で判定する", () => {
		expect(html).toContain("data.event === 'infoDelivery'");
		expect(html).toContain("data.info.playerState === 1");
	});

	/*
	#1641 **音は «出せないから無音» ではなく «こちらが無音にしていた»。**

	旧版は `onReady` で必ず `mute` してから `playVideo` していたので、YouTube だけ
	構造的に無音だった（実機ログ run 33149302351: `audio=muted`）。同じ WebView で
	Instagram は音付きで鳴っているので、端末側の制限ではない。まず音ありで撃ち、
	始まらなかったときだけ無音へ落とす。
	*/
	it("まず音ありで撃ち、始まらなければ無音で撃ち直す", () => {
		expect(html).toContain("func: 'unMute'");
		expect(html).toContain("if (started) return;");
		expect(html).toContain("func: 'mute'");
		// unMute が mute より先に出てくること（順序が逆だと音ありを試さずに終わる）
		expect(html.indexOf("func: 'unMute'")).toBeLessThan(html.indexOf("func: 'mute'"));
	});

	it("音の有無は報告に載せる（muted 決め打ちにしない）", () => {
		expect(html).toContain("'audible'");
		expect(html).toContain("lastMuted ? 'muted' : 'audible'");
	});

	/*
	#1641 ⚠️ **URL に `mute=1` を付けないこと。**

	付けるとプレイヤーが無音で始まり、あとから `unMute` を撃っても実機では無音のままだった
	（run 33167111834: `audio=muted`。同じ run で TikTok は `audible` になっている）。
	*/
	it("YouTube の埋め込み URL に mute=1 を付けない", () => {
		expect(buildExternalEmbedPlayerSource("youtube", "abc123")?.embedUrl).not.toContain("mute=1");
	});

	/*
	#1641 プレイヤーが起きてこないセルは、いつまでも第三者のエラー画面を見せ続けない。
	実測（run 33170443855）: 埋め込み不可の動画は YouTube 自身の bot 確認ページが出たままだった。

	⚠️ **短くしすぎない。** 経緯は 2 段ある。

	| いつ | 値 | 何が起きたか |
	| --- | --- | --- |
	| 当初 | 6 秒 | 実機でまだ準備中の YouTube を 2 セル分 «再生できない» へ落とした（run 33205231591） |
	| その後 | 10 秒 | **それでも足りなかった。** 計装 `sinceActiveMs` の実測で `youtube visit=1 11048ms → no_video (no_ready)`（run 33335797659） |
	| いま | 20 秒 | 上の実測を受けて延ばした |

	掛かると «YouTube で見る» の帯へ落ちるので、ユーザーからは «起動しない» に見える
	（オーナー報告そのもの）。**待つ代償はこの値を決めた当時より下がっている**
	（待っている間はアプリ側のサムネイルが見える）。
	*/
	it("onReady が来なければ縮退させるが、20 秒は待つ（10 秒では遅い回線で誤って畳んだ）", () => {
		expect(html).toContain("if (!started) report('no_video', 'no_ready'); }, 20000);");
	});

	/*
	#1641 タップで音を出す口。**結果を報告し直す**ので、効いたかどうかを計測で判定できる。
	*/
	it("タップから叩ける unMute の口を置き、結果を報告し直す", () => {
		expect(html).toContain("window.__nbEmbedUnmute = function ()");
		expect(html).toContain("kind: 'unmute_result'");
	});

	it("結論は 1 度だけ報告する（再生後に締め切りで上書きしない）", () => {
		expect(html).toContain("if (settled) return;");
	});

	/*
	⚠️ `buildEmbedIframeHtml` はテンプレートリテラルなので、**コメントにバッククォートを
	   書くとそこで文字列が終わる**。実際にこのファイルで壊し、suite ごと読み込めなくなった
	   （`ExternalEmbedPlayer` の注入スクリプトでも同じ事故を起こしている）。目視では気付けない。
	*/
	/*
	⚠️ **注釈にバッククォートを書かない。** ここはテンプレートリテラルの内側で、書いた時点で
	   文字列が終わる。この作業で 3 回壊している（ディレクトリ名・video タグ・no_video の表記）。
	*/
	it("組み立てた HTML にバッククォートが混ざっていない", () => {
		expect(html).not.toContain("`");
	});

	it("baseUrl は実在の https オリジン（about:blank や 127.0.0.1 では YouTube が拒否する）", () => {
		expect(EMBED_IFRAME_BASE_URL).toMatch(/^https:\/\//);
	});
});

describe("isAllowedEmbedNavigation", () => {
	it("http(s) と about: は通す（埋め込み内部のリダイレクト・広告フレームを打ち切らない）", () => {
		expect(isAllowedEmbedNavigation("https://www.instagram.com/p/abc/embed/?cr=1")).toBe(true);
		expect(isAllowedEmbedNavigation("http://example.com/redirected")).toBe(true);
		expect(isAllowedEmbedNavigation("about:blank")).toBe(true);
	});

	it("inline 継続してよいのは «埋め込みページの形» だけ（許可リスト。独立レビュー指摘）", () => {
		// 埋め込み本体 → inline
		expect(isInlineEmbedUrl("https://www.instagram.com/p/DZFdePPzzLI/embed/")).toBe(true);
		expect(isInlineEmbedUrl("https://www.instagram.com/reel/DZFdePPzzLI/embed/?cr=1")).toBe(true);
		expect(isInlineEmbedUrl("https://www.tiktok.com/embed/v2/12345")).toBe(true);
		expect(isInlineEmbedUrl("https://www.youtube.com/embed/abc123?autoplay=1")).toBe(true);
		expect(isInlineEmbedUrl("https://WWW.INSTAGRAM.COM/p/abc/embed/")).toBe(true); // ホストは小文字化して判定

		// 本体サイト・ログイン・短縮 URL・外部リンク shim → inline させない（アプリ内ブラウザへ逃がす）
		expect(isInlineEmbedUrl("https://www.instagram.com/reel/DZFdePPzzLI/")).toBe(false);
		expect(isInlineEmbedUrl("https://www.instagram.com/accounts/login/?next=/p/abc/embed/")).toBe(false);
		expect(isInlineEmbedUrl("https://l.instagram.com/?u=https%3A%2F%2Fexample.com")).toBe(false);
		expect(isInlineEmbedUrl("https://vm.tiktok.com/ZSabc/")).toBe(false);
		expect(isInlineEmbedUrl("https://instagr.am/p/abc/embed/")).toBe(false);
		expect(isInlineEmbedUrl("https://www.youtube.com/watch?v=abc")).toBe(false);
		// 広告等の別ドメインはトップフレームでは来ない前提。来ても inline させない
		expect(isInlineEmbedUrl("https://googleads.g.doubleclick.net/frame")).toBe(false);
		expect(isInlineEmbedUrl("not a url")).toBe(false);
	});

	it("アプリ起動スキームは遮断する", () => {
		expect(isAllowedEmbedNavigation("intent://reel/abc#Intent;package=com.instagram.android;end")).toBe(false);
		expect(isAllowedEmbedNavigation("market://details?id=com.instagram.android")).toBe(false);
		expect(isAllowedEmbedNavigation("javascript:alert(1)")).toBe(false);
	});
});
