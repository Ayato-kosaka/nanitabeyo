/*
#843【設計】WebView が無いビルド（react-native-webview のネイティブモジュール未登録）では
アプリ内地図を諦め、呼び出し側が渡した `fallback`（従来の外部ブラウザ導線）へ縮退することを固定する。

テスト環境（jest / react-native プリセット）は RNCWebView のネイティブモジュールを
登録していないため、`UIManager.hasViewManagerConfig("RNCWebView")` は自然に false を返す
（`features/dishMedia/components/ExternalEmbedPlayer.test.tsx` と同じ前提）。
*/
import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { MapsEmbedView } from "./MapsEmbedView";

describe("MapsEmbedView（native, WebView 不在ビルド）", () => {
	it("WebView が居ないため fallback を描く（地図の WebView は描かない）", () => {
		let tree!: ReactTestRenderer;
		act(() => {
			tree = create(
				<MapsEmbedView
					url="https://api.example.com/v1/maps/embed?mode=search&q=ramen"
					testID="maps-view"
					fallback={<Text testID="external-fallback">Google マップで開く</Text>}
				/>,
			);
		});

		// host（実 View）に "maps-view" が付いていないこと（WebView 本体を描いていない）
		expect(
			tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "maps-view").length,
		).toBe(0);
		expect(tree.root.findAllByProps({ testID: "maps-view-fallback" }).length).toBeGreaterThan(0);
		expect(tree.root.findAllByProps({ testID: "external-fallback" }).length).toBeGreaterThan(0);
	});
});
