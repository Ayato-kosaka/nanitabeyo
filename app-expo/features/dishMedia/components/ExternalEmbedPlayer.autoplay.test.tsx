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
import { UIManager } from "react-native";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(() => Promise.resolve({ type: "dismiss" })) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("lucide-react-native", () => ({ Play: () => null }));
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

	it("注入スクリプトにバッククォートが混ざっていない", () => {
		/*
		⚠️ `AUTOPLAY_SCRIPT` はテンプレートリテラルなので、**コメントに ` を書くと
		そこで文字列が終わる**。実際にコメント中の `<video>` という表記で壊し、
		2 suite が `... is not a function` で落ちた。目視では気付きにくいので機械で押さえる。
		*/
		renderActiveCell();
		expect(webViewProps.injectedJavaScript).not.toContain("`");
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
			const video = opts.video ? mk("video", { paused: true, currentTime: 0, play: () => Promise.resolve() }) : null;
			const appended: unknown[] = [];
			const documentStub = {
				readyState: opts.readyState ?? "loading",
				documentElement: { style: {} },
				body: { appendChild: (el: unknown) => appended.push(el) },
				createElement: (tag: string) => mk(tag),
				querySelector: (sel: string) => (sel === "video" ? video : null),
				querySelectorAll: (sel: string) => (sel === "img" ? images : []),
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
				scheduled.forEach((fn) => fn());
			}
			return { styles, images, video, appended, post };
		};

		it("<video> が来る前でも、リールの 1 コマ目（一番大きい画像）をセル全面へ広げる", () => {
			// 実測（Chrome 152）: 1 コマ目の <img> は t=500ms、<video> が動くのは t=1750ms。
			// この差を埋めないとセルは 2 秒ちかく真っ黒になる
			const { styles, images } = run({ video: false, images: [{ w: 150, h: 150 }, { w: 360, h: 639 }] });

			const poster = styles.get(images[1]);
			expect(poster).toMatchObject({ position: "fixed", height: "100vh", "object-fit": "contain" });
			// プロフィール写真（150x150）を全面に出さない
			expect(styles.get(images[0])).toBeUndefined();
		});

		it("地色は <video> を待たずに敷く（埋め込みページの白が一瞬見えないように）", () => {
			const { appended } = run({ video: false, images: [] });
			expect(appended).toHaveLength(1);
			expect((appended[0] as { style: { cssText: string } }).style.cssText).toContain("background:#000");
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

		it("読み込みが終わっても <video> が無ければ、締め切りを待たず権利ブロックと判定する", () => {
			// 実測: 権利ブロックされた投稿は <video> が最後まで作られない（1 コマ目の画像だけ在る）。
			// 12 秒待たせても結論は変わらないので、«Instagram で見る» を早く出す
			const { post } = run({ video: false, images: [{ w: 360, h: 638 }], readyState: "complete", ticks: 12 });
			expect(post).toHaveBeenCalled();
			expect(JSON.parse(post.mock.calls[0][0])).toMatchObject({ kind: "no_video", detail: "load_complete" });
		});

		it("読み込み中はまだ権利ブロックと決めつけない", () => {
			const { post } = run({ video: false, images: [], readyState: "loading", ticks: 12 });
			expect(post).not.toHaveBeenCalled();
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
