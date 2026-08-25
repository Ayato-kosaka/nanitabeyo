/*
このファイルの責務
- 料理カテゴリの検索・選択（`features/map/components/DishCategorySearchForm`）を «画面» として提供する。
- 選んだ結果を `useDishCategorySelectionStore` へ置いて前の画面（レビュー投稿フォーム）へ返す。
- 戻る導線（ScreenHeader / ハードウェアバック）で投稿フォームへ帰す。

#1386 【設計】以前は `ReviewForm` の中の `DishCategoryModal`（BlurModal・**既定 zIndex 1100**）だった。
親のレビュー投稿モーダルは 1200 なので **子の方が数字が小さい** という逆転を抱えており、
同じ Portal ホスト配下の同一スタッキング文脈にいるため構造的に下へ潜りうる（#1350 §D）。
オートコンプリートを BlurModal の中に置いていた点も #528（候補をタップしても選択が反応しない）と
同じ形で、そこを直した PR #1180 が «全モーダルの操作性» を削った経緯がある。

ルートにすると:
- 重なり順は Navigator が持つ（手動 zIndex が 1 つ消える）
- キーボードを触るのは OS と `DishCategoryAutocomplete` だけになる
- **入力中のレビューと `mediaState`（#1127 の実行世代つき）が消えない**。投稿フォームは
  スタックに残ったままなので、選んで戻れば書きかけがそのまま続く

⚠️ この画面に KeyboardAvoidingView を足さないこと（`profile/saved-dish-category-location.tsx` と同じ理由）。
入力欄は 1 つで、候補パネルは `DishCategoryAutocomplete` が自分の下に描く。

⚠️ 「候補を選ばずに文字だけ入れて戻る」= 新規カテゴリの作成候補、という仕様は BlurModal 時代の
`onUnmount(dishCategoryName)` から引き継いだもの。実際に `POST` するのは投稿フォーム側
（失敗時のインラインエラーと処理中表示があちらの UI だから）。詳細は
`features/map/stores/useDishCategorySelectionStore.ts` のコメント。
*/
import React, { useCallback } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";

import { ScreenHeader } from "@/components/ScreenHeader";
import { DishCategorySearchForm } from "@/features/map/components/DishCategorySearchForm";
import { useDishCategorySelectionStore } from "@/features/map/stores/useDishCategorySelectionStore";
import { useRestaurantDishCategories } from "@/features/map/hooks/useRestaurantDishCategories";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

export default function DishCategorySelectScreen() {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { restaurantId } = useLocalSearchParams<{ restaurantId: string }>();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const setResult = useDishCategorySelectionStore((state) => state.setResult);
	const { categories: restaurantCategories } = useRestaurantDishCategories(restaurantId);

	/** 履歴があれば back。無い着地（URL 直リンク / リロード）だけ投稿フォームへ倒す */
	/**
	 * #1404 【バグ】`canGoBack()` ではなく **`canDismiss()`** を見ること。
	 *
	 * `canGoBack()` は React Navigation のナビゲーション状態を «親までさかのぼって» 見る。
	 * `(tabs)/_layout.tsx` は `initialRouteName="search"` を指定しているので、この画面へ
	 * URL 直リンクで着地すると **タブナビゲータが «検索へ戻れる»** と答え、`canGoBack()` は true になる。
	 * その結果、下の replace（親へ倒す保険）が一度も働かず、戻るは検索タブへ飛ぶ。
	 *
	 * `canDismiss()` は «スタックが 2 枚以上あるか» だけを見る（expo-router の
	 * build/global-state/routing.js: `state.type === 'stack' && state.routes.length > 1`）。
	 * タブ履歴もブラウザ履歴も数えないので、
	 *   - 通常導線（親から push）→ true → back で親へ戻る
	 *   - 直リンク着地（スタックは自分 1 枚）→ false → 親へ replace
	 * のどちらも意図どおりになる。
	 *
	 * ⚠️ `(tabs)` の外にあるルート（`/legal/[doc]` / `/auth/login`）はルート Stack が 1 枚なので
	 * `canGoBack()` でも同じ答えになる。実際 E2E Web run 32243079269 で落ちたのは
	 * `(tabs)` 配下の 2 件だけで、legal の同型テストは緑だった。
	 */
	const leave = useCallback(() => {
		if (router.canDismiss()) {
			router.back();
			return;
		}
		router.replace({
			pathname: "/[locale]/restaurant/[restaurantId]/review",
			params: { locale, restaurantId },
		});
	}, [locale, restaurantId]);

	const handleBack = useCallback(() => {
		lightImpact();
		leave();
	}, [lightImpact, leave]);

	const handleSuggestionSelect = useCallback(
		(suggestion: { dishCategoryId: string; label: string }) => {
			// ⚠️ 結果を置いてから離脱すること。逆順でも動くが、離脱後に setState する形になるため
			// （React が捨てる経路を作らない）
			setResult({ status: "selected", dishCategoryId: suggestion.dishCategoryId, label: suggestion.label });
			logFrontendEvent({
				event_name: "dish_category_selected",
				error_level: "log",
				payload: { dishCategoryId: suggestion.dishCategoryId, label: suggestion.label },
			});
			leave();
		},
		[setResult, logFrontendEvent, leave],
	);

	/**
	 * 候補を選ばずに離脱したときの入力値を «新規カテゴリの作成候補» として返す。
	 *
	 * `DishCategorySearchForm` は候補を選んだ時点で内部の最新値を空へ落とすため、
	 * 選択経由でここが呼ばれても空文字で来る（＝上書きしない）。
	 */
	const handleUnmount = useCallback(
		(dishCategoryName: string) => {
			if (!dishCategoryName.trim()) return;
			setResult({ status: "typed", name: dishCategoryName });
		},
		[setResult],
	);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				{/* タイトルはこのヘッダーだけが持つ（フォーム側の見出しは title={null} で落とす） */}
				<ScreenHeader
					title={i18n.t("Map.actions.selectDishCategory")}
					onPressBack={handleBack}
					testID="dish-category-screen"
				/>
				<DishCategorySearchForm
					onSuggestionSelect={handleSuggestionSelect}
					onUnmount={handleUnmount}
					title={null}
					testID="dish-category-search"
				/>
				{/* #1375 実機確認（5 巡目）「縦スクロールで選びたい。その上に検索ボックス」。
				    打たないと何も出ない画面だったので、**その店で既に記録がある料理**を縦に並べる。
				    記録しようとしている料理の名前を正確に打てるとは限らず、ここが一番当たる。
				    API は増やしていない（店舗フィードの既存 1 本から数えて畳む）。
				    打ち始めたら候補パネルがこの上に出るので、そのときは従来どおりの検索になる */}
				{restaurantCategories.length > 0 && (
					<View style={styles.listSection}>
						<Text style={styles.listHeading}>{i18n.t("Map.labels.dishesAtThisRestaurant")}</Text>
						<FlatList
							testID="dish-category-restaurant-list"
							data={restaurantCategories}
							keyExtractor={(item) => item.dishCategoryId}
							keyboardShouldPersistTaps="handled"
							renderItem={({ item }) => (
								<TouchableOpacity
									testID={`dish-category-restaurant-item-${item.dishCategoryId}`}
									style={styles.listItem}
									onPress={() => handleSuggestionSelect({ dishCategoryId: item.dishCategoryId, label: item.label })}
									accessibilityRole="button"
									accessibilityLabel={item.label}>
									<Text style={styles.listItemLabel} numberOfLines={1} ellipsizeMode="tail">
										{item.label}
									</Text>
									<Text style={styles.listItemCount}>{item.count}</Text>
								</TouchableOpacity>
							)}
						/>
					</View>
				)}
			</SafeAreaView>
		</LinearGradient>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
		},
		safeArea: {
			flex: 1,
		},
		// 検索欄の «下» に置く。候補パネル（DishCategoryAutocomplete が自分の下に描く）は
		// これより手前に出るので、打ち始めればこの一覧は隠れる
		listSection: {
			flex: 1,
			paddingHorizontal: 16,
		},
		listHeading: {
			fontSize: 14,
			fontWeight: "700",
			color: c.textSecondaryStrong,
			marginBottom: 8,
		},
		listItem: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 12,
			paddingVertical: 14,
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: c.borderMuted,
		},
		listItemLabel: {
			flex: 1,
			fontSize: 16,
			color: c.textPrimaryAlt,
		},
		// 件数は «その店でよく記録されている» の手がかり。主役ではないので淡く小さく
		listItemCount: {
			fontSize: 12,
			fontWeight: "700",
			color: c.textTertiary,
		},
	});
