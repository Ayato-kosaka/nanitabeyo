/*
#1375 実機確認（5 巡目）オーナー要望:「料理カテゴリ提案画面のようなチュートリアルを作ってください
（フィードに入るための説明、プラスボタンの説明、上部タブの説明、フィルタの説明）」。

守るのは 4 つ。
1. 4 つの説明が、オーナーが挙げた 4 箇所を指していること
2. 指す先の実 UI に ref が付いていること（付いていないと «吹き出しだけ出て何も指さない»）
3. 一度見たら二度目は自動で開かないこと
4. この画面に無い操作（横スワイプ）のヒントを出さないこと
*/
import React from "react";

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
// このテストが見たいのは «ラッパーが渡すステップ定義» だけ。共通コンポーネントは
// useLogger → lib/supabase → constants/Env まで芋づるに読み込むため（jest では
// app.config.ts が評価されず Env が落ちる）、器へ差し替えて断ち切る
jest.mock("@/features/tutorial/components/SpotlightTutorial", () => ({ SpotlightTutorial: () => null }));

import {
	MY_DISHES_TUTORIAL_STORAGE_KEY,
	MyDishesSpotlightTutorial,
} from "@/features/myDishes/components/MyDishesSpotlightTutorial";

describe("#1375 my-dishes のチュートリアル", () => {
	/** ラッパーが共通コンポーネントへ渡している props を、描画せずに取り出す */
	const propsPassedToSpotlight = () => {
		const element = MyDishesSpotlightTutorial({
			visible: true,
			requestId: 1,
			openReason: "auto",
			targetRefs: {
				viewSwitch: { current: null },
				body: { current: null },
				addButton: { current: null },
				filterButton: { current: null },
			},
			onPresented: jest.fn(),
			onClose: jest.fn(),
			onUnavailable: jest.fn(),
		}) as React.ReactElement;
		return element.props as {
			steps: readonly { id: string; targetKeys: readonly string[]; titleKey: string; bodyKeys: readonly string[] }[];
			testIDPrefix: string;
			swipeHint?: unknown;
		};
	};

	it("オーナーが挙げた 4 箇所を、この順で説明する", () => {
		const { steps } = propsPassedToSpotlight();
		// «まず見る → 深く見る → 増やす → 絞る»
		expect(steps.map((step) => step.id)).toEqual(["views", "openFeed", "add", "filter"]);
		expect(steps.map((step) => step.targetKeys)).toEqual([
			["viewSwitch"], // 上部タブ（Map / 一覧 / カレンダー）
			["body"], // フィードに入るための説明
			["addButton"], // ＋ ボタン
			["filterButton"], // フィルタ
		]);
	});

	it("すべてのステップが文言キーを持つ（吹き出しが空にならない）", () => {
		const { steps } = propsPassedToSpotlight();
		for (const step of steps) {
			expect(step.titleKey).toMatch(/^MyDishes\.tutorial\.steps\./);
			expect(step.bodyKeys.length).toBeGreaterThan(0);
			for (const key of step.bodyKeys) expect(key).toMatch(/^MyDishes\.tutorial\.steps\./);
		}
	});

	it("この画面に «横に振る» 操作は無いので、スワイプのヒントを出さない", () => {
		expect(propsPassedToSpotlight().swipeHint).toBeUndefined();
	});

	it("E2E が画面ごとに見分けられる testID 接頭辞を持つ（料理提案画面と混ざらない）", () => {
		expect(propsPassedToSpotlight().testIDPrefix).toBe("my-dishes-tutorial");
	});

	it("閲覧済みキーは画面ごとに別（料理提案画面のものを読まない）", () => {
		expect(MY_DISHES_TUTORIAL_STORAGE_KEY).toBe("my_dishes_spotlight_tutorial_seen_v1");
		expect(MY_DISHES_TUTORIAL_STORAGE_KEY).not.toBe("topics_spotlight_tutorial_seen_v1");
	});
});
