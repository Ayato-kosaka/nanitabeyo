/**
 * 📝 全画面フィードの «写真が無い記録» のページ（#1752 / #1761）
 *
 * ## なぜ «ページ» が要るのか
 * オーナー実機報告（2026-08-31）: 投稿（dish_media）を消した記録のクチコミが、
 * Calendar からは「見つかりません」、Map からは «3 件» と出ているのに 2 件しか送れず、
 * **どこからも読めなかった**。フィードのページ列が «メディアの列» で組まれていて、
 * メディアを持たない記録が黙って落ちていたためである（真因は `MyDishesFeedPage`）。
 *
 * ページ列を «記録の列» に変え、メディアを持たない記録はこのページを描く。
 * #1761 で **グリッド（一覧）もここへ寄せた**（それまでグリッドだけボトムシートだった）。
 * my-dishes の記録は、どの入口から開いてもフィードの 1 ページである。
 *
 * ## 上端だけは黒のまま残す
 *
 * フィードの «閉じる ×» と «n / m» の位置バーは、**写真の上に載る前提の固定白**である
 * （`FixedColors.onMedia`。テーマで振らない）。アプリの地をページ全面に敷くと、
 * ライトテーマでその 2 つが白地に白で消える（自己レビューのスクリーンショットで検出）。
 * 上端 {@link CONTENT_TOP} だけはメディアと同じ黒を残し、白の操作系が乗る場所を確保する。
 *
 * ## その下には «アプリの地» を敷く
 * フィードは写真・動画を引き立てるため固定の黒地（`FixedColors.mediaBackground`）だが、
 * ここに出るのは **文章**である。黒地のまま文字だけ置くと、周りのメディアページと同じ
 * «写真が読み込めていない画面» に見える。テーマ追従の面（`colors.background`）を敷いて、
 * «これは記録そのものだ» と分かる見た目にする（墓標の色の前提も «アプリの地の上» である。
 * `DeletedMediaTombstone` の設計コメント）。
 */
import React, { useCallback } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FixedColors, type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import { useLocale } from "@/hooks/useLocale";
import type { MyDishItem } from "@shared/api/v1/res";
import { MyDishOwnReviewContent } from "./MyDishOwnReviewContent";

/**
 * 上端の逃げ幅。フィードのルートが持つ «閉じる ×»（iOS: top 40 / Android: top 0）と、
 * `MyDishesFeedPage` の位置バー（iOS: top 48 / Android: top 8）の下へ本文を落とす。
 * ⚠️ どちらかを動かしたらここも動かすこと。重なると «×» もクチコミも押せなくなる。
 */
const CONTENT_TOP = Platform.OS === "ios" ? 96 : 56;

export function MyDishOwnReviewPage({ item }: { item: MyDishItem }) {
	const styles = useThemedStyles(createStyles);
	const insets = useSafeAreaInsets();
	const { locale } = useLocale();

	/*
	出口はこのページが自分で持つ（親の `MyDishesFeedPage` へ配線を足さない）。
	あちらは «何を並べるか» を決める場所で、ページ 1 枚ぶんの遷移まで持たせると
	フィードの取得ロジックと画面遷移が同じファイルで絡む。

	- 閉じる … クチコミを消したら、その記録のページは存在しなくなる。`DishMediaFeed` は
	  開いた時点の並びを固定しており、**縮められるのは墓標が立つメディアだけ**なので
	  «このページだけ消す» 道は無い。フィードごと畳んで一覧へ返す
	  （一覧の取り直しは `bumpMyDishesRevision()` が起こす）
	- お店の詳細 … グリッドのシートと同じ «選べる出口»
	*/
	const handleClose = useCallback(() => {
		if (router.canDismiss()) {
			router.back();
			return;
		}
		// 履歴が無い着地（web の直リンク / リロード）の保険。ルートの handleClose と同じ落とし先
		router.replace({ pathname: "/[locale]/(tabs)/my-dishes", params: { locale } });
	}, [locale]);
	const handleOpenRestaurant = useCallback(
		(target: MyDishItem) => {
			router.push({
				pathname: "/[locale]/restaurant/[restaurantId]",
				params: { locale, restaurantId: target.restaurant.id },
			});
		},
		[locale],
	);

	return (
		<View testID="my-dish-own-review-page" style={styles.container}>
			{/* 白い «×» と «n / m» が乗る帯。ここだけメディアと同じ黒のまま残す */}
			<View style={styles.topBand} pointerEvents="none" />
			<View style={[styles.content, { paddingBottom: 20 + insets.bottom }]}>
				<MyDishOwnReviewContent item={item} onClose={handleClose} onOpenRestaurant={handleOpenRestaurant} />
			</View>
		</View>
	);
}

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: colors.background,
		},
		topBand: {
			height: CONTENT_TOP,
			backgroundColor: FixedColors.mediaBackground,
		},
		content: {
			flex: 1,
			paddingHorizontal: 20,
			paddingTop: 16,
		},
	});
