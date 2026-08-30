/*
#1641 **web 側の高速パス。**

`ExternalEmbedPlayer.tsx`（ネイティブ）にだけテストがあり、`.web.tsx` は 1 度も
レンダリングして確かめていなかった。ネイティブと web は**別ファイル**なので、
片方だけ直して «直った» と言える構造になっていない（実際 #1641 で
「Instagram 用の切り取り数値を全 provider に当てて YouTube の映像が切れる」を web だけで踏んだ）。

⚠️ ここでは react-native のモックのまま `.web.tsx` を直接読む。react-native-web を
   通していないのでレイアウトの検証はできないが、**iframe を作るか作らないか**は見える。
   それがこのテストの目的である。
*/
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("lucide-react-native", () => ({ Play: () => null, X: () => null, Volume2: () => null }));
jest.mock("react-native-gesture-handler", () => ({
	GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));

import { ExternalEmbedPlayer } from "./ExternalEmbedPlayer.web";

const EMBED = {
	provider: "instagram" as const,
	externalContentId: "DZFdePPzzLI",
	canonicalUrl: "https://www.instagram.com/reel/DZFdePPzzLI/",
	embedStatus: "available" as const,
	playbackStatus: "unknown" as const,
};

const render = (playbackStatus: "unknown" | "playable" | "not_playable"): ReactTestRenderer => {
	let tree!: ReactTestRenderer;
	act(() => {
		tree = create(<ExternalEmbedPlayer embed={{ ...EMBED, playbackStatus }} isActive />);
	});
	return tree;
};

const iframeCount = (tree: ReactTestRenderer) => tree.root.findAllByType("iframe" as never).length;

describe("#1641 web の高速パス", () => {
	it("not_playable なら iframe を作らない", () => {
		const tree = render("not_playable");
		expect(iframeCount(tree)).toBe(0);
		// 代わりに «Instagram で見る» の導線へ落ちている
		expect(
			tree.root.findAllByProps({ testID: "external-embed-known-not-playable-instagram" }).length,
		).toBeGreaterThan(0);
	});

	/*
	⚠️ ここが要。**TikTok は判定材料が無く常に unknown** である。
	   «playable 以外を弾く» と書いた瞬間に TikTok が 1 本も再生されなくなる。
	*/
	it("unknown なら従来どおり iframe を作る", () => {
		expect(iframeCount(render("unknown"))).toBeGreaterThan(0);
	});

	it("playable でも iframe を作る（判定は «出さない» ためだけに使う）", () => {
		expect(iframeCount(render("playable"))).toBeGreaterThan(0);
	});
});
