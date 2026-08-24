/**
 * #1212 候補カルーセルの横余白撤去を固定するテスト。
 *
 * useDishCategoryCardSize({ fullBleed: true }) は dishCategories.tsx の Carousel だけが使う値で、
 * Carousel の style.width にそのまま渡され「カード幅」と「スナップ間隔(size)」の
 * 両方を兼ねる(node_modules/react-native-reanimated-carousel の useCommonVariables /
 * CarouselLayout.tsx 参照)。fullBleed 未指定(既定)の呼び出し元(例:
 * DishCategoryGroupVoteVoteCard)は従来どおり左右16pxずつの余白を残す必要があるため、
 * 両方の値が画面幅からズレていないことをここで固定する。
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useWindowDimensions } from "react-native";
import { useDishCategoryCardSize } from "./useDishCategoryCardSize";

// Harness は null しか返さない(RNのネイティブコンポーネントを描画しない)ため、
// react-native は最小限のスタブで足りる。useContentWidth が読むのは
// useWindowDimensions と Platform.OS のみ。
jest.mock("react-native", () => ({
	Platform: { OS: "ios" },
	useWindowDimensions: jest.fn(),
}));

function Harness({
	fullBleed,
	onResult,
}: {
	fullBleed?: boolean;
	onResult: (result: { cardWidth: number; cardMaxHeight: number }) => void;
}) {
	const result = useDishCategoryCardSize(fullBleed === undefined ? undefined : { fullBleed });
	onResult(result);
	return null;
}

function renderDishCategoryCardSize(windowWidth: number, fullBleed?: boolean) {
	(useWindowDimensions as jest.Mock).mockReturnValue({ width: windowWidth, height: 800 });
	let captured: { cardWidth: number; cardMaxHeight: number } | undefined;
	act(() => {
		TestRenderer.create(<Harness fullBleed={fullBleed} onResult={(result) => (captured = result)} />);
	});
	if (!captured) throw new Error("useDishCategoryCardSize did not return a result");
	return captured;
}

describe("useDishCategoryCardSize", () => {
	it("既定(fullBleed未指定)では左右16pxずつ(計32px)の余白を残す", () => {
		const { cardWidth, cardMaxHeight } = renderDishCategoryCardSize(375);
		expect(cardWidth).toBe(375 - 32);
		// 16:9 のアスペクト比を維持する
		expect(cardMaxHeight).toBeCloseTo(((375 - 32) / 9) * 16);
	});

	it("fullBleed:true では画面幅と完全に一致する(余白ゼロ)", () => {
		const { cardWidth, cardMaxHeight } = renderDishCategoryCardSize(375, true);
		expect(cardWidth).toBe(375);
		expect(cardMaxHeight).toBeCloseTo((375 / 9) * 16);
	});
});
