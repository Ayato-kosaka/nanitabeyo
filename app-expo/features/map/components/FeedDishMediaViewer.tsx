/*
このファイルの責務
- 店詳細のレビュー一覧から開くフィード（`app/[locale]/restaurant/[restaurantId]/feed.tsx`
  の中身）を描く。
- 表示中の料理に対して「この料理にレビューを書く」導線を出す。

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
import React, { useState, useCallback, useMemo } from "react";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { useDishMediaEntriesStore, selectIdsByKey } from "@/stores/useDishMediaEntriesStore";
import { View, StyleSheet } from "react-native";
import { useSafeAreaFrame } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useRouter } from "expo-router";

type FeedDishMediaViewerProps = {
	initialIndex: number;
	entriesKey: string;
	/** 「この料理にレビューを書く」で向かう先の店（`review-from-media` ルートの restaurantId） */
	restaurantId: string;
};

export function FeedDishMediaViewer({ initialIndex, entriesKey, restaurantId }: FeedDishMediaViewerProps) {
	const frame = useSafeAreaFrame(); // Safe Area を除いたフレームの高さ
	const { user } = useAuth();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const router = useRouter();

	// 【設計】現在表示中のインデックスを管理（DishMediaFeed の onIndexChange で更新）
	const [currentIndex, setCurrentIndex] = useState(initialIndex);
	const handleIndexChange = useCallback((index: number) => {
		setCurrentIndex(index);
	}, []);

	// 現在表示中のアイテムを取得
	const prefilledMediaId = useMemo(() => {
		const state = useDishMediaEntriesStore.getState(); // ← subscribe しない snapshot 読み
		const { ids } = selectIdsByKey(entriesKey, "dish_media")(state);
		const id = ids[currentIndex];
		const entry = id === undefined ? undefined : state.entriesByMediaId[id];
		// #1386 【修正】旧実装はここで throw していた。BlurModal の中身だった頃は
		// 「一覧を押した = エントリがある」ときにしか描かれなかったので成立していたが、
		// ルートは URL 直リンク / リロードでも着地しうる。render 中の throw は
		// ErrorBoundary（`app/[locale]/_layout.tsx`）まで届いて画面ごと落ちるため、
		// 投稿 CTA を «出さない» ことで表現する（フィード自体は DishMediaFeed が空表示を持つ）
		return entry ? String(entry.dish_media.id) : null;
	}, [currentIndex, entriesKey]);

	// #400 【設計】「この料理にレビューを書く」ボタン押下時の処理
	// #1386 【設計】重ねるのをやめ、既存メディア用のレビュー投稿ルートへ push する。
	// メディアは URL の dishMediaId から復元できる（あちらはストアのキャッシュ優先で、
	// 無ければ `v1/dish-media` を引き直す）ので、コールドロードでも成立する
	const handleWriteReview = useCallback(() => {
		if (!prefilledMediaId) return;
		lightImpact();
		logFrontendEvent({
			event_name: "review_from_media_navigate",
			error_level: "log",
			payload: { restaurant_id: restaurantId, dish_media_id: prefilledMediaId },
		});
		router.push({
			pathname: "/[locale]/restaurant/[restaurantId]/review-from-media/[dishMediaId]",
			params: { locale, restaurantId, dishMediaId: prefilledMediaId },
		});
	}, [lightImpact, logFrontendEvent, router, locale, restaurantId, prefilledMediaId]);

	return (
		<View style={{ height: frame.height }}>
			<DishMediaFeed
				initialIndex={isNaN(initialIndex) ? 0 : initialIndex}
				getTitle={(item) => item.dish.name}
				entriesKey={entriesKey}
				idType="dish_media"
				onIndexChange={handleIndexChange}
			/>
			{/* #477【設計】匿名ユーザーの場合はレビュー投稿ボタンを非表示 */}
			{/* #1092 PR4b 【修正】`user?.is_anonymous === false` から共通判定（lib/authGuest.ts）へ寄せた。
			    旧式は is_anonymous が undefined のときもゲスト扱いになり、ログイン済みなのに
			    投稿ボタンだけ出ない（他画面では投稿できる）という食い違いになる */}
			{!isGuestUser(user) && prefilledMediaId && (
				<PrimaryButton
					testID="restaurant-feed-write-review-button"
					style={styles.writeReviewButton}
					label={i18n.t("Map.actions.writeReviewForThisDish")}
					onPress={handleWriteReview}
				/>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	writeReviewButton: {
		marginVertical: 16,
	},
});
