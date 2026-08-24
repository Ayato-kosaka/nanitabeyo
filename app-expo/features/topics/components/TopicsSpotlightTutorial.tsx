import React from "react";

import { SpotlightTutorial } from "@/features/tutorial/components/SpotlightTutorial";
import type {
	SpotlightOpenReason,
	TopicsTutorialStepDefinition,
	TopicsTutorialTargetKey,
	TopicsTutorialTargetRefs,
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
const TUTORIAL_STEPS: readonly TopicsTutorialStepDefinition[] = [
	{
		id: "swipeAndDecide",
		targetKeys: ["swipeArea", "selectCta"],
		titleKey: "Topics.tutorial.steps.swipeAndDecide.title",
		bodyKeys: ["Topics.tutorial.steps.swipeAndDecide.body"],
		preferredPlacement: "above",
	},
	{
		id: "deepDive",
		targetKeys: ["deepDive"],
		titleKey: "Topics.tutorial.steps.deepDive.title",
		bodyKeys: ["Topics.tutorial.steps.deepDive.body"],
		preferredPlacement: "above",
		optional: true,
	},
	{
		id: "topicActions",
		targetKeys: ["topicActions"],
		titleKey: "Topics.tutorial.steps.topicActions.title",
		bodyKeys: ["Topics.tutorial.steps.topicActions.save", "Topics.tutorial.steps.topicActions.block"],
		preferredPlacement: "below",
	},
	{
		id: "groupVote",
		targetKeys: ["groupVote"],
		titleKey: "Topics.tutorial.steps.groupVote.title",
		bodyKeys: ["Topics.tutorial.steps.groupVote.body"],
		preferredPlacement: "below",
	},
] as const;

export function TopicsSpotlightTutorial({
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
	targetRefs: TopicsTutorialTargetRefs;
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
		<SpotlightTutorial<TopicsTutorialTargetKey>
			visible={visible}
			requestId={requestId}
			openReason={openReason}
			targetRefs={targetRefs}
			steps={steps}
			// ⚠️ 既定値だが明示しておく。E2E（e2e-web/tests/search/topics-tutorial.spec.ts）が
			// この接頭辞の testID を見ているので、変えるときは spec も一緒に直すこと
			testIDPrefix="topics-tutorial"
			// 「横に振れる」ことは静止画では伝わらないので、最初のステップだけ往復アイコンを出す
			swipeHint={{ stepId: "swipeAndDecide", targetKey: "swipeArea" }}
			onPresented={onPresented}
			onClose={onClose}
			onUnavailable={onUnavailable}
		/>
	);
}
