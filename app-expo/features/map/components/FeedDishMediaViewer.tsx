/*
このファイルの責務
- 店詳細のレビュー一覧から開くフィード（`app/[locale]/restaurant/[restaurantId]/feed.tsx`
  の中身）を描く。

#1629【オーナー確定】**「この料理にレビューを書く」ボタンは外した。**
右レールの «食べた» が記録の導線になっているので、同じことを始めるボタンが
画面に 2 つある状態だった。オーナー指示で 1 つに寄せる。

#1386 【設計】以前はこの中に `ReviewFormModal`（BlurModal）を持ち、フィードの上に
レビュー投稿フォームを重ねていた。しかも自分自身が `RestaurantReviewsTab` の
`DishMediaModal`（BlurModal・既定 z1100）の中身として描かれていたため、
**オーバーレイの中にオーバーレイ**という 3 段目の入れ子になっていた（#1350 §D）。

いまはフィード自体がルートで、投稿フォームも既存の «既存メディアからのレビュー投稿» ルート
（`review-from-media/[dishMediaId]`）へ push する。これで:
- 入力中のレビューと `mediaState`（#1127 の実行世代つき）はルートの寿命で守られる。
  重ねていた時代は、下のフィードを触った拍子に閉じれば入力が丸ごと消えていた
- 手動 zIndex が 1 つも要らなくなる
*/
import React from "react";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { View } from "react-native";
import { useSafeAreaFrame } from "react-native-safe-area-context";

type FeedDishMediaViewerProps = {
	initialIndex: number;
	entriesKey: string;
};

export function FeedDishMediaViewer({ initialIndex, entriesKey }: FeedDishMediaViewerProps) {
	const frame = useSafeAreaFrame(); // Safe Area を除いたフレームの高さ

	return (
		<View style={{ height: frame.height }}>
			<DishMediaFeed
				initialIndex={isNaN(initialIndex) ? 0 : initialIndex}
				getTitle={(item) => item.dish.name}
				entriesKey={entriesKey}
				idType="dish_media"
			/>
		</View>
	);
}
