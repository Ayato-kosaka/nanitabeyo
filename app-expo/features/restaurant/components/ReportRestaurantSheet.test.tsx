// #1933 «この情報が違う» の報告シートで守りたい不変条件を固定するテスト。
//
// 固定するのは受け入れ条件がコードのどこに現れているか:
//   条件 3   何が違うかを «選ぶ»（選ぶまで送れない）
//   条件 4   正しい値を入れて送る（値が要る項目では空では送れない）
//   条件 5   画面上は «受け付けました» だけ。**店の情報はその場では変わらない**
//   共通     `closed`（閉店した）は値を伴わない → 入力欄を出さず、値も送らない
//   共通     二重報告の差を UI に出さない（却下済みであることまで読めてしまう）
//
// ⚠️ **項目の一覧を写経しない。** 正は `RESTAURANT_REPORT_FIELDS`（shared）で、
// このテストもそこから引いて全項目を回す。書き写すと項目を増やしたときに
// «一部しか検証していない» 状態へ静かに戻る。
import React, { act } from "react";
import TestRenderer, { type ReactTestRenderer } from "react-test-renderer";

// ---- 観測対象（送信の可否と API へ渡す形）以外はすべてスタブ化する ----
jest.mock("@/lib/i18n", () => ({
	__esModule: true,
	default: { t: (key: string) => key },
}));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));

/** logFrontendEvent() の実体。payload に自由入力が載らないことを見るために保持する */
const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));

jest.mock("@/components/PrimaryButton", () => {
	const { Text } = require("react-native");
	return {
		PrimaryButton: ({
			label,
			onPress,
			disabled,
			testID,
		}: {
			label: string;
			onPress: () => void;
			disabled?: boolean;
			testID?: string;
		}) => (
			<Text testID={testID} onPress={onPress} accessibilityState={{ disabled: !!disabled }}>
				{label}
			</Text>
		),
	};
});

/** callBackend() の実体。各テストが差し替える */
let mockCallBackend: jest.Mock;
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

import { ReportRestaurantSheet } from "./ReportRestaurantSheet";
import {
	RESTAURANT_REPORT_FIELDS,
	RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE,
	RESTAURANT_REPORT_PROPOSED_VALUE_MAX_LENGTH,
} from "@shared/api/v1/constants/restaurantReports";

// React 19 では初期描画がスケジューラのタスクへ回されるため、act() で包む必要がある
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RESTAURANT_ID = "22222222-2222-4222-8222-222222222222";

/** 値を伴う項目（`closed` 以外）。定数から引く */
const FIELDS_WITH_VALUE = RESTAURANT_REPORT_FIELDS.filter(
	(f) => !RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE.includes(f),
);

const findByTestID = (renderer: ReactTestRenderer, testID: string) =>
	renderer.root.findAll((node) => node.props?.testID === testID)[0];

const exists = (renderer: ReactTestRenderer, testID: string) =>
	renderer.root.findAll((node) => node.props?.testID === testID).length > 0;

const isSubmitDisabled = (renderer: ReactTestRenderer) =>
	!!findByTestID(renderer, "restaurant-report-submit").props.disabled;

const press = async (renderer: ReactTestRenderer, testID: string) => {
	const node = findByTestID(renderer, testID);
	await act(async () => {
		node.props.onPress();
	});
};

const type = async (renderer: ReactTestRenderer, testID: string, text: string) => {
	const node = findByTestID(renderer, testID);
	await act(async () => {
		node.props.onChangeText(text);
	});
};

const renderSheet = (onClose = jest.fn()) => {
	let renderer!: ReactTestRenderer;
	act(() => {
		renderer = TestRenderer.create(
			<ReportRestaurantSheet
				visible
				restaurantId={RESTAURANT_ID}
				restaurantName="エビデンス食堂"
				onClose={onClose}
			/>,
		);
	});
	return renderer;
};

beforeEach(() => {
	mockLogFrontendEvent.mockClear();
	mockCallBackend = jest.fn().mockResolvedValue({
		reportId: "report-1",
		status: "pending",
		alreadyReported: false,
	});
});

describe("ReportRestaurantSheet", () => {
	it("項目を選ぶまで送信ボタンを押せない（受け入れ条件 3）", async () => {
		const renderer = renderSheet();
		expect(isSubmitDisabled(renderer)).toBe(true);

		await press(renderer, "restaurant-report-field-closed");

		expect(isSubmitDisabled(renderer)).toBe(false);
	});

	it.each(RESTAURANT_REPORT_FIELDS)("%s の選択肢が出ている（表示順は shared の定数のまま）", (field) => {
		const renderer = renderSheet();
		expect(exists(renderer, `restaurant-report-field-${field}`)).toBe(true);
	});

	it("選択肢の並びは shared の定数と同じ順序", () => {
		const renderer = renderSheet();
		const rendered = renderer.root
			.findAll((node) => typeof node.props?.testID === "string" && node.props.testID.startsWith("restaurant-report-field-"))
			.map((node) => node.props.testID.replace("restaurant-report-field-", ""));
		// composite と host で同じ testID が 2 回見つかるので重複を落とす
		expect([...new Set(rendered)]).toEqual([...RESTAURANT_REPORT_FIELDS]);
	});

	describe("値を伴わない項目（閉店した）", () => {
		it.each(RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE)("%s では入力欄を出さない", async (field) => {
			const renderer = renderSheet();
			await press(renderer, `restaurant-report-field-${field}`);
			expect(exists(renderer, "restaurant-report-value-input")).toBe(false);
		});

		it.each(RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE)("%s では proposedValue を送らない", async (field) => {
			const renderer = renderSheet();
			await press(renderer, `restaurant-report-field-${field}`);
			await press(renderer, "restaurant-report-submit");

			expect(mockCallBackend).toHaveBeenCalledWith("v1/restaurant-reports", {
				method: "POST",
				requestPayload: { restaurantId: RESTAURANT_ID, field },
			});
		});
	});

	describe("値を伴う項目", () => {
		it.each(FIELDS_WITH_VALUE)("%s では入力欄を出す", async (field) => {
			const renderer = renderSheet();
			await press(renderer, `restaurant-report-field-${field}`);
			expect(exists(renderer, "restaurant-report-value-input")).toBe(true);
		});

		it.each(FIELDS_WITH_VALUE)("%s は入力欄が空のままでは送れない（受け入れ条件 4）", async (field) => {
			const renderer = renderSheet();
			await press(renderer, `restaurant-report-field-${field}`);
			expect(isSubmitDisabled(renderer)).toBe(true);

			await type(renderer, "restaurant-report-value-input", "   ");
			expect(isSubmitDisabled(renderer)).toBe(true);

			await type(renderer, "restaurant-report-value-input", "正しい値");
			expect(isSubmitDisabled(renderer)).toBe(false);
		});

		it.each(FIELDS_WITH_VALUE)("%s は前後の空白を落として送る", async (field) => {
			const renderer = renderSheet();
			await press(renderer, `restaurant-report-field-${field}`);
			await type(renderer, "restaurant-report-value-input", "  本当の値  ");
			await press(renderer, "restaurant-report-submit");

			expect(mockCallBackend).toHaveBeenCalledWith("v1/restaurant-reports", {
				method: "POST",
				requestPayload: { restaurantId: RESTAURANT_ID, field, proposedValue: "本当の値" },
			});
		});

		it("⚠️ 入力欄は空で始まる（画面に出ている値を初期値にしない）", async () => {
			const renderer = renderSheet();
			await press(renderer, `restaurant-report-field-${FIELDS_WITH_VALUE[0]}`);
			expect(findByTestID(renderer, "restaurant-report-value-input").props.value).toBe("");
		});

		it("DB の CHECK と同じ上限を入力欄にも置く", async () => {
			const renderer = renderSheet();
			await press(renderer, `restaurant-report-field-${FIELDS_WITH_VALUE[0]}`);
			expect(findByTestID(renderer, "restaurant-report-value-input").props.maxLength).toBe(
				RESTAURANT_REPORT_PROPOSED_VALUE_MAX_LENGTH,
			);
		});

		it("⚠️ 項目を切り替えたら入力を捨てる（別の意味の値として送らない）", async () => {
			const renderer = renderSheet();
			await press(renderer, `restaurant-report-field-${FIELDS_WITH_VALUE[0]}`);
			await type(renderer, "restaurant-report-value-input", "店名のつもりで書いた文字列");

			// いったん値を伴わない項目へ移り、また値を伴う項目へ戻る
			await press(renderer, `restaurant-report-field-${RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE[0]}`);
			await press(renderer, `restaurant-report-field-${FIELDS_WITH_VALUE[0]}`);

			expect(findByTestID(renderer, "restaurant-report-value-input").props.value).toBe("");
			expect(isSubmitDisabled(renderer)).toBe(true);
		});
	});

	it("受け付けたら «受け付けました» の面へ進む（受付番号は出さない・受け入れ条件 5）", async () => {
		const renderer = renderSheet();
		await press(renderer, "restaurant-report-field-closed");
		await press(renderer, "restaurant-report-submit");

		expect(exists(renderer, "restaurant-report-accepted")).toBe(true);
		const text = JSON.stringify(renderer.toJSON());
		expect(text).not.toContain("report-1");
	});

	it("⚠️ 二重報告でも «受け付けました» の見え方を変えない", async () => {
		mockCallBackend = jest.fn().mockResolvedValue({
			reportId: "report-existing",
			status: "rejected",
			alreadyReported: true,
		});
		const renderer = renderSheet();
		await press(renderer, "restaurant-report-field-closed");
		await press(renderer, "restaurant-report-submit");

		expect(exists(renderer, "restaurant-report-accepted")).toBe(true);
		const text = JSON.stringify(renderer.toJSON());
		expect(text).not.toContain("rejected");
		expect(text).not.toContain("alreadyReported");
	});

	it("送信に失敗しても入力を捨てず、エラーを出して送り直せる", async () => {
		mockCallBackend = jest.fn().mockRejectedValue(new Error("boom"));
		const renderer = renderSheet();
		await press(renderer, `restaurant-report-field-${FIELDS_WITH_VALUE[0]}`);
		await type(renderer, "restaurant-report-value-input", "本当の値");
		await press(renderer, "restaurant-report-submit");

		expect(exists(renderer, "restaurant-report-error")).toBe(true);
		expect(exists(renderer, "restaurant-report-accepted")).toBe(false);
		// 入力は残っている＝もう一度押せば送り直せる
		expect(findByTestID(renderer, "restaurant-report-value-input").props.value).toBe("本当の値");
		expect(isSubmitDisabled(renderer)).toBe(false);
	});

	it("⚠️ ログに自由入力を載せない（第三者の個人情報を含みうる）", async () => {
		const renderer = renderSheet();
		await press(renderer, `restaurant-report-field-${FIELDS_WITH_VALUE[0]}`);
		await type(renderer, "restaurant-report-value-input", "田中太郎 090-0000-0000");
		await press(renderer, "restaurant-report-submit");

		const logged = JSON.stringify(mockLogFrontendEvent.mock.calls);
		expect(logged).not.toContain("田中太郎");
		expect(logged).not.toContain("090-0000-0000");
		// «値が入っていたか» までは残す
		expect(logged).toContain("hasProposedValue");
	});
});
