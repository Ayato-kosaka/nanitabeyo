/*
#1404 【設計】ScreenHeader の戻るボタンの testID を «画面ごと» に分けたことを固定する。

## なぜ必要か
#1350 でモーダルをルートへ移した結果、**push した画面と背面の画面が同時に DOM／ビュー階層へ居る**
（Stack は下の画面を unmount しない）。戻るボタンが全画面共通の `screen-header-back` だと、
その状態で id を引いたときに 2 件以上に当たる。

実際 E2E Web run 32243079269 で 4 件が
`strict mode violation: getByTestId('screen-header-back') resolved to 2 elements` で落ちた。
ネイティブ側はもっと悪く、**背面の画面の戻るを押してしまっても «押せてしまう»** ため、
落ちずに «別の画面を操作したテストが緑になる» side へ倒れる。

## 守る内容
1. `testID` を渡した画面は `${testID}-back` を持つ（タイトルの `${testID}-title` と同じ規約）
2. `testID` を渡していない画面は従来どおり `screen-header-back`（後方互換。既存画面を一斉に
   触らずに済ませるため）
3. 2 つの画面を同時に描いても、それぞれの戻るは 1 件ずつしか当たらない
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

import { ScreenHeader } from "./ScreenHeader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const render = async (element: React.ReactElement) => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(element);
	});
	return tree;
};

/** `deep: false` は「一致したノードの中はもう探さない」の意（合成と host の二重計上を防ぐ） */
const countByTestID = (tree: TestRenderer.ReactTestRenderer, testID: string): number =>
	tree.root.findAll((node) => node.props?.testID === testID, { deep: false }).length;

describe("#1404 ScreenHeader の戻るボタンの testID", () => {
	it("testID を渡すと `${testID}-back` になる", async () => {
		const tree = await render(<ScreenHeader title="t" onPressBack={jest.fn()} testID="legal-screen" />);

		expect(countByTestID(tree, "legal-screen-back")).toBe(1);
		// ⚠️ 共通 id が «併存» してもいけない。残っていると背面の画面と衝突する状態に戻る
		expect(countByTestID(tree, "screen-header-back")).toBe(0);
	});

	it("タイトルの `${testID}-title` と同じ規約になっている", async () => {
		const tree = await render(<ScreenHeader title="t" onPressBack={jest.fn()} testID="legal-screen" />);

		expect(countByTestID(tree, "legal-screen-title")).toBe(1);
	});

	// 既存画面（設定・投稿フォームなど）は testID を渡していない。そこを壊さない
	it("testID を渡さなければ従来どおり screen-header-back", async () => {
		const tree = await render(<ScreenHeader title="t" onPressBack={jest.fn()} />);

		expect(countByTestID(tree, "screen-header-back")).toBe(1);
	});

	// ⚠️ これがこの仕組みの «目的» そのもの。ルート化で 2 画面が同時に居るのが常態になった
	it("2 画面を同時に描いても、それぞれの戻るは 1 件ずつしか当たらない", async () => {
		const tree = await render(
			<>
				<ScreenHeader title="detail" onPressBack={jest.fn()} testID="restaurant-detail-screen" />
				<ScreenHeader title="bid" onPressBack={jest.fn()} testID="restaurant-bid-screen" />
			</>,
		);

		expect(countByTestID(tree, "restaurant-detail-screen-back")).toBe(1);
		expect(countByTestID(tree, "restaurant-bid-screen-back")).toBe(1);
	});

	it("押すと onPressBack が呼ばれる（id を変えても結線は保つ）", async () => {
		const onPressBack = jest.fn();
		const tree = await render(<ScreenHeader title="t" onPressBack={onPressBack} testID="legal-screen" />);

		await act(async () => {
			await tree.root.find((node) => node.props?.testID === "legal-screen-back").props.onPress();
		});

		expect(onPressBack).toHaveBeenCalledTimes(1);
	});
});
