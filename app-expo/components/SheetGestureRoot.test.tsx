// #1126 Android の TrueSheet 内に «RNGH のルート» が張られていること。
//
// ## 実機で踏んだ症状
// 保存店カルーセルを横へドラッグしても **まったく動かず**、指を離すと
// **1 枚目のカードの onPress が発火する**。
//
// ## 原因
// Android の TrueSheet はシートの中身を `android.R.id.content` へ付け替える
// （@lodev09/react-native-true-sheet の TrueSheetView.kt: findRootContainerView）。
// アプリの `GestureHandlerRootView` は app/_layout.tsx に 1 つだけなので、
// 付け替えられたシートはその外へ出て、**RNGH のジェスチャにイベントが届かない**。
// `Pressable` は RN のレスポンダ系なので生きており、
// 「タップは効くがドラッグは効かない」という非対称になる。
//
// ⚠️ この非対称のせいで «閾値の問題» と誤診しやすい。
// `activeOffsetX` や `snapMode` を調整しても直らないことを、ここで固定しておく。

import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Platform, Text, View } from "react-native";

// react-native-gesture-handler は jest.config.js の transformIgnorePatterns の
// 許可リストに無く、素で import すると Flow 構文で parse に失敗する。
// ここで見たいのは「Android のときだけ GestureHandlerRootView を使うか」という
// **コンポーネントの同一性**だけなので、共有の jest 設定を広げるより軽い stub で足りる。
jest.mock("react-native-gesture-handler", () => {
	const react = require("react");
	const { View: RNView } = require("react-native");
	const GestureHandlerRootView = (props: Record<string, unknown>) => react.createElement(RNView, props);
	return { GestureHandlerRootView };
});

import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SheetGestureRoot } from "./SheetGestureRoot";

const renderOn = (os: "android" | "ios") => {
	const original = Platform.OS;
	(Platform as { OS: string }).OS = os;
	let tree!: TestRenderer.ReactTestRenderer;
	try {
		act(() => {
			tree = TestRenderer.create(
				<SheetGestureRoot testID="sheet-content" style={{ flex: 1 }}>
					<Text>child</Text>
				</SheetGestureRoot>,
			);
		});
	} finally {
		(Platform as { OS: string }).OS = original;
	}
	return tree;
};

describe("#1126 シート内の RNGH ルート", () => {
	it("Android では GestureHandlerRootView を張る", () => {
		const tree = renderOn("android");

		expect(tree.root.findAllByType(GestureHandlerRootView)).toHaveLength(1);
	});

	// ⚠️ iOS はシートが RN のビュー階層に残るので不要。
	// 余計なビューを 1 枚増やすとレイアウト回帰のリスクだけが乗る
	it("iOS では素の View のまま（巻き添えにしない）", () => {
		const tree = renderOn("ios");

		expect(tree.root.findAllByType(GestureHandlerRootView)).toHaveLength(0);
		expect(tree.root.findAllByType(View).length).toBeGreaterThan(0);
	});

	// ⚠️ style を渡し忘れると flex が効かず、シートの中身の高さが潰れる
	it("style と testID をそのまま渡す（レイアウトを変えない）", () => {
		for (const os of ["android", "ios"] as const) {
			const tree = renderOn(os);
			const root = tree.root.findByProps({ testID: "sheet-content" });

			expect(root.props.style).toEqual({ flex: 1 });
		}
	});

	it("children をそのまま描画する", () => {
		expect(renderOn("android").root.findByType(Text).props.children).toBe("child");
	});
});
