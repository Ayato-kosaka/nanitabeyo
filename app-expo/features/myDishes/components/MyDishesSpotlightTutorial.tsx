import React from "react";

import { SpotlightTutorial } from "@/features/tutorial/components/SpotlightTutorial";
import type {
	SpotlightOpenReason,
	SpotlightStepDefinition,
	SpotlightTargetRefs,
} from "@/features/tutorial/types/spotlight";

/*
#1375 「食べたい / 食べた」タブのスポットライトチュートリアル。

## なぜ要るのか（オーナー指摘）

この画面は «自分で貯めた棚» なので、初見では **何をどう見る画面なのかが分からない**。
- 上部の 3 つのアイコンがビュー切替だと気づかない
- カード / ピン / 日を押すと全画面フィードに入る、が分からない
- ＋ が «SNS から取り込む / 食べたを記録する» の入口だと分からない
- 絞り込みが «状態・料理・エリア» で棚を削る道具だと分からない

料理提案画面（#927）と同じスポットライト形式にする。仕組みは共通
（`features/tutorial/`）で、ここが持つのは **何を、どの順で説明するか** だけ。

## 順番の理由

«まず見る → 深く見る → 増やす → 絞る» の順にしてある。
1. ビュー切替（Map / 一覧 / カレンダー）… この画面の全体像。ここが分からないと他が意味を持たない
2. フィードへ入る … いちばん «使っている» 状態。押せることを知らないと棚が死ぬ
3. ＋ で増やす … 棚は自分で足すものだと伝える
4. 絞り込み … 増えてから効いてくるので最後
*/
export type MyDishesTutorialTargetKey = "viewSwitch" | "body" | "addButton" | "filterButton";
export type MyDishesTutorialTargetRefs = SpotlightTargetRefs<MyDishesTutorialTargetKey>;

/** 閲覧済みフラグ。仕様を変えるときは v を上げる（既存キーを書き換えない） */
export const MY_DISHES_TUTORIAL_STORAGE_KEY = "my_dishes_spotlight_tutorial_seen_v1";

const TUTORIAL_STEPS: readonly SpotlightStepDefinition<MyDishesTutorialTargetKey>[] = [
	{
		id: "views",
		targetKeys: ["viewSwitch"],
		titleKey: "MyDishes.tutorial.steps.views.title",
		bodyKeys: ["MyDishes.tutorial.steps.views.body"],
		// 上部にあるので吹き出しは下へ
		preferredPlacement: "below",
	},
	{
		id: "openFeed",
		targetKeys: ["body"],
		titleKey: "MyDishes.tutorial.steps.openFeed.title",
		bodyKeys: ["MyDishes.tutorial.steps.openFeed.body", "MyDishes.tutorial.steps.openFeed.axis"],
		preferredPlacement: "below",
	},
	{
		id: "add",
		targetKeys: ["addButton"],
		titleKey: "MyDishes.tutorial.steps.add.title",
		bodyKeys: ["MyDishes.tutorial.steps.add.sns", "MyDishes.tutorial.steps.add.eaten"],
		// ＋ は右下なので吹き出しは上へ
		preferredPlacement: "above",
	},
	{
		id: "filter",
		targetKeys: ["filterButton"],
		titleKey: "MyDishes.tutorial.steps.filter.title",
		bodyKeys: ["MyDishes.tutorial.steps.filter.body"],
		preferredPlacement: "below",
	},
] as const;

export function MyDishesSpotlightTutorial({
	visible,
	requestId,
	openReason,
	targetRefs,
	onPresented,
	onClose,
	onUnavailable,
}: {
	visible: boolean;
	requestId: number;
	openReason: SpotlightOpenReason;
	targetRefs: MyDishesTutorialTargetRefs;
	onPresented: () => void;
	onClose: () => void;
	onUnavailable: () => void;
}) {
	return (
		<SpotlightTutorial<MyDishesTutorialTargetKey>
			visible={visible}
			requestId={requestId}
			openReason={openReason}
			targetRefs={targetRefs}
			steps={TUTORIAL_STEPS}
			testIDPrefix="my-dishes-tutorial"
			// ⚠️ 横スワイプのヒントは渡さない。この画面に «横に振る» 操作は無い
			// （説明できない動きを匂わせない）
			onPresented={onPresented}
			onClose={onClose}
			onUnavailable={onUnavailable}
		/>
	);
}
