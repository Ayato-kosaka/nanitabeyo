/**
 * #1502 【案A】地点確認の状態表示が「成功は黙って見た目で伝える」を守ることのテスト。
 *
 * 背景: 当初の実装は confirming/confirmed を「地点を確認しています…」「地点が確定しました」
 * という文章で出していたが、オーナーレビューで却下され、案A(成功の文章を消し、入力欄自体を
 * 状態表示にする)が採用された。ここで固定するのは
 *   1. confirming: 入力欄右端にスピナーだけが出て、文章(Text)は一切出ないこと
 *   2. confirmed: 入力欄右端に ✓ が出ること。CONFIRMED_BADGE_DURATION_MS(2000ms) 経過で
 *      黙って消えること(状態 prop は confirmed のままでも表示だけが終わる)
 *   3. confirmed 以外の状態へ遷移したら ✓ が即座に消えること(タイマーを待たない)
 *   4. error: 現行どおり赤の1行+再試行ボタンが出ること(エラーだけが言葉を持つ)
 *
 * スタブ方針は同ディレクトリの LocationAutocomplete.test.tsx (#528) と同じ。
 */
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { Text } from "react-native";

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
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useLocationSearch", () => ({
	useLocationSearch: () => ({
		suggestions: [],
		status: "idle",
		searchLocations: jest.fn(),
		clearSuggestions: jest.fn(),
	}),
}));

import { LocationAutocomplete } from "./LocationAutocomplete";

const TEST_ID = "location-autocomplete";

describe("#1502 地点確認の状態表示(案A: 成功は文章で語らない)", () => {
	let renderer: TestRenderer.ReactTestRenderer;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		jest.useFakeTimers();
	});

	afterEach(() => {
		act(() => renderer?.unmount());
		jest.useRealTimers();
	});

	const mount = (confirmationStatus: "confirming" | "confirmed" | "error" | null) => {
		act(() => {
			renderer = TestRenderer.create(
				<LocationAutocomplete
					value="渋谷区, 東京都"
					onChangeText={jest.fn()}
					onSelectSuggestion={jest.fn()}
					confirmationStatus={confirmationStatus}
					onRetryConfirmation={jest.fn()}
					testID={TEST_ID}
				/>,
			);
		});
	};

	const update = (confirmationStatus: "confirming" | "confirmed" | "error" | null) => {
		act(() => {
			renderer.update(
				<LocationAutocomplete
					value="渋谷区, 東京都"
					onChangeText={jest.fn()}
					onSelectSuggestion={jest.fn()}
					confirmationStatus={confirmationStatus}
					onRetryConfirmation={jest.fn()}
					testID={TEST_ID}
				/>,
			);
		});
	};

	const countByTestID = (testID: string) => renderer.root.findAllByProps({ testID }).length;
	/** レンダリング済みの全 Text の中身を結合する(成功文言が紛れ込んでいないことの検証用) */
	const allRenderedText = () =>
		renderer.root
			.findAllByType(Text)
			.map((node) => node.props.children)
			.flat()
			.filter((c): c is string => typeof c === "string")
			.join("\n");

	it("confirming: 入力欄右端にスピナーだけが出て、文章は出ない", () => {
		mount("confirming");

		expect(countByTestID(`${TEST_ID}-confirmation-confirming`)).toBeGreaterThan(0);
		expect(countByTestID(`${TEST_ID}-confirmation-confirmed`)).toBe(0);
		expect(countByTestID(`${TEST_ID}-confirmation-error`)).toBe(0);
		// i18n は t(key)=key のスタブなので、確認系の文言キーが 1 つでも描画されていればここに現れる
		expect(allRenderedText()).not.toContain("Search.locationConfirmation");
	});

	it("confirmed: ✓ が一瞬(2000ms)だけ出て、状態 prop は confirmed のままでも黙って消える", () => {
		mount("confirming");
		update("confirmed");

		expect(countByTestID(`${TEST_ID}-confirmation-confirmed`)).toBeGreaterThan(0);
		expect(countByTestID(`${TEST_ID}-confirmation-confirming`)).toBe(0);
		expect(allRenderedText()).not.toContain("Search.locationConfirmation");

		act(() => {
			jest.advanceTimersByTime(1999);
		});
		expect(countByTestID(`${TEST_ID}-confirmation-confirmed`)).toBeGreaterThan(0);

		act(() => {
			jest.advanceTimersByTime(1);
		});
		expect(countByTestID(`${TEST_ID}-confirmation-confirmed`)).toBe(0);
	});

	it("confirmed 以外へ遷移したら ✓ はタイマーを待たず即座に消える", () => {
		mount("confirmed");
		expect(countByTestID(`${TEST_ID}-confirmation-confirmed`)).toBeGreaterThan(0);

		update("confirming");
		expect(countByTestID(`${TEST_ID}-confirmation-confirmed`)).toBe(0);
		expect(countByTestID(`${TEST_ID}-confirmation-confirming`)).toBeGreaterThan(0);
	});

	it("error: 赤の1行+再試行ボタンが出る(エラーだけが言葉を持つ)", () => {
		mount("error");

		expect(countByTestID(`${TEST_ID}-confirmation-error`)).toBeGreaterThan(0);
		expect(countByTestID(`${TEST_ID}-confirmation-retry`)).toBeGreaterThan(0);
		expect(allRenderedText()).toContain("Search.locationConfirmation.error");
		expect(countByTestID(`${TEST_ID}-confirmation-confirming`)).toBe(0);
		expect(countByTestID(`${TEST_ID}-confirmation-confirmed`)).toBe(0);
	});
});
