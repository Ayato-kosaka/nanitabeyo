/**
 * #528 BlurModal ＋ キーボード ＋ オートコンプリートのタップ競合を守るテスト。
 *
 * 背景（Issue #528）:
 * `BlurModal` の `KeyboardAvoidingView` が `onStartShouldSetResponder` で
 * 「**すべてのタップの開始時に** `Keyboard.dismiss()` する」振る舞いを持っていた。
 * そのため候補タップは
 *   タップ開始 → 親が Keyboard.dismiss() → キーボード高の変化でレイアウト再計算
 *   → 候補リストが畳まれて unmount → 子の onPress がキャンセル
 * となり、「キーボードだけ閉じて選択が反応しない」状態になっていた
 * （初回起動でだけ再現するのはレイアウトタイミングの揺らぎによるもので、原因は同じ）。
 *
 * 実機のタッチ順序は jest では再現できないので、代わりに責務分離の構造を固定する:
 *   1. モーダルの中身の **祖先** が子のタップに触るレスポンダを持たないこと
 *   2. キーボードを閉じる責務は背景タップ（バックドロップ）だけが持つこと
 * 1 は修正前の実装で赤くなる（KeyboardAvoidingView が onStartShouldSetResponder を持つため）。
 */
import React, { act } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";
import { Keyboard, Pressable, View } from "react-native";

// lucide のアイコンは名前ごとに export されるため Proxy で一括スタブ化する
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
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("expo-blur", () => ({ BlurView: () => null }));
// Portal は Provider が無いと描画されないため、その場に子を出すだけの実装へ差し替える
jest.mock("react-native-paper", () => ({ Portal: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { useBlurModal, type BlurModalOptions } from "./useBlurModal";

const CHILD_TEST_ID = "blur-modal-child";

/** キーボードの表示状態を任意に起こせるよう、addListener を差し替えて購読を捕まえる */
const keyboardHandlers: Record<string, Array<() => void>> = {};
const showKeyboard = () => act(() => keyboardHandlers.keyboardDidShow?.forEach((h) => h()));

/** テスト用ホスト。BlurModal は hook 経由でしか手に入らないので、描画と同時に open しておく */
const Host = ({ options, onChildPress }: { options?: BlurModalOptions; onChildPress?: () => void }) => {
	const { BlurModal, open } = useBlurModal(options);
	const opened = React.useRef(false);
	if (!opened.current) {
		opened.current = true;
		open();
	}
	return (
		<BlurModal>
			<Pressable testID={CHILD_TEST_ID} onPress={onChildPress}>
				<View />
			</Pressable>
		</BlurModal>
	);
};

/** host 要素（type が文字列のもの）だけを testID で引く。composite と二重に当たるのを避ける */
const findHostByTestID = (root: ReactTestInstance, testID: string): ReactTestInstance =>
	root.find((node) => typeof node.type === "string" && node.props?.testID === testID);

/**
 * 子（testID を持つ要素）より **上** の祖先だけを根に向かって並べる。
 * Pressable は自分の内側にも testID 付きの View を描画し、そこには Pressability が
 * onStartShouldSetResponder を必ず載せる（＝子自身の正当な実装）。ここで見たいのは
 * 「親が子のタップに割り込んでいないか」なので、子の内部は除外する。
 */
const ancestorsOf = (root: ReactTestInstance, testID: string): ReactTestInstance[] => {
	const chain: ReactTestInstance[] = [];
	let node: ReactTestInstance | null = findHostByTestID(root, testID);
	while (node && node.props?.testID === testID) node = node.parent;
	for (; node; node = node.parent) chain.push(node);
	return chain;
};

/**
 * 押下できるノード（composite の Pressable）を描画順で返す。
 *
 * ⚠️ `findAllByType(Pressable)` を使わないこと。#1156（SDK 54 / RN 0.81）で `Pressable` の実体が
 * `memo(Pressable)` になり、この呼び方は **1 件も返さなくなった**（test-renderer が持つノードの型は
 * memo の内側の関数コンポーネントで、export されている memo オブジェクトとは別物のため）。
 * 静かに空配列が返るだけなので、`[0]` が undefined になって初めて気づく形で落ちる。
 *
 * コンポーネントの同一性に依存すると RN のバージョンが上がるたびに同じ形で壊れるので、
 * 「host 要素ではない」「onPress を関数として持つ」という構造で拾う。
 */
const pressableNodes = (root: ReactTestInstance): ReactTestInstance[] =>
	root.findAll((node) => typeof node.type !== "string" && typeof node.props?.onPress === "function");

/** Pressable の onPress は host 要素には出ないので、押下は composite 側から起こす */
const findPressableByTestID = (root: ReactTestInstance, testID: string): ReactTestInstance =>
	pressableNodes(root).find((node) => node.props?.testID === testID)!;

describe("#528 BlurModal のタップ責務分離", () => {
	let renderer: TestRenderer.ReactTestRenderer;
	let dismissSpy: jest.SpyInstance;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		for (const key of Object.keys(keyboardHandlers)) delete keyboardHandlers[key];
		jest.spyOn(Keyboard, "addListener").mockImplementation(((event: string, handler: () => void) => {
			(keyboardHandlers[event] ??= []).push(handler);
			return { remove: () => {} };
		}) as unknown as typeof Keyboard.addListener);
		dismissSpy = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {});
	});

	afterEach(() => {
		act(() => renderer?.unmount());
		jest.restoreAllMocks();
	});

	const mount = (props: React.ComponentProps<typeof Host> = {}) => {
		act(() => {
			renderer = TestRenderer.create(<Host {...props} />);
		});
		return renderer;
	};

	it("モーダルの中身の祖先が、子のタップを奪うレスポンダを持たない", () => {
		mount();

		// onStartShouldSetResponder はタップ「開始」時に呼ばれる。親がここで副作用
		// （Keyboard.dismiss 等）を起こすと、子の onPress 成立前にレイアウトが動いて押下が潰れる
		const offenders = ancestorsOf(renderer.root, CHILD_TEST_ID)
			.filter((node) => node.props?.onStartShouldSetResponder !== undefined)
			.map((node) => (typeof node.type === "string" ? node.type : (node.type as { name?: string }).name || "?"));

		expect(offenders).toEqual([]);
	});

	it("中身のタップ開始では親が何もせず、続く onPress が成立する", () => {
		const onChildPress = jest.fn();
		mount({ onChildPress });

		// RN はタッチ開始時、対象から祖先へ向かって onStartShouldSetResponder を順に呼ぶ。
		// ここではその交渉だけを再現する（この時点ではまだ onPress は確定していない）
		act(() => {
			for (const node of ancestorsOf(renderer.root, CHILD_TEST_ID)) {
				node.props?.onStartShouldSetResponder?.({});
			}
		});

		// キーボードを閉じるかどうかは子（オートコンプリート側）の判断。親はタップ開始で何もしない
		expect(dismissSpy).not.toHaveBeenCalled();
		// 中身も畳まれていないので、指を離したときの onPress がそのまま届く
		act(() => findPressableByTestID(renderer.root, CHILD_TEST_ID).props.onPress());
		expect(onChildPress).toHaveBeenCalledTimes(1);
	});

	it("背景タップでは、キーボードが出ていればまずキーボードだけ閉じる", () => {
		mount({ options: { closeOnBackdropPress: true } });
		showKeyboard();

		// バックドロップは最初の Pressable（× ボタンより手前に描画される）
		act(() => pressableNodes(renderer.root)[0].props.onPress());

		expect(dismissSpy).toHaveBeenCalledTimes(1);
		// キーボードを閉じただけなので、中身はまだ生きている
		expect(renderer.root.findAll((n) => n.props?.testID === CHILD_TEST_ID)).not.toHaveLength(0);
	});

	it("キーボードが出ていない背景タップでは、closeOnBackdropPress のときモーダルを閉じる", () => {
		mount({ options: { closeOnBackdropPress: true } });

		act(() => pressableNodes(renderer.root)[0].props.onPress());

		expect(dismissSpy).not.toHaveBeenCalled();
		expect(renderer.root.findAll((n) => n.props?.testID === CHILD_TEST_ID)).toHaveLength(0);
	});
});
