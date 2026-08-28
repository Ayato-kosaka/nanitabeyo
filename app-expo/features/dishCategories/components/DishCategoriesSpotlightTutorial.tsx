import React from "react";

import { SpotlightTutorial } from "@/features/tutorial/components/SpotlightTutorial";
import type {
	SpotlightOpenReason,
	DishCategoriesTutorialStepDefinition,
	DishCategoriesTutorialTargetKey,
	DishCategoriesTutorialTargetRefs,
} from "@/features/tutorial/types/spotlight";

/*
#927 料理提案画面のスポットライトチュートリアル。

## このファイルが持つのは «何を、どの順で説明するか» だけ

測定・マスク・吹き出しの退避・進捗・読み上げは `features/tutorial/components/SpotlightTutorial.tsx`
が持つ（#1375 で my-dishes にも同じ形が要ることになり、共通部分を切り出した）。
画面固有なのはステップ定義だけである。

## 表示順はプロダクト判断そのもの

描画コードから切り離してここに固定する。`deepDive` だけは料理データに候補がある場合に限って
表示する — 「見えていない機能を架空の位置で説明する」ことはしない。
*/
const TUTORIAL_STEPS: readonly DishCategoriesTutorialStepDefinition[] = [
	{
		id: "swipeAndDecide",
		targetKeys: ["swipeArea", "selectCta"],
		titleKey: "DishCategories.tutorial.steps.swipeAndDecide.title",
		bodyKeys: ["DishCategories.tutorial.steps.swipeAndDecide.body"],
		preferredPlacement: "above",
	},
	{
		id: "deepDive",
		targetKeys: ["deepDive"],
		titleKey: "DishCategories.tutorial.steps.deepDive.title",
		bodyKeys: ["DishCategories.tutorial.steps.deepDive.body"],
		preferredPlacement: "above",
		optional: true,
	},
	{
		id: "dishCategoryActions",
		targetKeys: ["dishCategoryActions"],
		titleKey: "DishCategories.tutorial.steps.dishCategoryActions.title",
		bodyKeys: [
			"DishCategories.tutorial.steps.dishCategoryActions.save",
			"DishCategories.tutorial.steps.dishCategoryActions.block",
		],
		preferredPlacement: "below",
	},
	{
		id: "groupVote",
		targetKeys: ["groupVote"],
		titleKey: "DishCategories.tutorial.steps.groupVote.title",
		bodyKeys: ["DishCategories.tutorial.steps.groupVote.body"],
		preferredPlacement: "below",
	},
] as const;

export function DishCategoriesSpotlightTutorial({
	visible,
	requestId,
	openReason,
	targetRefs,
	includeDeepDiveStep,
	onPresented,
	onClose,
	onUnavailable,
}: {
	visible: boolean;
	requestId: number;
	openReason: SpotlightOpenReason;
	targetRefs: DishCategoriesTutorialTargetRefs;
	includeDeepDiveStep: boolean;
	onPresented: () => void;
	onClose: () => void;
	onUnavailable: () => void;
}) {
	const steps = React.useMemo(
		() => TUTORIAL_STEPS.filter((step) => step.id !== "deepDive" || includeDeepDiveStep),
		[includeDeepDiveStep],
	);

	return (
		<SpotlightTutorial<DishCategoriesTutorialTargetKey>
			visible={visible}
			requestId={requestId}
			openReason={openReason}
			targetRefs={targetRefs}
			steps={steps}
			// ⚠️ E2E（e2e-web/tests/search/dish-categories-tutorial.spec.ts と
			// e2e-mobile/tests/catalog/ui-catalog.test.ts）がこの接頭辞の testID を見ている。
			// 変えるときは spec も一緒に直すこと
			testIDPrefix="dish-categories-tutorial"
			// 「横に振れる」ことは静止画では伝わらないので、最初のステップだけ往復アイコンを出す
			swipeHint={{ stepId: "swipeAndDecide", targetKey: "swipeArea" }}
			onPresented={onPresented}
			onClose={onClose}
			onUnavailable={onUnavailable}
		/>
	);
}
