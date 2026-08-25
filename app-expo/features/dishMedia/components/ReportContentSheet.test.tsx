// #1514 (SAF-01) 通報シートで守りたい不変条件を固定するテスト。
//
// e2e（web / mobile）は migration 適用後にしか通らない（`content_reports` が dev に無いため）。
// 一方でここで固定したい 5 点は、DB が無くても壊れたら困るものばかりなので、
// レンダラ上のテストとして先に置いておく。
//
//   1. 理由を選ぶまで送信できない（誤爆防止）
//   2. 送信 API へ渡す形が DTO どおり（targetType / targetId / reasonCode / reasonText）
//   3. 送信に失敗しても選択内容を捨てず、エラーを出して送り直せる
//   4. 受け付けたら「受け付けました」の面へ進む（受付番号は出さない）
//   5. 上の 1〜4 が **投稿とレビューで同じ**であること
//      （オーナー指示で 1 つのコンポーネントを使い回している以上、
//       どちらか片方でしか成り立たない状態は作れないようにする）
import React, { act } from "react";
import TestRenderer, { type ReactTestRenderer } from "react-test-renderer";

// ---- 観測対象（送信の可否と API へ渡す形）以外はすべてスタブ化する ----
jest.mock("@/lib/i18n", () => ({
	__esModule: true,
	default: { t: (key: string) => key },
}));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));

/**
 * PrimaryButton は LinearGradient / Lottie を抱えていて重いので、
 * 「押せるか（disabled）」と「押したら何が起きるか」だけを持つ最小の代役に置き換える。
 */
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

/** #1584 router.push() の実体。履歴への遷移先を観測するために保持する */
const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockRouterPush }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP" }) }));

/** callBackend() の実体。各テストが差し替える */
let mockCallBackend: jest.Mock;
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));

import { ReportContentSheet } from "./ReportContentSheet";
import { CONTENT_REPORT_TARGET_TYPES } from "@shared/api/v1/constants/contentReports";

// React 19 では初期描画がスケジューラのタスクへ回されるため、act() で包む必要がある
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** v5 の ID。dish_media には v5 が混ざっている（DTO 側でバージョンを固定しない理由の実例） */
const TARGET_ID = "358cb297-da34-52b8-9f0c-6a1f7b2c3d4e";

/**
 * 通報できる対象の全種別。
 *
 * ⚠️ 定数から引いているので、**種別を増やしたらこの spec が自動でその種別も回す**。
 * ハードコードした配列に置き換えないこと。
 */
const TARGET_TYPES = CONTENT_REPORT_TARGET_TYPES;

/**
 * testID で最初に見つかった node を返す。
 *
 * ⚠️ host（View / Text）ではなく **composite（PrimaryButton など）が先に見つかる**。
 * 押下（onPress）も disabled も composite の props に載っているので、ここではそれで足りる。
 */
const findByTestID = (renderer: ReactTestRenderer, testID: string) =>
	renderer.root.findAll((node) => node.props?.testID === testID)[0];

/** 送信ボタンが押せない状態か（PrimaryButton の disabled prop で見る） */
const isSubmitDisabled = (renderer: ReactTestRenderer) => !!findByTestID(renderer, "report-submit").props.disabled;

const exists = (renderer: ReactTestRenderer, testID: string) =>
	renderer.root.findAll((node) => node.props?.testID === testID).length > 0;

/** 要素を押す（onPress を act で叩く） */
const press = async (renderer: ReactTestRenderer, testID: string) => {
	const node = findByTestID(renderer, testID);
	await act(async () => {
		node.props.onPress();
	});
};

// 対象種別ごとに挙動を分けない（オーナー指示で 1 コンポーネントを使い回す）ことを、
// 同じ検証を全種別へ流すことで固定する
describe.each(TARGET_TYPES)("ReportContentSheet（targetType: %s）", (targetType) => {
	const renderSheet = (onClose = jest.fn()) => {
		let renderer!: ReactTestRenderer;
		act(() => {
			renderer = TestRenderer.create(
				<ReportContentSheet
					visible
					targetType={targetType}
					targetId={TARGET_ID}
					targetLabel="エビデンス食堂"
					onClose={onClose}
				/>,
			);
		});
		return renderer;
	};

	beforeEach(() => {
		mockRouterPush.mockClear();
		mockCallBackend = jest.fn().mockResolvedValue({
			reportId: "report-1",
			status: "pending",
			alreadyReported: false,
		});
	});

	it("理由を選ぶまで送信ボタンを押せない", async () => {
		const renderer = renderSheet();

		expect(isSubmitDisabled(renderer)).toBe(true);

		await press(renderer, "report-reason-spam");

		expect(isSubmitDisabled(renderer)).toBe(false);
	});

	it("選んだ理由を DTO の形で送る", async () => {
		const renderer = renderSheet();

		await press(renderer, "report-reason-privacy");
		await press(renderer, "report-submit");

		expect(mockCallBackend).toHaveBeenCalledWith("v1/content-reports", {
			method: "POST",
			// 自由記述を入れていないので reasonText は送らない
			requestPayload: {
				// 受け取った targetType をそのまま送る。ここを固定値へ戻すと、
				// レビューの通報が投稿の通報として保存される
				targetType,
				targetId: TARGET_ID,
				reasonCode: "privacy",
			},
		});
	});

	it("理由の選択肢は対象種別で変わらない", async () => {
		const renderer = renderSheet();

		// 種別ごとに選択肢を絞り込む実装へ変わったらここで落ちる
		for (const code of ["spam", "sexual", "violence", "harassment", "illegal"]) {
			expect(exists(renderer, `report-reason-${code}`)).toBe(true);
		}
		for (const code of ["misinformation", "rights", "privacy", "irrelevant", "other"]) {
			expect(exists(renderer, `report-reason-${code}`)).toBe(true);
		}
	});

	it("受け付けられたら受付完了の面へ進む", async () => {
		const renderer = renderSheet();

		await press(renderer, "report-reason-spam");
		await press(renderer, "report-submit");

		expect(exists(renderer, "report-accepted")).toBe(true);
		// 受付番号は出さない（問い合わせ窓口が無いのに番号だけ見せない）
		expect(JSON.stringify(renderer.toJSON())).not.toContain("report-1");
	});

	/*
	#1584 受付の面から «あなたの報告履歴» へ行けること。

	この導線は一度、コミットメッセージにだけ書かれて **実装が入っていなかった**
	（013ef236。エビデンス撮影で発覚した）。文字ボタン 1 個なので
	他のテストは全部通ってしまう。ここで固定しておく。
	*/
	it("受付の面から報告履歴へ移動できる", async () => {
		const renderer = renderSheet();

		await press(renderer, "report-reason-spam");
		await press(renderer, "report-submit");

		expect(exists(renderer, "report-accepted")).toBe(true);
		expect(exists(renderer, "report-accepted-history")).toBe(true);
	});

	it("報告履歴へ移動するときは先にシートを閉じる", async () => {
		const onClose = jest.fn();
		const renderer = renderSheet(onClose);

		await press(renderer, "report-reason-spam");
		await press(renderer, "report-submit");
		await press(renderer, "report-accepted-history");

		// 閉じずに遷移すると、戻ってきたとき受付完了の面が残り
		// 「もう一度送れるのか」と読めてしまう
		expect(onClose).toHaveBeenCalled();
		expect(mockRouterPush).toHaveBeenCalledWith({
			pathname: "/[locale]/(tabs)/profile/content-reports",
			params: { locale: "ja-JP" },
		});
	});

	it("重複通報（alreadyReported）でも見え方は同じ", async () => {
		mockCallBackend.mockResolvedValue({ reportId: "report-1", status: "pending", alreadyReported: true });
		const renderer = renderSheet();

		await press(renderer, "report-reason-spam");
		await press(renderer, "report-submit");

		expect(exists(renderer, "report-accepted")).toBe(true);
		// 「既に通報済みです」に相当する別 UI を出さない
		expect(exists(renderer, "report-error")).toBe(false);
	});

	it("送信に失敗したらエラーを出し、選んだ理由は残す（送り直せる）", async () => {
		mockCallBackend.mockRejectedValue(new Error("network"));
		const renderer = renderSheet();

		await press(renderer, "report-reason-spam");
		await press(renderer, "report-submit");

		expect(exists(renderer, "report-error")).toBe(true);
		expect(exists(renderer, "report-accepted")).toBe(false);
		// 理由の選択が消えていない = そのまま押し直せる
		expect(isSubmitDisabled(renderer)).toBe(false);
	});

	it("閉じると選択内容を捨てる（次に開いたときの誤送信を防ぐ）", async () => {
		const onClose = jest.fn();
		const renderer = renderSheet(onClose);

		await press(renderer, "report-reason-spam");
		await press(renderer, "report-cancel");

		expect(onClose).toHaveBeenCalled();
		expect(isSubmitDisabled(renderer)).toBe(true);
	});
});
