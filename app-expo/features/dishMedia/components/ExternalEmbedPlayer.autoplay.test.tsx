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
	#1641 **注入スクリプトを «文字列として» ではなく実際に走らせて確かめる。**

	`toContain("object-fit")` のような検査は、スクリプトが壊れていても通ってしまう
	（実際、全面化の対象を <video> だけにしていた頃も同じ文字列は入っていた）。
	最小の DOM を組んで動かし、**何がどう広げられたか**を見る。
	*/
	describe("注入スクリプトを実際に走らせる", () => {
		const run = (opts: { video?: boolean; images?: { w: number; h: number }[] }) => {
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
				documentElement: { style: {} },
				body: { appendChild: (el: unknown) => appended.push(el) },
				createElement: (tag: string) => mk(tag),
				querySelector: (sel: string) => (sel === "video" ? video : null),
				querySelectorAll: (sel: string) => (sel === "img" ? images : []),
			};
			const windowStub: Record<string, unknown> = {
				ReactNativeWebView: { postMessage: jest.fn() },
			};
			// eslint-disable-next-line no-new-func
			new Function(
				"window",
				"document",
				"MutationObserver",
				"setInterval",
				"clearInterval",
				webViewProps.injectedJavaScript,
			)(
				windowStub,
				documentStub,
				class {
					observe() {}
					disconnect() {}
				},
				() => 1,
				() => {},
			);
			return { styles, images, video, appended };
		};

		it("<video> が来る前でも、リールの 1 コマ目（一番大きい画像）をセル全面へ広げる", () => {
			// 実測（Chrome 152）: 1 コマ目の <img> は t=500ms、<video> が動くのは t=1750ms。
			// この差を埋めないとセルは 2 秒ちかく真っ黒になる
			const { styles, images } = run({ video: false, images: [{ w: 150, h: 150 }, { w: 360, h: 639 }] });

			const poster = styles.get(images[1]);
			expect(poster).toMatchObject({ position: "fixed", height: "100vh", "object-fit": "cover" });
			// プロフィール写真（150x150）を全面に出さない
			expect(styles.get(images[0])).toBeUndefined();
		});

		it("地色は <video> を待たずに敷く（埋め込みページの白が一瞬見えないように）", () => {
			const { appended } = run({ video: false, images: [] });
			expect(appended).toHaveLength(1);
			expect((appended[0] as { style: { cssText: string } }).style.cssText).toContain("background:#000");
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
