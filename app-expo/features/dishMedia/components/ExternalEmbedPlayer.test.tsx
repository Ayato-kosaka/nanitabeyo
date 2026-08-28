/*
#1375 4 巡目: 外部埋め込み再生（ネイティブ側 = 再生ボタン → アプリ内ブラウザ）の検証。
フィード内埋め込み表示（react-native-webview）はネイティブ専用ブランチ側にある。
*/
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

const mockOpenBrowserAsync = jest.fn((_url: string) => Promise.resolve({ type: "dismiss" }));
jest.mock("expo-web-browser", () => ({
	openBrowserAsync: (url: string) => mockOpenBrowserAsync(url),
}));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("lucide-react-native", () => ({ Play: () => null, X: () => null }));
jest.mock("react-native-gesture-handler", () => ({
	GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));

import { ExternalEmbedPlayer } from "./ExternalEmbedPlayer";

const EMBED = {
	provider: "instagram" as const,
	externalContentId: "DZnIRziT70s",
	canonicalUrl: "https://www.instagram.com/reel/DZnIRziT70s/",
	embedStatus: "available" as const,
};

describe("ExternalEmbedPlayer（ネイティブ・WebView 不在ビルド）", () => {
	afterEach(() => {
		mockOpenBrowserAsync.mockClear();
	});

	it("isActive のとき再生ボタンを出し、押すと canonicalUrl をアプリ内ブラウザで開く", () => {
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<ExternalEmbedPlayer embed={EMBED} isActive />);
		});

		const button = tree.root
			.findAllByProps({ testID: "external-embed-open-browser" })
			.find((node) => typeof node.props.onPress === "function");
		expect(button).toBeDefined();

		act(() => button!.props.onPress());
		expect(mockOpenBrowserAsync).toHaveBeenCalledWith("https://www.instagram.com/reel/DZnIRziT70s/");
	});

	it("isActive でない間は何も描かない（フィードの全セルに立てない）", () => {
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<ExternalEmbedPlayer embed={EMBED} isActive={false} />);
		});
		expect(tree.toJSON()).toBeNull();
	});

	it("未知 provider でも再生ボタン（外部で開く）へ縮退する", () => {
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(
				<ExternalEmbedPlayer
					embed={{ ...EMBED, provider: "unknown" as never, canonicalUrl: "https://example.com/x" }}
					isActive
				/>,
			);
		});
		expect(tree.root.findAllByProps({ testID: "external-embed-open-browser" }).length).toBeGreaterThan(0);
	});

	it("embedStatus=unavailable は再生ボタンを出さず «利用できません» を出す（独立レビュー指摘）", () => {
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<ExternalEmbedPlayer embed={{ ...EMBED, embedStatus: "unavailable" }} isActive />);
		});
		expect(tree.root.findAllByProps({ testID: "external-embed-open-browser" }).length).toBe(0);
		expect(tree.root.findAllByProps({ testID: "external-embed-unavailable" }).length).toBeGreaterThan(0);
	});
});

/*
#1375（案 A）**フィードを送っただけでクラッシュする経路の回帰テスト。**

切り取り（案 A）で足した `useState` / `useCallback` / `useMemo` を、`isActive` 等を見る
early return より **後ろ**に置いていた。こうすると

    isActive=true  … hook を N + 3 本呼ぶ
    isActive=false … early return で N 本しか呼ばない

となり、同じセルが前面から外れた瞬間に React が
`Rendered fewer hooks than expected` を投げる。フィードは送るたびに isActive が
入れ替わるので、**取り込んだ投稿を通り過ぎるだけで落ちる**。

このテストは «同じインスタンスを active → inactive → active と切り替える» ことで
それを踏む。hook を early return より前に戻した現在は通る。
*/
describe("#1375 hook の本数が描画のたびに変わらない", () => {
	it("同じセルを active → inactive → active と切り替えても落ちない", () => {
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(<ExternalEmbedPlayer embed={EMBED} isActive />);
		});
		expect(() => {
			act(() => tree.update(<ExternalEmbedPlayer embed={EMBED} isActive={false} />));
			act(() => tree.update(<ExternalEmbedPlayer embed={EMBED} isActive />));
		}).not.toThrow();
		expect(tree.root.findAllByProps({ testID: "external-embed-open-browser" }).length).toBeGreaterThan(0);
	});
});

