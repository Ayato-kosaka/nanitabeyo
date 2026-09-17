/*
#1780【完了条件 4】**画像が無い店でも空の枠にしない。**

#1793 で Google の写真の複製をやめたので、これ以降に作られる店の `image_path` は
必ず null になる。API 側は dish_media のサムネイルを代わりに返すが、**投稿がまだ
1 件も無い店はそれでも画像が無い**（catalog 由来の約 62 万店はもともと持っていない）。

以前は各画面が `<Image source={{uri: undefined}}>` を描いており、
店詳細は 60×60 の空白、店名検索は灰色の四角、保存済み店は 100px の空白になっていた。
*/
jest.mock("lucide-react-native", () => ({
	__esModule: true,
	Store: (props: Record<string, unknown>) => {
		const React = require("react");
		const { View } = require("react-native");
		return React.createElement(View, { testID: "store-icon", ...props });
	},
}));
jest.mock("@/contexts/ThemeProvider", () => ({
	useAppTheme: () => ({ colors: { surfaceSubtle: "#F3F4F6", textSecondary: "#6B7280" } }),
}));

import React, { act } from "react";
import TestRenderer from "react-test-renderer";

import { RestaurantAvatar } from "./RestaurantAvatar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const render = (element: React.ReactElement) => {
	let tree!: TestRenderer.ReactTestRenderer;
	act(() => {
		tree = TestRenderer.create(element);
	});
	return tree;
};

describe("#1780 店のアバター", () => {
	it("uri が無ければ店アイコンの受け皿を描く", () => {
		const tree = render(<RestaurantAvatar testID="avatar" uri={undefined} accessibilityLabel="ラーメン太郎" />);

		expect(tree.root.findAllByProps({ testID: "store-icon" }).length).toBeGreaterThan(0);
		expect(tree.root.findAllByProps({ testID: "avatar-placeholder" }).length).toBeGreaterThan(0);
	});

	it("受け皿は透明のままにしない（空白の枠が «壊れている» に見えるのを避ける）", () => {
		const tree = render(<RestaurantAvatar testID="avatar" uri={null} />);

		const placeholder = tree.root.findAllByProps({ testID: "avatar-placeholder" })[0];
		const flattened = Object.assign({}, ...[placeholder.props.style].flat(Infinity).filter(Boolean));
		expect(flattened.backgroundColor).toBe("#F3F4F6");
	});

	it("uri があれば画像を描く（受け皿は出さない）", () => {
		const tree = render(<RestaurantAvatar testID="avatar" uri="https://cdn.example/a.webp" />);

		expect(tree.root.findAllByProps({ testID: "store-icon" })).toHaveLength(0);
		expect(tree.root.findAllByProps({ testID: "avatar-placeholder" })).toHaveLength(0);
		expect(tree.root.findAllByProps({ testID: "avatar" }).length).toBeGreaterThan(0);
	});

	it("呼び出し側が渡した大きさ・角丸をそのまま受け皿にも当てる", () => {
		const tree = render(
			<RestaurantAvatar testID="avatar" uri={null} style={{ width: 60, height: 60, borderRadius: 20 }} />,
		);

		const placeholder = tree.root.findAllByProps({ testID: "avatar-placeholder" })[0];
		const flattened = Object.assign({}, ...[placeholder.props.style].flat(Infinity).filter(Boolean));
		expect(flattened).toMatchObject({ width: 60, height: 60, borderRadius: 20 });
	});
});
