/**
 * 📝 写真の無い «食べた» 記録から、自分の書いたクチコミを読むシート（#1629）
 *
 * ## なぜ要るのか
 * オーナー実機報告:
 * 「梅欄ヤエチカ店が『削除されました』『写真なし』と表示されます。押した時にレストラン詳細へ
 *   行くのは仕様と違うはず。**写真なしで良いから自分の書いたクチコミが見たい**」
 *
 * 一覧のセルを押したときの遷移先（`MyDishesListView.handlePressItem`）は、写真がある行だけ
 * 全画面 Feed へ入り、**写真が無い行は店舗詳細へ落ちていた**。店舗詳細は «その店の情報» を
 * 見せる画面で、自分が書いた文章はどこにも出ない。記録を開いたのに記録が読めない状態だった。
 *
 * ## なぜグリッドだけシートなのか（#1752）
 * グリッドは店舗でも日でもグルーピングされていないので、開く相手は **常にその 1 件**である。
 * 1 件を読むのに全画面を占有する必要は無い。一方 Calendar / Map は «その日 / その店の記録» を
 * 横に送る面なので、そこでは同じ中身を **フィードの 1 ページ**として出す
 * （`MyDishOwnReviewPage`）。器は違うが、**中身は `MyDishOwnReviewContent` 1 つ**である。
 *
 * ## 追加の API 呼び出しをしない
 * 一覧の行（`MyDishItem`）は既に `myReview`（`dish_reviews` の 1 行そのもの）を持っている。
 * 星・コメント・金額・食べた日はすべてそこから読めるので、開くときに何も取りに行かない。
 * 「押したのに読み込み中が出る」を作らないためにも、ここは取得しないこと。
 */
import React from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSheetBottomPadding } from "@/hooks/useSheetBottomPadding";

import type { Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import type { MyDishItem } from "@shared/api/v1/res";
import { MyDishOwnReviewContent } from "./MyDishOwnReviewContent";

/** シート下端の余白。実際にはこれに safe area（ジェスチャーバー）を足す */
const SHEET_PADDING_BOTTOM = 28;

export function MyDishOwnReviewSheet({
	item,
	onClose,
	onOpenRestaurant,
}: {
	/** 表示する行。null のときシートは開かない */
	item: MyDishItem | null;
	onClose: () => void;
	/** 「お店の詳細を見る」。#1629 以前の遷移先を «選べる出口» として残すためのもの */
	onOpenRestaurant: (item: MyDishItem) => void;
}) {
	const styles = useThemedStyles(createStyles);
	// #1629【オーナー実機報告】「下が見切れてる」。ジェスチャーバー / ホームインジケータの
	// 下に «お店の詳細を見る» が潜っていた。Modal は safe area の外まで描けるので自分で足す
	// （#1742 で同型のシートが 4 つ見つかったため、足し方を hooks/useSheetBottomPadding.ts へ集約した）
	const sheetPaddingBottom = useSheetBottomPadding(SHEET_PADDING_BOTTOM);

	return (
		<Modal visible={item !== null} transparent animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
			<View style={styles.backdrop}>
				<Pressable
					style={styles.backdropTouchable}
					onPress={onClose}
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
				/>

				<View
					style={[styles.sheet, { paddingBottom: sheetPaddingBottom }]}
					testID="my-dish-own-review-sheet">
					{item ? (
						<MyDishOwnReviewContent item={item} variant="sheet" onClose={onClose} onOpenRestaurant={onOpenRestaurant} />
					) : null}
				</View>
			</View>
		</Modal>
	);
}

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		backdrop: {
			flex: 1,
			justifyContent: "flex-end",
			backgroundColor: "rgba(0, 0, 0, 0.45)",
		},
		backdropTouchable: {
			...StyleSheet.absoluteFillObject,
		},
		sheet: {
			backgroundColor: colors.surface,
			borderTopLeftRadius: 20,
			borderTopRightRadius: 20,
			paddingHorizontal: 20,
			paddingTop: 16,
			// paddingBottom は safe area を足すため呼び出し側で組む（SHEET_PADDING_BOTTOM）
			maxHeight: "85%",
		},
	});
