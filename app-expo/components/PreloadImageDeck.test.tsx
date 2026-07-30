// #1087 【設計】先読みブロックが native でロード要求を発行できる形であることの回帰検知。
//
// 元の実装は 0×0 の View の中に style 未指定の <Image> を置いており、
// iOS(`getBestSource` が size<=0 で nil)/ Android(`cleanIfNeeded` が width==0||height==0 で return)
// のどちらでもロード要求そのものが発行されていなかった。
// web の <img> は size に関係なく fetch するため、web の Resource Timing を見る
// e2e-web/tests/search/tutorial-preload.spec.ts はこの状態でも緑になる。
// **サイズが 0 に戻る回帰を捕まえられる自動テストはこれだけ。**
import React from "react";
import { StyleSheet, View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import { Image } from "expo-image";

import { PreloadImageDeck } from "@/components/PreloadImageDeck";
import { PRELOAD_ASSET_KEYS } from "@/constants/preloadAssets";

// expo-image のネイティブビューではなく「<Image> に渡る props」を観測したいのでモックする
jest.mock("expo-image", () => ({
	Image: function MockExpoImage() {
		return null;
	},
}));

function render() {
	let renderer!: TestRenderer.ReactTestRenderer;
	// React 19 の react-test-renderer は create() が非同期に描画するため act() が必須
	act(() => {
		renderer = TestRenderer.create(<PreloadImageDeck />);
	});
	return renderer;
}

describe("PreloadImageDeck", () => {
	it("先読み対象 8 枚をすべて描画する(減らすと web の tutorial-preload.spec.ts も赤くなる)", () => {
		expect(render().root.findAllByType(Image)).toHaveLength(PRELOAD_ASSET_KEYS.length);
		expect(PRELOAD_ASSET_KEYS).toHaveLength(8);
	});

	it("各 <Image> の style が非ゼロサイズである(0 だと native がロード要求を出さない)", () => {
		const images = render().root.findAllByType(Image);
		expect(images.length).toBeGreaterThan(0);

		for (const image of images) {
			const style = StyleSheet.flatten(image.props.style) as { width?: number; height?: number } | undefined;

			expect(typeof style?.width).toBe("number");
			expect(typeof style?.height).toBe("number");
			expect(style?.width).toBeGreaterThan(0);
			expect(style?.height).toBeGreaterThan(0);
		}
	});

	it("先読みブロック自体も非ゼロサイズで、視認・タップ不能かつ #934 の aria-hidden を維持している", () => {
		const container = render().root.findByType(View);

		expect(container.props["aria-hidden"]).toBe(true);
		expect(container.props.pointerEvents).toBe("none");

		const style = StyleSheet.flatten(container.props.style) as {
			width?: number;
			height?: number;
			opacity?: number;
			position?: string;
			overflow?: string;
		};
		expect(style.width).toBeGreaterThan(0);
		expect(style.height).toBeGreaterThan(0);
		expect(style.opacity).toBe(0);
		expect(style.position).toBe("absolute");
		expect(style.overflow).toBe("hidden");
	});
});
