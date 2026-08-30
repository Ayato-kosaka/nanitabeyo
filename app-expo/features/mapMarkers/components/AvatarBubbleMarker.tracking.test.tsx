/*
#1375（実機: 「マップの画面がすごくクラッシュする」「性能劣化が治っていない」）

**このテストが守るのは «見た目» ではなく `tracksViewChanges` の値そのもの。**

`react-native-maps` の `Marker` は children を渡すとネイティブ側でビットマップへ焼く。
`tracksViewChanges` の既定は `true` で、そのままだと Android は地図が動くあいだ中
**マーカー 1 個につき毎フレーム 1 枚**焼き直す。この地図は最大 300 ピンを置くので、
pan が重くなるだけでなくネイティブヒープを食い潰して落ちる。

⚠️ このテストが落ちたら «マップが重い / 落ちる» が再発している。
値を期待に合わせるのではなく、実装が焼き直しを止めているかを疑うこと。
理由の全文は `features/mapMarkers/hooks/useMarkerViewTracking.ts`。
*/
import React from "react";
import { act, create } from "react-test-renderer";
import { AvatarBubbleMarker } from "./AvatarBubbleMarker";
import { MARKER_TRACKING_SETTLE_MS } from "../hooks/useMarkerViewTracking";

/** 素の `Marker` が受け取った props を毎レンダー記録する */
const markerProps: Record<string, unknown>[] = [];
jest.mock("@/components/MapView", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		Marker: (props: Record<string, unknown>) => {
			markerProps.push(props);
			return ReactActual.createElement(RNView, null, props.children as React.ReactNode);
		},
	};
});

/** `onLoadEnd` を外から呼べるようにした expo-image のスタブ */
let lastOnLoadEnd: (() => void) | undefined;
jest.mock("expo-image", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		Image: (props: { onLoadEnd?: () => void }) => {
			lastOnLoadEnd = props.onLoadEnd;
			return ReactActual.createElement(RNView, null);
		},
	};
});

const latestTracks = () => markerProps[markerProps.length - 1]?.tracksViewChanges;

/** 最初に描かれた `<View>` の `onLayout`（画像なしマーカーの «出揃った» 合図） */
const firstOnLayout = (tree: ReturnType<typeof create>): (() => void) | undefined => {
	const view = tree.root.findAll((node) => typeof node.props?.onLayout === "function")[0];
	return view?.props.onLayout;
};

describe("AvatarBubbleMarker の tracksViewChanges", () => {
	beforeEach(() => {
		jest.useFakeTimers();
		markerProps.length = 0;
		lastOnLoadEnd = undefined;
	});
	afterEach(() => {
		jest.useRealTimers();
	});

	const coordinate = { latitude: 35.68, longitude: 139.76 };

	it("マウント直後は焼き直しを許す（この間に絵が決まる）", () => {
		act(() => {
			create(<AvatarBubbleMarker coordinate={coordinate} uri="https://example.com/a.jpg" />);
		});
		expect(latestTracks()).toBe(true);
	});

	it("画像の読み込みが終わってしばらくすると焼き直しを止める", () => {
		act(() => {
			create(<AvatarBubbleMarker coordinate={coordinate} uri="https://example.com/a.jpg" />);
		});
		act(() => {
			lastOnLoadEnd?.();
		});
		// 止めるのは «少し待ってから»。直後に止めると読み込み前の絵で固定されることがある
		expect(latestTracks()).toBe(true);
		act(() => {
			jest.advanceTimersByTime(MARKER_TRACKING_SETTLE_MS);
		});
		expect(latestTracks()).toBe(false);
	});

	it("画像が無いマーカーも onLayout で焼き直しを止める（読み込み完了が来ないため）", () => {
		let tree!: ReturnType<typeof create>;
		act(() => {
			tree = create(<AvatarBubbleMarker coordinate={coordinate} />);
		});
		act(() => {
			firstOnLayout(tree)?.();
			jest.advanceTimersByTime(MARKER_TRACKING_SETTLE_MS);
		});
		expect(latestTracks()).toBe(false);
	});

	it("選択状態が変わったら焼き直しを再開する（色が変わる＝絵が変わる）", () => {
		let tree!: ReturnType<typeof create>;
		act(() => {
			tree = create(<AvatarBubbleMarker coordinate={coordinate} uri="https://example.com/a.jpg" />);
		});
		act(() => {
			lastOnLoadEnd?.();
			jest.advanceTimersByTime(MARKER_TRACKING_SETTLE_MS);
		});
		expect(latestTracks()).toBe(false);

		act(() => {
			tree.update(<AvatarBubbleMarker coordinate={coordinate} uri="https://example.com/a.jpg" isActive />);
		});
		expect(latestTracks()).toBe(true);
	});

	it("地図を動かしただけ（props が同じ再レンダー）では焼き直しを再開しない", () => {
		let tree!: ReturnType<typeof create>;
		act(() => {
			tree = create(<AvatarBubbleMarker coordinate={coordinate} uri="https://example.com/a.jpg" />);
		});
		act(() => {
			lastOnLoadEnd?.();
			jest.advanceTimersByTime(MARKER_TRACKING_SETTLE_MS);
		});
		act(() => {
			tree.update(<AvatarBubbleMarker coordinate={coordinate} uri="https://example.com/a.jpg" />);
		});
		expect(latestTracks()).toBe(false);
	});
});
