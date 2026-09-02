/*
#1415 【設計】カード押下で «キーボードだけ» 閉じることを固定する。

## なぜ必要か
投票完了の入力（名前・コメント）は `onRequestClose` を渡さない ＝ 閉じる導線が無い。
カードが画面のほぼ全面を占めるので背景を押す余地もほとんど無く、キーボードを
引っ込める手段が «送信を押す» しか無かった。

⚠️ 実装が `Pressable` の `onPress`（タップ終了）であることが本質である。
`onStartShouldSetResponder`（タップ開始）でやると #528 を踏む:
  候補タップ開始 → 親が Keyboard.dismiss() → キーボード高の変化でレイアウト再計算
  → 候補リストが畳まれて unmount → 子の onPress がキャンセル
「子の押下がキャンセルされないこと」もここで固定する。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { Keyboard, Text, TouchableOpacity } from "react-native";
import {
	CONTENT_KEYBOARD_DISMISS_TEST_ID,
	DishCategoryGroupVoteInlineOverlay,
} from "./DishCategoryGroupVoteInlineOverlay";

// ⚠️ このオーバーレイは lucide の X と expo-blur を描く。どちらもネイティブ実装を引くので
// スタブへ落とす（DishCategoryGroupVoteResultScreen.test.tsx と同じ形）
jest.mock(
	"lucide-react-native",
	() =>
		new Proxy(
			{},
			{
				get: (_target, prop) =>
					prop === "__esModule"
						? true
						: function MockIcon() {
								return null;
							},
			},
		),
);
jest.mock("expo-blur", () => ({
	BlurView: function MockBlurView() {
		return null;
	},
}));
jest.mock("react-native-safe-area-context", () => {
	const { View: RNView } = require("react-native");
	return { SafeAreaView: RNView, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

/**
 * `Keyboard.addListener` は実体を差し替えず、`keyboardDidShow` を «発火させる» ための
 * ハンドルだけ捕まえる。オーバーレイはキーボードの有無を ref で持っているので、
 * これを呼ばないと «出ていない» 扱いになる。
 */
function captureKeyboardListeners() {
	const handlers: Record<string, () => void> = {};
	jest.spyOn(Keyboard, "addListener").mockImplementation(((event: string, handler: () => void) => {
		handlers[event] = handler;
		return { remove: jest.fn() };
	}) as unknown as typeof Keyboard.addListener);
	return handlers;
}

function findByTestID(tree: TestRenderer.ReactTestRenderer, testID: string) {
	return tree.root.findAll((node) => node.props?.testID === testID);
}

/**
 * ⚠️ `TestRenderer.create` は `act` で包むこと。React 19 の描画は同期に確定しないので、
 * 包まないと直後の `tree.root` が «まだコミットされていない» ものを見て
 * `Can't access .root on unmounted test renderer` になる（実測）。
 */
function render(ui: React.ReactElement): TestRenderer.ReactTestRenderer {
	let tree!: TestRenderer.ReactTestRenderer;
	act(() => {
		tree = TestRenderer.create(ui);
	});
	return tree;
}

describe("#1415 DishCategoryGroupVoteInlineOverlay のキーボード", () => {
	it("dismissKeyboardOnContentPress を渡さないと包みを作らない（既定は従来どおり）", () => {
		captureKeyboardListeners();
		const tree = render(
			<DishCategoryGroupVoteInlineOverlay>
				<Text>中身</Text>
			</DishCategoryGroupVoteInlineOverlay>,
		);

		expect(findByTestID(tree, CONTENT_KEYBOARD_DISMISS_TEST_ID)).toHaveLength(0);
	});

	it("カードを押すとキーボードだけ閉じる（レイヤーは閉じない）", () => {
		const handlers = captureKeyboardListeners();
		const dismiss = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {});
		const onRequestClose = jest.fn();

		const tree = render(
			<DishCategoryGroupVoteInlineOverlay dismissKeyboardOnContentPress onRequestClose={onRequestClose}>
				<Text>中身</Text>
			</DishCategoryGroupVoteInlineOverlay>,
		);

		act(() => {
			handlers.keyboardDidShow?.();
		});
		const press = findByTestID(tree, CONTENT_KEYBOARD_DISMISS_TEST_ID)[0].props.onPress;
		act(() => {
			press();
		});

		expect(dismiss).toHaveBeenCalledTimes(1);
		// ⚠️ ここが呼ばれたら «閉じる導線が無い画面» に離脱手段が生えている
		expect(onRequestClose).not.toHaveBeenCalled();
	});

	// ⚠️ `onRequestClose` を «渡したうえで» キーボードを出さずに押すこと。
	// キーボードが出ている状態だと、閉じてしまう実装（背景と同じ `requestClose` を繋ぐ等）でも
	// «キーボードを閉じて return» の枝を通るため、閉じる誤りを検出できない（変異テストで実測）
	it("キーボードが出ていなければ、カードを押しても何も起きない", () => {
		captureKeyboardListeners();
		const dismiss = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {});
		const onRequestClose = jest.fn();

		const tree = render(
			<DishCategoryGroupVoteInlineOverlay dismissKeyboardOnContentPress onRequestClose={onRequestClose}>
				<Text>中身</Text>
			</DishCategoryGroupVoteInlineOverlay>,
		);

		const press = findByTestID(tree, CONTENT_KEYBOARD_DISMISS_TEST_ID)[0].props.onPress;
		act(() => {
			press();
		});

		expect(dismiss).not.toHaveBeenCalled();
		expect(onRequestClose).not.toHaveBeenCalled();
	});

	it("包みは子の押下を奪わない（#528 の再発防止）", () => {
		const handlers = captureKeyboardListeners();
		jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {});
		const onChildPress = jest.fn();

		const tree = render(
			<DishCategoryGroupVoteInlineOverlay dismissKeyboardOnContentPress>
				<TouchableOpacity testID="child-button" onPress={onChildPress}>
					<Text>候補</Text>
				</TouchableOpacity>
			</DishCategoryGroupVoteInlineOverlay>,
		);

		act(() => {
			handlers.keyboardDidShow?.();
		});
		const press = findByTestID(tree, "child-button")[0].props.onPress;
		act(() => {
			press();
		});

		expect(onChildPress).toHaveBeenCalledTimes(1);
	});
});
