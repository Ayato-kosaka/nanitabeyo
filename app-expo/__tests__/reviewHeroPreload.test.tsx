import React, { act } from "react";
import TestRenderer from "react-test-renderer";

/**
 * #1087 候補3 の振る舞いテスト: **ヒーロー画像の先読みが「非ゼロかつ表示サイズ」で描画される**。
 *
 * expo-image(Android) の ExpoImageViewWrapper は View が 0×0 のときロード要求を投げない。
 * また Glide はデコード要求サイズをメモリキャッシュキーに含めるため、先読みと表示で
 * ジオメトリがズレると（1×1 で先読みする等）別エントリになりデコードし直しになる。
 *
 * ここで固定するのは次の 3 点。
 *   1. サイズ未確定（0）では描画しない ＝ 0×0 のビューを作らない
 *   2. サイズ確定後は「レビュータブのルートと同じ矩形 + 同じ flex 配分」を再現する
 *   3. 見た目・タッチ・支援技術に出ない（opacity:0 / position:absolute / pointerEvents / aria-hidden）
 */

// expo-image は native モジュールを引くので、props を観測できる素の host 要素に差し替える
jest.mock("expo-image", () => ({
	Image: (props: Record<string, unknown>) => require("react").createElement("ExpoImage", props),
}));

import { ReviewHeroPreload } from "@/features/review/components/ReviewHeroPreload";
import { REVIEW_HERO_IMAGE, REVIEW_HERO_CONTENT_FIT, REVIEW_HERO_FLEX } from "@/features/review/heroLayout";

const ROOT_WIDTH = 393;
const ROOT_HEIGHT = 800;
const INSET_TOP = 24;
const INSET_BOTTOM = 16;

const render = (overrides: Partial<React.ComponentProps<typeof ReviewHeroPreload>> = {}) => {
	let renderer: TestRenderer.ReactTestRenderer;
	act(() => {
		renderer = TestRenderer.create(
			<ReviewHeroPreload
				width={ROOT_WIDTH}
				height={ROOT_HEIGHT}
				offsetTop={-INSET_TOP}
				insetTop={INSET_TOP}
				insetBottom={INSET_BOTTOM}
				{...overrides}
			/>,
		);
	});
	return renderer!;
};

/** RN の style は配列になりうるので、フラットにして 1 つのオブジェクトへ潰す */
const flattenStyle = (style: unknown): Record<string, unknown> =>
	Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

const findRoot = (renderer: TestRenderer.ReactTestRenderer) =>
	renderer.root.findAll((node) => node.props?.testID === "review-hero-preload")[0];

describe("ReviewHeroPreload", () => {
	it("サイズが未確定のうちは何も描画しない（0×0 のビューを作らない）", () => {
		expect(render({ width: 0, height: 0 }).toJSON()).toBeNull();
		expect(render({ width: ROOT_WIDTH, height: 0 }).toJSON()).toBeNull();
		expect(render({ width: 0, height: ROOT_HEIGHT }).toJSON()).toBeNull();
	});

	it("レビュータブのルートと同じ矩形・同じ padding を再現する", () => {
		const style = flattenStyle(findRoot(render()).props.style);

		expect(style.width).toBe(ROOT_WIDTH);
		expect(style.height).toBe(ROOT_HEIGHT);
		// 親（edges=["top"] の SafeAreaView）の padding を打ち消し、レビュータブと同じ絶対位置に置く
		expect(style.top).toBe(-INSET_TOP);
		expect(style.left).toBe(0);
		// レビュータブの SafeAreaView(edges=["top","bottom"]) が入れる padding と同じもの
		expect(style.paddingTop).toBe(INSET_TOP);
		expect(style.paddingBottom).toBe(INSET_BOTTOM);
	});

	it("見た目・タッチ・支援技術に出さない", () => {
		const root = findRoot(render());
		const style = flattenStyle(root.props.style);

		expect(style.opacity).toBe(0);
		// レイアウトを押し広げない
		expect(style.position).toBe("absolute");
		expect(root.props.pointerEvents).toBe("none");
		// #934 axe: image-alt 対策
		expect(root.props["aria-hidden"]).toBe(true);
	});

	it("ヒーロー画像を表示側と同じ flex 配分・同じ contentFit で描画する", () => {
		const root = findRoot(render());
		const sections = (root.props.children as React.ReactElement<{ style?: unknown }>[]).flat();
		const flexOf = (index: number) => flattenStyle(sections[index].props.style).flex;

		// review/index.tsx の titleSection / heroSection / ctaSection と同じ 1:2:1
		expect([flexOf(0), flexOf(1), flexOf(2)]).toEqual([
			REVIEW_HERO_FLEX.title,
			REVIEW_HERO_FLEX.hero,
			REVIEW_HERO_FLEX.cta,
		]);

		const image = root.findAll((node) => String(node.type) === "ExpoImage")[0];
		expect(image.props.source).toBe(REVIEW_HERO_IMAGE);
		// contentFit が食い違うと、キーは一致しても解像度の違うビットマップを掴んでしまう
		expect(image.props.contentFit).toBe(REVIEW_HERO_CONTENT_FIT);
		// 親（flex:1, width:"100%"）いっぱいに広げることで実表示サイズと一致させる
		expect(flattenStyle(image.props.style)).toMatchObject({ width: "100%", height: "100%" });
	});
});
