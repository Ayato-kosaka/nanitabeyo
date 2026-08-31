/*
#1641 **WebView 入りビルド**の自動再生。

`ExternalEmbedPlayer.test.tsx` は «WebView 不在ビルド»（`UIManager.hasViewManagerConfig("RNCWebView")`
が false）を見ている。#1641 で入れた «自動再生できたセルには何も重ねない / 再生できない投稿だけ
導線へ縮退する» の分岐は WebView が在るときにしか通らないので、**別ファイル**に分ける。

⚠️ 同じファイルに同居させられない理由: `ExternalEmbedPlayer.tsx` は WebView の在否を
モジュールスコープの `cachedProbe` へ 1 度だけ焼くため、先に読まれた «不在» の結果が残る。
`jest.isolateModules` で回避しようとすると React 実体が二重になって
`Cannot read properties of null (reading 'useContext')` で落ちる。ファイルを分けるのが正しい。
*/
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { StyleSheet, UIManager, View } from "react-native";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(() => Promise.resolve({ type: "dismiss" })) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
// `mock` 始まりの名前だけが jest.mock の工場から参照できる（jest の制約）
const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("lucide-react-native", () => ({ Play: () => null, Volume2: () => null }));
jest.mock("react-native-gesture-handler", () => ({
	GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));

let webViewProps: Record<string, any> = {};
jest.mock("react-native-webview", () => ({
	WebView: (props: Record<string, any>) => {
		webViewProps = props;
		return null;
	},
}));

import { ExternalEmbedPlayer } from "./ExternalEmbedPlayer";

const EMBED = {
	provider: "instagram" as const,
	externalContentId: "CDg3owdFa6W",
	canonicalUrl: "https://www.instagram.com/reel/CDg3owdFa6W/",
	embedStatus: "available" as const,
	// #1641 既定は «判定していない» ＝ 従来どおり実際に読み込んで試す
	playbackStatus: "unknown" as const,
};

// probe は render 時に走るので、最初の render より前に立てておけば足りる
beforeAll(() => {
	jest.spyOn(UIManager as any, "hasViewManagerConfig").mockReturnValue(true);
});

/**
 * #1641 WebView はセル全面に置かれるようになったので、寸法を測る手順は要らない
 * （中身の全面化は注入した CSS が担う）。
 */
function renderActiveCell(): ReactTestRenderer {
	let tree!: ReactTestRenderer;
	act(() => {
		tree = create(<ExternalEmbedPlayer embed={EMBED} isActive />);
	});
	return tree;
}

const post = (payload: unknown) =>
	act(() => {
		webViewProps.onMessage({ nativeEvent: { data: JSON.stringify(payload) } });
	});

const fallbackCount = (tree: ReactTestRenderer) =>
	tree.root.findAllByProps({ testID: "external-embed-fallback" }).length;

/*
#1641 **サーバが «再生できない» と判定済みのセルは、WebView を 1 つも作らない。**

オーナー指摘 2026-08-28:「今は、埋め込み時に分岐しているんですね。それって処理重く
なりますよね？」。従来はどのセルもいったんページを読み、ページ内のエージェントの報告を
待ってから畳んでいた（＝再生できない投稿でも毎回 Chromium のレンダラを 1 つ起こしていた）。
*/
/*
#1641 **iframe モード（YouTube）は、再生できないと分かった時点で WebView ごと畳む。**

別オリジンなので中を隠せない。以前は地色で覆っていたが、覆いは**料理の写真ごと隠す**
（run 33225189456 の autoplay-08 が真っ黒なセル＋帯だった）。
*/
describe("#1641 再生できない YouTube セルは畳む", () => {
	const YOUTUBE = {
		provider: "youtube" as const,
		externalContentId: "dQw4w9WgXcQ",
		canonicalUrl: "https://www.youtube.com/shorts/dQw4w9WgXcQ",
		embedStatus: "available" as const,
		playbackStatus: "playable" as const,
	};

	const renderYouTube = (): ReactTestRenderer => {
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<ExternalEmbedPlayer embed={YOUTUBE} isActive />);
		});
		return tree;
	};

	it("読み込めている間は WebView を置いたまま", () => {
		const tree = renderYouTube();
		expect(tree.root.findAllByProps({ testID: "external-embed-webview" }).length).toBeGreaterThan(0);
		expect(tree.root.findAllByProps({ testID: "external-embed-collapsed" }).length).toBe(0);
	});

	it("«再生できない» の報告が来たら WebView を畳み、導線だけ残す", () => {
		const tree = renderYouTube();
		post({ src: "nb-embed-autoplay", kind: "no_ready", detail: null });

		// 向こうのページ（bot 確認画面）ごと消える
		expect(tree.root.findAllByProps({ testID: "external-embed-webview" }).length).toBe(0);
		expect(tree.root.findAllByProps({ testID: "external-embed-collapsed" }).length).toBeGreaterThan(0);
		expect(fallbackCount(tree)).toBeGreaterThan(0);
	});

	/*
	⚠️ **一度再生できたセルは畳まない。** loop の保険から入る再試行が期限切れの CDN URL に
	   当たって «再生できない» を後出しする実績がある（run 33168644022）。畳むと
	   **再生中の映像が消える**。
	*/
	it("一度 playing になったセルは、その後の失敗報告で畳まない", () => {
		const tree = renderYouTube();
		post({ src: "nb-embed-autoplay", kind: "playing", detail: null });
		post({ src: "nb-embed-autoplay", kind: "no_ready", detail: null });

		expect(tree.root.findAllByProps({ testID: "external-embed-webview" }).length).toBeGreaterThan(0);
		expect(tree.root.findAllByProps({ testID: "external-embed-collapsed" }).length).toBe(0);
	});
});

describe("#1641 サーバ判定による高速パス", () => {
	const renderWith = (playbackStatus: "unknown" | "playable" | "not_playable"): ReactTestRenderer => {
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<ExternalEmbedPlayer embed={{ ...EMBED, playbackStatus }} isActive />);
		});
		return tree;
	};

	it("not_playable なら WebView をマウントしない", () => {
		const tree = renderWith("not_playable");
		expect(tree.root.findAllByProps({ testID: "external-embed-webview" })).toHaveLength(0);
		// 代わりに «Instagram で見る» の導線へ縮退している
		expect(fallbackCount(tree)).toBeGreaterThan(0);
		expect(tree.root.findAllByProps({ testID: "external-embed-known-not-playable-instagram" }).length).toBeGreaterThan(
			0,
		);
	});

	/*
	⚠️ ここが要。**TikTok は判定材料が無く常に `unknown`** である。
	   «playable 以外を弾く» と書いた瞬間に TikTok が 1 本も再生されなくなる。
	*/
	it("unknown なら従来どおり WebView を立てて実際に試す", () => {
		const tree = renderWith("unknown");
		expect(tree.root.findAllByProps({ testID: "external-embed-webview" }).length).toBeGreaterThan(0);
	});

	it("playable でも WebView は立てる（判定は «出さない» ためだけに使う）", () => {
		const tree = renderWith("playable");
		expect(tree.root.findAllByProps({ testID: "external-embed-webview" }).length).toBeGreaterThan(0);
	});

	/*
	`external-embed-cell-{provider}` は «このセルに着いたか» の印である。再生できない
	セルで消えると、Detox から «着けなかった» と区別できなくなる（run 33138096398 で
	実際に切り分けられなかった）。
	*/
	it("«セルに着いた» 印は再生可否によらず出る", () => {
		for (const status of ["unknown", "playable", "not_playable"] as const) {
			const tree = renderWith(status);
			expect(tree.root.findAllByProps({ testID: "external-embed-cell-instagram" }).length).toBeGreaterThan(0);
		}
	});
});

describe("#1641 WebView 入りビルドの自動再生", () => {
	it("WebView は常に表示専用で、自動再生スクリプトと onMessage を積んでいる", () => {
		const tree = renderActiveCell();
		// 触らせない = 縦スワイプでのフィード送りが既存の動画セルと同じ経路になる
		expect(tree.root.findAllByProps({ testID: "external-embed-webview" })[0].props.pointerEvents).toBe("none");
		// ⚠️ iOS は onMessage が無いと injectedJavaScript が登録すらされない
		expect(typeof webViewProps.onMessage).toBe("function");
		expect(webViewProps.injectedJavaScript).toContain("__nbEmbedAutoplay");
		expect(webViewProps.mediaPlaybackRequiresUserAction).toBe(false);
	});

	/*
	#1641 `mode: "iframe"`（YouTube）では WebView へ HTML を直接渡すため、
	**トップフレームの URL は `baseUrl`（自分たちのドメイン）になる**。
	これを許可リストへ入れ忘れると、読み込もうとした瞬間に自分で自分を止める。
	*/
	it("包みのページ（baseUrl）自身の読み込みを止めない", () => {
		renderActiveCell();
		const shouldStart = webViewProps.onShouldStartLoadWithRequest;
		// このセルは Instagram（mode: document）なので、包みの URL は通さない
		expect(shouldStart({ url: "https://app.nanitabeyo.net/", isTopFrame: true })).toBe(false);
		// サブフレーム（埋め込みの中の通信）は従来どおり素通し
		expect(shouldStart({ url: "https://www.youtube.com/embed/abc", isTopFrame: false })).toBe(true);
	});

	/*
	#1641 **導線の帯がフィード送りを塞いではいけない。**

	WebView 自身は `pointerEvents="none"` なので、**このセルで指を受け取りうる View は
	この覆いの中だけ**である。そこに全面の View が 1 つでもあれば、縦スワイプはそこで
	止まり、その先のセルへ永久に到達できない（＝ 再生の実装が正しくても
	«再生できない» と報告される）。

	⚠️ «タップ受け»（`playHintTapTarget`）を帯の大きさへ縮めるだけでは足りない。
	   帯を包む `GestureDetector` の中の View が全面のままなら同じことが起きる。
	   だから個別の style ではなく **«覆いの内側に全面の受け手が居ないこと»** を見る。

	⚠️ run 33138096398 / 33146739657 の «セルから動かない» は、調べた結果
	   **フィードの最後のセルだったから**で、これが原因ではなかった（お店フィードは
	   料理 1 件につき 1 本しか返さない）。ここは «まだ踏んでいないが確実に踏む» 穴として塞ぐ。
	*/
	it("導線の覆いの内側に «セル全面» のタッチ受けを置かない（フィードを送れなくなる）", () => {
		/** RN の絶対全面指定（`StyleSheet.absoluteFill` / 4 辺 0）か */
		const fillsWholeCell = (style: unknown): boolean => {
			const flat = StyleSheet.flatten(style as never) as Record<string, unknown> | undefined;
			if (!flat || flat.position !== "absolute") return false;
			return [flat.top, flat.left, flat.right, flat.bottom].every((value) => value === 0);
		};

		let tree!: ReactTestRenderer;
		act(() => {
			// ⚠️ blockParentTapGesture を渡さないと GestureDetector の枝が描かれず、検証が素通りする
			tree = create(<ExternalEmbedPlayer embed={EMBED} isActive blockParentTapGesture={{} as never} />);
		});
		post({ src: "nb-embed-autoplay", kind: "no_video", detail: null });

		const [fallback] = tree.root.findAllByProps({ testID: "external-embed-fallback" });
		expect(fallback).toBeDefined();
		// 覆いそのものは全面だが、指を受けない（box-none）ので送りを止めない
		expect(fallback.props.pointerEvents).toBe("box-none");

		const touchable = fallback
			.findAllByType(View)
			.filter((node) => node !== fallback && node.props.pointerEvents !== "none");
		expect(touchable.length).toBeGreaterThan(0);
		// ⚠️ 件数で比べる。node をそのまま expect へ渡すとツリー全体が直列化され、
		//    失敗時に 90 秒かかる（実測）
		expect(touchable.filter((node) => fillsWholeCell(node.props.style)).length).toBe(0);
	});

	/*
	#1641 **TikTok が無音だったのは、向こうが muted で置いた <video> を
	«そのまま» 再生していたからである。**

	実機の構造化ログ（run 33149302351）:

	    instagram … audio=audible   （向こうの <video> がミュートでない）
	    tiktok    … audio=muted     （向こうが muted で置いている）

	同じ WebView で Instagram が音付きで鳴っている以上、端末側の制限ではない。
	撃つ前にこちらでミュートを外す。⚠️ ただし **NotAllowedError で蹴られた後は戻さない**
	（戻すと再生そのものが止まり、«無音でも動く» すら失う）。
	*/
	it("再生前にミュートを外す。ポリシーで蹴られたときだけ無音へ落とす", () => {
		renderActiveCell();
		const script: string = webViewProps.injectedJavaScript;
		expect(script).toContain("function tryUnmute(v)");
		expect(script).toContain("v.muted = false;");
		// 蹴られた後は二度と外さない
		expect(script).toContain("if (mutedByPolicy) return;");
		expect(script).toContain("mutedByPolicy = true;");
	});

	/*
	#1641 **再生できたセルを、後から «再生できない» へ落とさない。**

	実測（run 33168644022 / Android）: TikTok が `playing` の 0.8 秒後に `not_supported` を
	報告していた（loop の保険から入る再試行で、期限切れの CDN URL に当たったため）。
	呼び出し側は後者で縮退するので、**再生中の映像の上に «TikTok で見る» の帯が出る**。
	*/
	it("playing の後に来た失敗報告では縮退しない", () => {
		const tree = renderActiveCell();
		post({ src: "nb-embed-autoplay", kind: "playing", detail: "audible" });
		expect(fallbackCount(tree)).toBe(0);

		post({ src: "nb-embed-autoplay", kind: "not_supported", detail: "https://expired.example/video.mp4" });
		expect(fallbackCount(tree)).toBe(0);
	});

	it("注入スクリプト側でも、playing の後の失敗は送らない", () => {
		renderActiveCell();
		expect(webViewProps.injectedJavaScript).toContain("if (sent.playing && kind !== 'playing') return;");
	});

	/*
	#1641 **iframe モード（YouTube）だけは、再生できないと分かった時点で WebView ごと畳む。**

	別オリジンなのでこちらのスクリプトで中を隠せず、そのまま置くと YouTube 自身の
	bot 確認ページがセルに出る（run 33170443855 で実測）。以前は地色で «覆って» いたが、
	覆いは**料理の写真ごと隠す** — 実機のコマ（run 33225189456 の autoplay-08）が
	真っ黒なセル＋帯になっていた。畳めば向こうのページは同じように消えたうえで、
	アプリが持っているサムネイルが見える。

	`document` モード（この spec の Instagram）は畳まない。1 コマ目の写真が出ており、
	それ自体が «その投稿の絵» として正しい。
	*/
	it("document モードでは畳まない（1 コマ目の写真を見せる）", () => {
		const tree = renderActiveCell();
		post({ src: "nb-embed-autoplay", kind: "no_video", detail: null });
		expect(tree.root.findAllByProps({ testID: "external-embed-collapsed" }).length).toBe(0);
		// WebView は置いたまま（1 コマ目の写真がそこに出ている）
		expect(tree.root.findAllByProps({ testID: "external-embed-webview" }).length).toBeGreaterThan(0);
	});

	/*
	#1641 ⚠️ **ただし «1 つも組み上がらなかった» ときは document モードでも畳む。**

	中に写真も何も無いので、WebView は **ただの黒い板**になってサムネイルを隠す。
	実機で実測した（run 33265424032 の iOS `feed-02`: TikTok のセルが真っ黒＋
	「TikTok で見る」の帯だけ。ページは空のまま `still_loading` で時間切れ）。
	*/
	/*
	#1641 オーナー報告（実機 2026-08-30）「TikTok だけ、やっぱりたまに動画ロードに失敗する」。

	空の文書（1 バイトも来なかった）は **«この投稿は再生できない» ではない**。
	同じ投稿が直前・直後に再生できているので、畳まずに読み直す。

	⚠️ ここで畳んだりサーバへ報告したりすると、通信が転んだだけの投稿が
	   not_playable に落ち、**検索フィードから永久に外れる**。
	*/
	it("空の文書ではすぐ畳まず、サーバへ «再生できない» とも報告しない", () => {
		const onUnplayable = jest.fn();
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<ExternalEmbedPlayer embed={EMBED} isActive onUnplayable={onUnplayable} />);
		});

		post({ src: "nb-embed-autoplay", kind: "blank", detail: "load_complete script=0" });

		expect(tree.root.findAllByProps({ testID: "external-embed-collapsed" }).length).toBe(0);
		expect(fallbackCount(tree)).toBe(0);
		expect(onUnplayable).not.toHaveBeenCalled();
	});

	/*
	#1641 ⚠️ **«まだ準備できていない» をサーバへ報告しない。**

	実測（run 33345690986 / commit 381e35ac / 同じ 1 つの YouTube セル）:

	    01:26:11  no_video (no_ready)      sinceActiveMs=27745  ← ここで畳んだ
	    01:26:55  autoplay_started audible sinceActiveMs=34348  ← 6.6 秒後に鳴った

	同じセルが後から鳴っている以上、no_ready は «その投稿に映像が無い» の根拠にならない。
	素材は dQw4w9WgXcQ（誰でも埋め込めることが広く知られている動画）である。
	本当に埋め込めない動画は onError / errorCode で **数字**が detail に載るので、
	沈黙（no_ready / no_state_change）とは区別が付く。

	⚠️ この検証を外すと、遅いだけの投稿に対してサーバへ «確かめ直して» を投げ続ける。
	*/
	it("«まだ準備できていない»（no_ready / no_state_change）はサーバへ報告しない", () => {
		for (const [kind, detail] of [
			["no_video", "no_ready"],
			["timeout", "no_state_change"],
		]) {
			const onUnplayable = jest.fn();
			act(() => {
				create(<ExternalEmbedPlayer embed={EMBED} isActive onUnplayable={onUnplayable} />);
			});
			post({ src: "nb-embed-autoplay", kind, detail });
			expect(onUnplayable).not.toHaveBeenCalled();
		}
	});

	/*
	#1641 ただし **本当に埋め込めない動画は報告する**。YouTube の IFrame API は
	onError / errorCode を返すので、detail に数字が載る。沈黙とは区別が付く。
	*/
	it("埋め込み不可（errorCode つき）はこれまでどおりサーバへ報告する", () => {
		const onUnplayable = jest.fn();
		act(() => {
			create(<ExternalEmbedPlayer embed={EMBED} isActive onUnplayable={onUnplayable} />);
		});

		post({ src: "nb-embed-autoplay", kind: "no_video", detail: "150" });

		expect(onUnplayable).toHaveBeenCalledTimes(1);
	});

	/*
	#1641 ⚠️ **«空の文書» を分けられる値を落とさないこと。**

	どの値が実際に使えるかは Playwright で実測した（同じ TikTok embed URL を開いて計測）。
	期待だけで並べると «全部 -1» の役に立たない記録が残る。

	| 送る値 | Android WebView | iOS WKWebView |
	| --- | --- | --- |
	| enc | 63458 ✅ | 55513 / 停まった TikTok でも 38900 ✅ |
	| chars | 244532 ✅ | 245694 / body 未生成なら -1 ✅ |
	| blankUrl | ✅ | ✅ |
	| bytes | 63758 | 55813 |
	| st | 200 ✅ | -1（undefined） |

	⚠️ この 3 つ（enc / chars / blankUrl）を消すと、次に空が返っても
	   «空だった» までしか残らない。st は iOS で取れないので当てにしない。
	*/
	it("空の文書を分けられる値（enc / chars / blankUrl）を送っている", () => {
		renderActiveCell();
		const script: string = webViewProps.injectedJavaScript;

		expect(script).toContain("' enc=' +");
		expect(script).toContain("' chars=' +");
		expect(script).toContain("' blankUrl=' +");
	});

	/*
	#1641 ⚠️ **«空だった» で終わる記録を作らない。**

	オーナー端末の実測（2026-08-30 / commit 9b646339）で TikTok が 4 回落ちたとき、
	残っていたのは «中身ゼロのページが返った» までで、**直す先が決まらなかった**。
	同じ embed URL を 12 連打してもサーバは毎回 240KB を返すので、空は端末側で起きている。
	読み直す前に採った中身（HTTP ステータス / 転送バイト数 / 遷移の有無）を落とすと、
	次に同じことが起きてもまた «空だった» しか残らない。

	⚠️ この検証を外さないこと。外した状態で 1 度、オーナーに 3 回同じ報告をさせている。
	*/
	it("空の文書で読み直すときは、採った中身を記録に残す", () => {
		act(() => {
			create(<ExternalEmbedPlayer embed={EMBED} isActive />);
		});

		const detail = "load_complete ready=complete nodes=5 script=0 res=0 st=200 bytes=0 enc=0 chars=0";
		post({ src: "nb-embed-autoplay", kind: "blank", detail });

		const retry = mockLogFrontendEvent.mock.calls
			.map((call) => call[0])
			.find((event) => event.event_name === "external_embed_load_retry");
		expect(retry).toBeDefined();
		expect(retry.payload.reason).toBe("blank_document");
		expect(retry.payload.detail).toBe(detail);
	});

	/*
	#1641 ただし **無制限に読み直さない**。向こうが返さない状態が続くなら、
	畳んでサムネイルを見せ «◯◯ で見る» を出す（ユーザーに次の手を渡す）。
	それでも «その投稿が再生できない» とは報告しない。
	*/
	it("読み直しの上限を超えたら畳む。それでもサーバへは報告しない", () => {
		const onUnplayable = jest.fn();
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<ExternalEmbedPlayer embed={EMBED} isActive onUnplayable={onUnplayable} />);
		});

		// 上限（2 回）を超える 3 回目で畳む
		for (let i = 0; i < 3; i++) {
			post({ src: "nb-embed-autoplay", kind: "blank", detail: "load_complete script=0" });
		}

		expect(tree.root.findAllByProps({ testID: "external-embed-collapsed" }).length).toBeGreaterThan(0);
		expect(fallbackCount(tree)).toBeGreaterThan(0);
		expect(onUnplayable).not.toHaveBeenCalled();
	});

	/*
	#1641 オーナー実機報告（2026-08-30）「フィードを上下すると起動しないときがある」の一部。

	前面から外れると WebView はアンマウントされ、次に来たときは **まっさらな WebView が
	読み込みをやり直す**。なのに読み直しの残数（`reloadsRef`）や «絵が載ったか»
	（`webViewReadyToShow`）を持ち越していたため、**同じセルへ戻ると 2 回目以降だけ
	様子が違う**という再現しにくい形になっていた。

	フィードは上下に何度も往復するので、ここは «毎回まっさら» でなければならない。
	*/
	it("前面から外れて戻ったら、読み直しの残数も «絵が載ったか» もまっさらに戻る", () => {
		const onUnplayable = jest.fn();
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<ExternalEmbedPlayer embed={EMBED} isActive onUnplayable={onUnplayable} />);
		});

		// 1 回目の滞在で読み直しを使い切り、畳むところまで行く
		for (let i = 0; i < 3; i++) {
			post({ src: "nb-embed-autoplay", kind: "blank", detail: "load_complete script=0" });
		}
		expect(tree.root.findAllByProps({ testID: "external-embed-collapsed" }).length).toBeGreaterThan(0);

		// セルが前面から外れる → 戻る
		act(() => {
			tree.update(<ExternalEmbedPlayer embed={EMBED} isActive={false} onUnplayable={onUnplayable} />);
		});
		act(() => {
			tree.update(<ExternalEmbedPlayer embed={EMBED} isActive onUnplayable={onUnplayable} />);
		});

		// 畳んだ跡が残っていない（前回の失敗理由で畳み続けない）
		expect(tree.root.findAllByProps({ testID: "external-embed-collapsed" }).length).toBe(0);
		// 中身が空の WebView をいきなり不透明で載せない（＝下のサムネイルを隠さない）
		expect(tree.root.findAllByProps({ testID: "external-embed-loading" }).length).toBeGreaterThan(0);

		// 読み直しの残数も戻っている：1 回 blank が来ただけでは畳まない
		post({ src: "nb-embed-autoplay", kind: "blank", detail: "load_complete script=0" });
		expect(tree.root.findAllByProps({ testID: "external-embed-collapsed" }).length).toBe(0);
		expect(onUnplayable).not.toHaveBeenCalled();
	});

	/*
	#1641 オーナー報告「フィードを上下すると TikTok / YouTube が起動しないときがある」。

	⚠️ **この症状は、いまの計装では 1 行も残らない。** 再生（autoplay_started）も
	縮退（unplayable）も起きていないのが症状そのもので、«沈黙» はログに出ないからである。
	«前面に居るのに、まだ何も起きていない» を 1 回だけ記録して、初めて数えられる量にする。

	ここが落ちたら «起動しない» を観測する手段がまた無くなる（＝オーナーが踏むまで
	誰も気づけない状態に戻る）。
	*/
	it("前面に居るのに何も起きないまま時間が過ぎたら、そのことを記録する", () => {
		jest.useFakeTimers();
		try {
			renderActiveCell();
			mockLogFrontendEvent.mockClear();

			// まだ «読み込み中» の範囲では警告にしない（正常な数秒を埋もれさせないため）
			act(() => {
				jest.advanceTimersByTime(5_000);
			});
			expect(mockLogFrontendEvent).not.toHaveBeenCalledWith(
				expect.objectContaining({ event_name: "external_embed_slow_start" }),
			);

			act(() => {
				jest.advanceTimersByTime(5_000);
			});
			const call = mockLogFrontendEvent.mock.calls
				.map((c) => c[0])
				.find((p) => p.event_name === "external_embed_slow_start");
			expect(call).toBeDefined();
			expect(call.payload).toEqual(expect.objectContaining({ provider: "instagram", visit: 1, mode: "document" }));
		} finally {
			jest.useRealTimers();
		}
	});

	/*
	#1641 ⚠️ **document モード（Instagram / TikTok）の締め切りを短くしないこと。**

	同じ形の不具合を YouTube 側で既に踏んで直している。どちらも **CI の高速回線**での実測:

	| 側 | 締め切り | 実測 | 結果 |
	| --- | --- | --- | --- |
	| YouTube | 10 秒 | 11048ms | **掛かって no_video へ縮退した** |
	| TikTok | 12 秒 | 6089ms | 通ったが **予算の半分を使っている** |

	オーナーの端末は 4G なので掛かる余地は十分にある。掛かると «TikTok で見る» の帯へ
	落ちるので、ユーザーからは «起動しない» に見える。

	待つ代償はこの値を決めた当時より下がっている（待っている間はアプリ側のサムネイルが
	見える）。ここを 12 秒台へ戻すと、遅い回線で «起動しない» が増える。
	*/
	it("document モードの締め切りは 20 秒以上（12 秒では遅い回線に足りない）", () => {
		renderActiveCell();
		const script: string = webViewProps.injectedJavaScript;

		const deadline = script.match(/var DEADLINE_MS = (\d+)/);
		expect(deadline).not.toBeNull();
		expect(Number(deadline![1])).toBeGreaterThanOrEqual(20000);

		const loadingGrace = script.match(/var LOADING_GRACE_MS = (\d+)/);
		expect(loadingGrace).not.toBeNull();
		expect(Number(loadingGrace![1])).toBeGreaterThanOrEqual(20000);
	});

	it("時間切れ（ページが組み上がらない）のときは document モードでも畳む", () => {
		const tree = renderActiveCell();
		post({ src: "nb-embed-autoplay", kind: "timeout", detail: "still_loading" });
		expect(tree.root.findAllByProps({ testID: "external-embed-collapsed" }).length).toBeGreaterThan(0);
		// 黒い板をどけて、アプリが持っているサムネイルを見せる
		expect(tree.root.findAllByProps({ testID: "external-embed-webview" }).length).toBe(0);
		expect(fallbackCount(tree)).toBeGreaterThan(0);
	});

	/*
	#1641 **無音で再生中のときだけ «音を出す» を出す。**（オーナー指示 2026-08-28）

	自動では戻せなかったので、ユーザー操作で撃ち直す口を用意する。
	⚠️ 音が出ている（audible）ときに出すと «押しても何も起きないボタン» になる。
	*/
	it("無音で再生中のときだけ «音を出す» を出す", () => {
		const tree = renderActiveCell();
		const count = () => tree.root.findAllByProps({ testID: "external-embed-unmute" }).length;

		// まだ何も報告が無い間は出さない
		expect(count()).toBe(0);

		post({ src: "nb-embed-autoplay", kind: "playing", detail: "muted" });
		expect(count()).toBeGreaterThan(0);

		// 音が出たら消える
		post({ src: "nb-embed-autoplay", kind: "unmute_result", detail: "audible" });
		expect(count()).toBe(0);
	});

	it("音ありで再生できているセルには «音を出す» を出さない", () => {
		const tree = renderActiveCell();
		post({ src: "nb-embed-autoplay", kind: "playing", detail: "audible" });
		expect(tree.root.findAllByProps({ testID: "external-embed-unmute" }).length).toBe(0);
	});

	it("注入スクリプトにバッククォートが混ざっていない", () => {
		/*
		⚠️ `AUTOPLAY_SCRIPT` はテンプレートリテラルなので、**コメントに ` を書くと
		そこで文字列が終わる**。実際にコメント中の `<video>` という表記で壊し、
		2 suite が `... is not a function` で落ちた。目視では気付きにくいので機械で押さえる。
		*/
		renderActiveCell();
		expect(webViewProps.injectedJavaScript).not.toContain("`");
		// #1641 document-start の観測スクリプトも同じテンプレートリテラルの罠を持つ
		expect(webViewProps.injectedJavaScriptBeforeContentLoaded).not.toContain("`");
	});

	/*
	#1641【観測】**エージェントが起動したことを «再生できない» と読み違えない。**

	`boot` / `dom` / `stall` は document-start の観測用で、結論ではない。`handleMessage` の
	最後は «知らない kind はすべて unplayable» なので、ここを素通りさせると
	**起動しただけで導線へ縮退する**（＝ 全セルが常に縮退する）。
	*/
	/*
	#1641 ⚠️ **ロード中に黒い画面を出さない。**（オーナー報告 2026-08-30
	「どの PF もロード完了してから、動画流れるまで 3 秒くらい黒い画面になる」）

	真因は **こちらが黒く塗っていたこと**。アプリは料理のサムネイルを WebView の下へ敷いて
	いるのに、上に載せた WebView の html/body を地色（黒）で塗るので下が隠れる。
	埋め込みページ側に出せる絵が無い間（TikTok は img を 1 つも持たない）そこは本当に何も無い。

	そこで «向こうに絵が載った»（`poster` / `playing`）まで WebView を透明にし、
	その間はローディングを出す。
	*/
	it("絵が載るまでは WebView を透明にし、ローディングを出す", () => {
		const tree = renderActiveCell();
		const webView = tree.root.findByProps({ testID: "external-embed-webview" });
		expect(StyleSheet.flatten(webView.props.style).opacity).toBe(0);
		expect(tree.root.findAllByProps({ testID: "external-embed-loading" }).length).toBeGreaterThan(0);
	});

	it("1 コマ目が載ったら WebView を見せ、ローディングを消す", () => {
		const tree = renderActiveCell();
		post({ src: "nb-embed-autoplay", kind: "poster", detail: null });
		const webView = tree.root.findByProps({ testID: "external-embed-webview" });
		expect(StyleSheet.flatten(webView.props.style).opacity).toBe(1);
		expect(tree.root.findAllByProps({ testID: "external-embed-loading" }).length).toBe(0);
	});

	/* poster を送らない provider（YouTube の包み）でも、再生が始まれば必ず見せる */
	it("poster が来なくても、再生が始まれば WebView を見せる", () => {
		const tree = renderActiveCell();
		post({ src: "nb-embed-autoplay", kind: "playing", detail: "audible" });
		const webView = tree.root.findByProps({ testID: "external-embed-webview" });
		expect(StyleSheet.flatten(webView.props.style).opacity).toBe(1);
	});

	it("boot / dom / stall の報告では縮退しない", () => {
		const tree = renderActiveCell();
		post({ src: "nb-embed-autoplay", kind: "boot", detail: "loading" });
		post({ src: "nb-embed-autoplay", kind: "dom", detail: "interactive" });
		// #1641 組み上がらないページの観測値。これも «結論» ではない
		post({ src: "nb-embed-autoplay", kind: "stall4000", detail: "ready=loading nodes=12 body=no" });
		expect(fallbackCount(tree)).toBe(0);
		expect(tree.root.findAllByProps({ testID: "external-embed-webview" }).length).toBeGreaterThan(0);
	});

	/*
	#1641 ⚠️ **document-start にもエージェントを渡す。ここを外すと iOS の TikTok が再生されない。**

	iOS の `injectedJavaScript` は WKUserScript の DocumentEnd で、そこまで待つと間に合わない。
	WebKit（＝ WKWebView と同じエンジン）でローカル実測した数字:

	    3.6s  <video> が現れる（readyState はまだ 'loading'）
	   10.3s  'interactive' ＝ DocumentEnd の注入はここまで来ない
	    4.7s  document-start から撃つと再生した

	⚠️ 読み込み中は `fillPoster()`（全 <img> を舐める）を止めて安い経路だけ回す。
	*/
	it("document-start にもエージェントを渡している", () => {
		renderActiveCell();
		const early = webViewProps.injectedJavaScriptBeforeContentLoaded as string;
		expect(early).toContain("__nbEmbedAutoplay");
		// 二重起動は先頭の kick ガードが吸収する（締め切りを延ばすだけになる）
		expect(early).toContain("kick");
	});

	/*
	#1641 **注入スクリプトを «文字列として» ではなく実際に走らせて確かめる。**

	`toContain("object-fit")` のような検査は、スクリプトが壊れていても通ってしまう
	（実際、全面化の対象を <video> だけにしていた頃も同じ文字列は入っていた）。
	最小の DOM を組んで動かし、**何がどう広げられたか**を見る。
	*/
	describe("注入スクリプトを実際に走らせる", () => {
		const run = (opts: {
			video?: boolean;
			images?: { w: number; h: number }[];
			readyState?: string;
			/** setInterval を手で回す回数。0 なら初回の attempt() だけ */
			ticks?: number;
			/**
			 * #1641 document-start を模す。`<body>` がこの tick まで存在しない状態から始める
			 * （0 / 未指定なら最初から存在する）。
			 */
			bodyAtTick?: number;
			/** 各 tick の直前に、そのときの `<body>` と一緒に呼ばれる。向こうの JS が書き戻す状況を作るため */
			beforeTick?: (body: { style: { setProperty: (k: string, v: string) => void } } | null) => void;
			/**
			 * #1641 ページが持つ `<video>` の数。**TikTok の埋め込みは 2 つ持つ**（実測
			 * `video=2`）ので、1 つしか無い前提のままだとループの保険が試せない。
			 */
			videoCount?: number;
		}) => {
			const styles = new Map<unknown, Record<string, string>>();
			const mk = (tag: string, extra: Record<string, unknown> = {}) => {
				const el: Record<string, unknown> = {
					tagName: tag.toUpperCase(),
					isConnected: true,
					__nbBound: false,
					addEventListener: jest.fn(),
					setAttribute: jest.fn(),
					style: {
						setProperty: (k: string, v: string) => {
							const own = styles.get(el) ?? {};
							own[k] = v;
							styles.set(el, own);
						},
						cssText: "",
					},
					...extra,
				};
				return el;
			};

			const images = (opts.images ?? []).map((i) =>
				mk("img", { complete: true, naturalWidth: i.w, naturalHeight: i.h }),
			);
			const videos = opts.video
				? Array.from({ length: opts.videoCount ?? 1 }, () =>
						mk("video", { paused: true, currentTime: 0, play: () => Promise.resolve() }),
					)
				: [];
			const video = videos[0] ?? null;
			const appended: unknown[] = [];
			const styleRecorder = () => {
				const own: Record<string, string> = {};
				return Object.assign(own, {
					setProperty: (k: string, v: string) => {
						own[k] = v;
					},
					removeProperty: (k: string) => {
						delete own[k];
					},
				});
			};
			const realBody = { appendChild: (el: unknown) => appended.push(el), style: styleRecorder(), children: [] };
			const documentStub: {
				readyState: string;
				documentElement: { style: ReturnType<typeof styleRecorder> };
				body: typeof realBody | null;
				createElement: (tag: string) => Record<string, unknown>;
				querySelector: (sel: string) => unknown;
				querySelectorAll: (sel: string) => unknown[];
			} = {
				readyState: opts.readyState ?? "loading",
				documentElement: { style: styleRecorder() },
				body: opts.bodyAtTick ? null : realBody,
				createElement: (tag: string) => mk(tag),
				querySelector: (sel: string) => (sel === "video" ? video : null),
				querySelectorAll: (sel: string) => (sel === "img" ? images : sel === "video" ? videos : []),
			};
			const post = jest.fn();
			const windowStub: Record<string, unknown> = { ReactNativeWebView: { postMessage: post } };

			/*
			`setInterval` は本物を使えない（jest のタイマーを進めても、この Function の中の
			クロージャは同期的にしか動かせない）。**登録されたコールバックを手で回す**。
			`ticks` を大きくしても «時間» は進まないので、締め切り（12 秒）には掛からない
			＝ 早期判定だけを見ていることになる。
			*/
			const scheduled: (() => void)[] = [];
			// 1 tick = 500ms 進む時計。締め切り（12 秒）には届かないので、早期判定だけを見ている
			let clock = 1_000_000;
			const DateStub = { now: () => clock };
			// eslint-disable-next-line no-new-func
			new Function(
				"window",
				"document",
				"MutationObserver",
				"setInterval",
				"clearInterval",
				"Date",
				webViewProps.injectedJavaScript,
			)(
				windowStub,
				documentStub,
				class {
					observe() {}
					disconnect() {}
				},
				(fn: () => void) => {
					scheduled.push(fn);
					return scheduled.length;
				},
				() => {},
				DateStub,
			);
			for (let i = 0; i < (opts.ticks ?? 0); i++) {
				clock += 500;
				if (opts.bodyAtTick && i + 1 >= opts.bodyAtTick) documentStub.body = realBody;
				opts.beforeTick?.(documentStub.body);
				scheduled.forEach((fn) => fn());
			}
			return { styles, images, video, videos, appended, post, documentStub, realBody };
		};

		it("<video> が来る前でも、リールの 1 コマ目（一番大きい画像）をセル全面へ広げる", () => {
			// 実測（Chrome 152）: 1 コマ目の <img> は t=500ms、<video> が動くのは t=1750ms。
			// この差を埋めないとセルは 2 秒ちかく真っ黒になる
			const { styles, images } = run({
				video: false,
				images: [
					{ w: 150, h: 150 },
					{ w: 360, h: 639 },
				],
			});

			const poster = styles.get(images[1]);
			expect(poster).toMatchObject({ position: "fixed", height: "100vh", "object-fit": "contain" });
			// プロフィール写真（150x150）を全面に出さない
			expect(styles.get(images[0])).toBeUndefined();
		});

		/*
		⚠️ **地色は «重ねた div» ではなく html / body の背景色で敷く。**

		当初は黒い div を body へ足していたが、**TikTok で映像を覆い隠した**
		（report は playing、currentTime も進んでいるのに画面は真っ黒）。
		祖先に transform があると position:fixed の基準と z-index の比較がその部分木に閉じるため、
		body 直下の div のほうが前に出てしまう。重なりの勝負は provider の DOM 次第で
		勝ったり負けたりするので、そもそも勝負しない形にした。
		*/
		it("地色は html / body の背景色で敷く（div を重ねない）", () => {
			const { documentStub, appended } = run({ video: false, images: [] });
			expect(documentStub.documentElement.style.background).toBe("#000000");
			// 重ねる要素は足さない
			expect(appended).toHaveLength(0);
		});

		/*
		#1641 ⚠️ **地色は «一度塗ったら終わり» にしてはいけない。**

		エージェントを document-start から走らせるようにしたので（iOS の TikTok）、
		初回の tick には `<body>` がまだ無い。WebKit での実測:

		    0.6s  エージェント起動。まだ <body> が無い
		    1.0s  <body> が現れる … 埋め込みページ自身の **白**
		    3.5s  isolate() が祖先を透明にして、ようやく白が消える

		済み印を立てる方式だと «アプリの黒 → 白 → 映像» の明滅が残る。**毎 tick 塗り直す。**
		*/
		it("body が後から現れても、向こうに塗り替えられても、地色を敷き直す", () => {
			const { documentStub, realBody } = run({ video: false, images: [], bodyAtTick: 2, ticks: 3 });
			// html は body より先に塗れている
			expect(documentStub.documentElement.style.background).toBe("#000000");
			// body が現れた tick で塗れている
			expect(realBody.style.background).toBe("#000000");
		});

		it("埋め込みページ側に地色を白へ書き戻されても、次の tick で戻す", () => {
			const { realBody } = run({
				video: false,
				images: [],
				ticks: 3,
				// 向こうの JS が毎 tick 白へ戻してくる状況
				beforeTick: (body) => body?.style.setProperty("background", "#ffffff"),
			});
			expect(realBody.style.background).toBe("#000000");
		});

		it("投稿された映像を切り取らない・引き延ばさない", () => {
			/*
			オーナー指摘 2026-08-27:「全画面表示というのはクロップじゃないですよ？
			引き延ばしは除外で判断したはずです」。

			リール（9:16）とセル（9:19.5 前後）は縦横比が違う。`cover` は左右を約 18% 切り、
			`fill` は縦横比を壊す。**どちらも投稿された映像を勝手に変える**ので使わない。
			見た目の «全画面» を追ってここが cover へ戻るのを、この検査で止める。
			*/
			const { styles, video } = run({ video: true, images: [] });
			const fit = styles.get(video!)!["object-fit"];
			expect(fit).toBe("contain");
			expect(["cover", "fill", "none", "scale-down"]).not.toContain(fit);
		});

		/*
		#1641 `boot` / `dom` / `stall` は観測用の報告で、結論ではない。ここでは**結論だけ**を見る。
		（エージェントは起動時に必ず `boot` を送り、組み上がらない間は `stall` を送る）
		*/
		const conclusions = (post: jest.Mock) =>
			post.mock.calls
				.map((call) => JSON.parse(call[0] as string) as { kind: string; detail: string | null })
				.filter(
					(message) =>
						message.kind !== "boot" &&
						message.kind !== "dom" &&
						message.kind !== "poster" &&
						!message.kind.startsWith("stall"),
				);

		/*
		#1641 オーナー報告（実機 2026-08-30）「インスタ以外ループしない」の TikTok 側。

		実測（端末 / tiktok の stall4000）: `nodes=223 script=21 video=2`。
		**TikTok の埋め込みは `<video>` を 2 つ持つ。** それまでは
		`document.querySelector('video')`（＝ 1 つ目）にしか loop と ended を
		仕掛けていなかったので、向こうが 2 つ目を鳴らしていると保険が 1 つも効かない。
		*/
		it("ページの <video> が複数あっても、全部にループを仕掛ける（TikTok は 2 つ持つ）", () => {
			const { videos } = run({ video: true, images: [], videoCount: 2, ticks: 2 });
			expect(videos).toHaveLength(2);
			for (const v of videos) {
				expect(v.loop).toBe(true);
				expect(v.setAttribute).toHaveBeenCalledWith("loop", "");
				// 向こうの JS に loop を潰されたときの保険。畳んだ後でも起こし直す
				const bound = (v.addEventListener as jest.Mock).mock.calls.map((c) => c[0]);
				expect(bound).toContain("ended");
			}
		});

		/*
		#1641 オーナー報告（実機 2026-08-30）「TikTok だけたまにロードに失敗する」。

		失敗した回は毎回まったく同じ形だった:

		    失敗 ready=complete nodes=5   script=0  video=0 img=0 res=0
		    成功 ready=interactive nodes=223 script=21 video=2 img=0 res=9

		**1 バイトも取れていない空の文書**であって «この投稿は再生できない» ではない。
		ここを `no_video`（＝ 権利ブロック）と同じ扱いにすると、通信が転んだだけの投稿を
		サーバへ «再生できない» と報告してしまう。
		*/
		it("空の文書（1 バイトも来なかった）は権利ブロックと呼ばず、読み直せる形で返す", () => {
			const { post } = run({ video: false, images: [], readyState: "complete", ticks: 16 });
			const verdict = conclusions(post)[0];
			expect(verdict.kind).toBe("blank");
			expect(verdict.detail).toMatch(/script=0/);
		});

		it("読み込みが終わっても <video> が無いままなら、締め切りを待たず権利ブロックと判定する", () => {
			// 実測: 権利ブロックされた投稿は <video> が最後まで作られない（1 コマ目の画像だけ在る）。
			// 12 秒待たせても結論は変わらないので、«Instagram で見る» を早く出す
			// clock は 1 tick = 500ms。猶予 6 秒を超えるまで回す
			const { post } = run({ video: false, images: [{ w: 360, h: 638 }], readyState: "complete", ticks: 16 });
			const verdict = conclusions(post)[0];
			expect(verdict.kind).toBe("no_video");
			// 諦めた瞬間の DOM も載せる（次に誤判定したとき中身が分かるように）
			expect(verdict.detail).toMatch(/^load_complete /);
		});

		/*
		#1641 ⚠️ **«読み込み完了なのに映像が無い» を急いで結論しない。**

		実機の iOS で TikTok が 5 回中 2 回だけ no_video になった（BigQuery 実測）。
		同じ投稿が直前・直後に再生できているので**誤判定**である。真因は待ち時間が短すぎたこと:
		TikTok の <video> は **ページの JS が後から作る**ので、'complete' の 2 秒後にはまだ無い
		ことがある（再生できた回は 4 秒時点で video=2 だった）。

		⚠️ 短くし直すとこの誤判定が戻る。«本当に映像が無い投稿» は取り込みのときにサーバが
		   判定済みで、そのセルは WebView を 1 つも作らない（高速パス）。急ぐ理由はもう無い。
		*/
		it("読み込み完了から数秒のうちは、まだ権利ブロックと決めつけない", () => {
			// 6 tick = 3 秒。旧実装（猶予 2 秒）はここで no_video を出していた
			const { post } = run({ video: false, images: [{ w: 360, h: 638 }], readyState: "complete", ticks: 6 });
			expect(conclusions(post)).toHaveLength(0);
		});

		/*
		⚠️ #1641 **読み込みが終わっていない間は締め切りを数えない。**
		   数えると «読み込みが遅いだけ» を «映像が無い（権利ブロック）» と取り違える。
		   iOS の TikTok は readyState が 'loading' のまま 18 秒動かなかった（実測）。
		*/
		it("読み込み中はまだ権利ブロックと決めつけない", () => {
			const { post } = run({ video: false, images: [], readyState: "loading", ticks: 12 });
			expect(conclusions(post)).toHaveLength(0);
			// 起動したこと自体は知らせる（«一度も走っていない» と区別するため）
			expect(post.mock.calls.map((c) => JSON.parse(c[0] as string).kind)).toContain("boot");
		});

		/*
		#1641 **ただし無制限には待たない。**

		iOS の TikTok は readyState が 'loading' のまま 18 秒動かなかった。締め切りを
		数えないだけだと、そのセルは**黒いまま放置**される。猶予（15 秒）を過ぎたら
		«時間切れ» として畳み、サムネイル＋導線を見せる。
		*/
		it("読み込みが終わらないページは、猶予を過ぎたら時間切れとして畳む", () => {
			// clock は 1 tick = 500ms。40 tick = 20 秒で猶予 15 秒を超える
			const { post } = run({ video: false, images: [], readyState: "loading", ticks: 40 });
			const verdict = conclusions(post)[0];
			expect(verdict.kind).toBe("timeout");
			/*
			#1641 **諦めた瞬間の DOM も一緒に送る。** 4 秒時点の観測と比べれば
			«伸びているのに遅いだけ» なのか «そもそも動いていない» のかが分かる
			（iOS の TikTok は 4 秒時点で body すら無かった）。
			*/
			expect(verdict.detail).toMatch(/^still_loading /);
			expect(verdict.detail).toContain("body=");
		});

		it("<video> は 1 コマ目より前面へ出す（映像が出たらそちらが見える）", () => {
			const { styles, images, video } = run({ video: true, images: [{ w: 360, h: 639 }] });
			const zVideo = Number(styles.get(video!)!["z-index"]);
			const zPoster = Number(styles.get(images[0])!["z-index"]);
			expect(zVideo).toBeGreaterThan(zPoster);
		});
	});

	it("読み込み中も、再生できているセルにも «Instagram で見る» を重ねない", () => {
		const tree = renderActiveCell();
		expect(fallbackCount(tree)).toBe(0); // まだ何の報告も無い（読み込み中）
		post({ src: "nb-embed-autoplay", kind: "playing", detail: "muted" });
		expect(fallbackCount(tree)).toBe(0);
	});

	it("<video> が無い投稿（権利ブロック）だけ «Instagram で見る» へ縮退する", () => {
		const tree = renderActiveCell();
		post({ src: "nb-embed-autoplay", kind: "no_video", detail: null });
		expect(fallbackCount(tree)).toBeGreaterThan(0);
		expect(tree.root.findAllByProps({ testID: "external-embed-open-browser" }).length).toBeGreaterThan(0);
	});

	it("デコーダが無い（not_supported）ときも縮退する", () => {
		const tree = renderActiveCell();
		post({ src: "nb-embed-autoplay", kind: "not_supported", detail: "(empty)" });
		expect(fallbackCount(tree)).toBeGreaterThan(0);
	});

	it("埋め込みページが勝手に送ってくる postMessage は無視する", () => {
		const tree = renderActiveCell();
		post({ some: "instagram internal" });
		act(() => {
			webViewProps.onMessage({ nativeEvent: { data: "not json at all" } });
		});
		// 縮退していない = 他人のメッセージで «再生できない» と誤判定していない
		expect(fallbackCount(tree)).toBe(0);
	});
});
