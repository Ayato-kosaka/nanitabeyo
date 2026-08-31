/*
#1641 **«2 つ同時に鳴った» をアプリ側の記録に残す。**

2026-08-31 の run 33408324285 で、Detox は `external-embed-playing-*` の印を 2 枚見て赤にしたのに、
BigQuery へ届いた `external_embed_autoplay_started` は 1 件だけだった（ログはバッチ送信で、
アプリが落とされた側の 1 件が飛んだ）。**同時に鳴った事実が、アプリの記録には 1 行も無かった。**

ここで固定するのは «印が 2 枚出る条件» と «記録が出る条件» が同じであること。
ずれると、また «Detox は赤なのにログは何も言わない» に戻る。
*/
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { UIManager } from "react-native";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(() => Promise.resolve({ type: "dismiss" })) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("lucide-react-native", () => ({ Play: () => null, Volume2: () => null }));
jest.mock("react-native-gesture-handler", () => ({
	GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * WebView は複数同時に立つので、**インスタンスごとに** props を覚える。
 * 1 つの変数へ上書きすると、後から描かれた方にしか postMessage できず
 * «2 つ同時» を作れない（このテストの目的そのものが再現できなくなる）。
 */
const mockWebViewPropsByKey = new Map<string, Record<string, any>>();
jest.mock("react-native-webview", () => ({
	WebView: (props: Record<string, any>) => {
		const uri: string = props.source?.uri ?? props.source?.baseUrl ?? "";
		const html: string = props.source?.html ?? "";
		const key = `${uri}${html}`;
		mockWebViewPropsByKey.set(key, props);
		return null;
	},
}));

import { ExternalEmbedPlayer } from "./ExternalEmbedPlayer";

const embedFor = (externalContentId: string) => ({
	provider: "instagram" as const,
	externalContentId,
	canonicalUrl: `https://www.instagram.com/reel/${externalContentId}/`,
	embedStatus: "available" as const,
	playbackStatus: "unknown" as const,
});

const FIRST = embedFor("CDg3owdFa6W");
const SECOND = embedFor("DZFdePPzzLI");

beforeAll(() => {
	jest.spyOn(UIManager as any, "hasViewManagerConfig").mockReturnValue(true);
});

beforeEach(() => {
	mockWebViewPropsByKey.clear();
	mockLogFrontendEvent.mockClear();
});

/** そのセルの WebView へ «鳴りだした» を届ける */
const reportPlaying = (externalContentId: string) => {
	const entry = Array.from(mockWebViewPropsByKey.entries()).find(([key]) => key.includes(externalContentId));
	if (!entry) throw new Error(`WebView が見つかりません: ${externalContentId}`);
	act(() => {
		entry[1].onMessage({
			nativeEvent: { data: JSON.stringify({ src: "nb-embed-autoplay", kind: "playing", detail: "audible" }) },
		});
	});
};

const concurrentLogs = () =>
	mockLogFrontendEvent.mock.calls
		.map(([arg]) => arg)
		.filter((arg) => arg?.event_name === "external_embed_concurrent_playing");

describe("ExternalEmbedPlayer の «同時に鳴った» 記録", () => {
	let tree: ReactTestRenderer | null = null;

	afterEach(() => {
		act(() => {
			tree?.unmount();
		});
		tree = null;
	});

	it("前面のセルが 1 つだけ鳴っているうちは、何も記録しない", () => {
		act(() => {
			tree = create(
				<>
					<ExternalEmbedPlayer embed={FIRST} isActive />
					<ExternalEmbedPlayer embed={SECOND} isActive={false} />
				</>,
			);
		});

		reportPlaying(FIRST.externalContentId);

		expect(concurrentLogs()).toHaveLength(0);
	});

	it("2 つのセルが同時に鳴ったら、両方の contentId を 1 行に載せて記録する", () => {
		act(() => {
			tree = create(
				<>
					<ExternalEmbedPlayer embed={FIRST} isActive />
					<ExternalEmbedPlayer embed={SECOND} isActive />
				</>,
			);
		});

		reportPlaying(FIRST.externalContentId);
		expect(concurrentLogs()).toHaveLength(0);

		reportPlaying(SECOND.externalContentId);

		const logs = concurrentLogs();
		expect(logs).toHaveLength(1);
		expect(logs[0].payload.count).toBe(2);
		expect(logs[0].payload.cells.map((cell: { contentId: string }) => cell.contentId)).toEqual([
			FIRST.externalContentId,
			SECOND.externalContentId,
		]);
		// 後から鳴り出した側が報告する（先に鳴っていた方が «止まらなかった側»）
		expect(logs[0].payload.reporter).toBe(SECOND.externalContentId);
		/*
		⚠️ **溜めずにすぐ送ること。** 同時再生が起きているとき Detox は数秒後にアプリごと止める。
		既定のバッチを待つと、いちばん欲しいこの行が毎回そこで消える
		（run 33408324285 / 33411032551 の 2 回とも 1 件も届かなかった）。
		*/
		expect(logs[0].flushNow).toBe(true);
	});

	it("前面から外れたセルは席を空ける（次に鳴ったセルを «同時» と誤認しない）", () => {
		act(() => {
			tree = create(
				<>
					<ExternalEmbedPlayer embed={FIRST} isActive />
					<ExternalEmbedPlayer embed={SECOND} isActive={false} />
				</>,
			);
		});
		reportPlaying(FIRST.externalContentId);

		// 1 枚目が前面から外れ、2 枚目が前面に来る（＝ 正しくページを送ったとき）
		act(() => {
			tree!.update(
				<>
					<ExternalEmbedPlayer embed={FIRST} isActive={false} />
					<ExternalEmbedPlayer embed={SECOND} isActive />
				</>,
			);
		});
		reportPlaying(SECOND.externalContentId);

		expect(concurrentLogs()).toHaveLength(0);
	});
});
