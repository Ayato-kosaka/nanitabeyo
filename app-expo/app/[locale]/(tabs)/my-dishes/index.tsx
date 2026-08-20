import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { CalendarDays, LayoutGrid, MapPinned, Plus, SlidersHorizontal } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import { useLocale } from "@/hooks/useLocale";
import { MyDishesListView } from "@/features/myDishes/components/MyDishesListView";
import { MyDishesMapView } from "@/features/myDishes/components/MyDishesMapView";
import i18n from "@/lib/i18n";

// #1396 【設計】Map / リスト / Calendar は 3 ルートに分けず、1 ルート + `?view=` 切替にする。
// ルートを分けるとビュー切替のたびにアンマウントが起き、Map の viewport・各ビューのスクロール
// 位置が毎回飛ぶ（設計 issue #1396 コメント (1/2) §2-2）。ここでは view の shell だけを持ち、
// 各ビューの中身は PR3〜PR5（共有フィルタ store・Map・Calendar）が実装する。
const MY_DISHES_VIEWS = ["map", "list", "calendar"] as const;
type MyDishesView = (typeof MY_DISHES_VIEWS)[number];

function isMyDishesView(value: unknown): value is MyDishesView {
	return typeof value === "string" && (MY_DISHES_VIEWS as readonly string[]).includes(value);
}

const VIEW_ICONS: Record<MyDishesView, typeof MapPinned> = {
	map: MapPinned,
	list: LayoutGrid,
	calendar: CalendarDays,
};

export default function MyDishesScreen() {
	useScreenTrace("MyDishes");
	const { user } = useAuth();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const { view } = useLocalSearchParams<{ view?: string }>();
	// #1396 M-2: 既定ビューは list に確定する（PR4 が入るまでの暫定ではない）。
	// list が最も安いビューで、着地時に 964MB の dish_reviews への Map クエリを強制しないため
	const activeView: MyDishesView = isMyDishesView(view) ? view : "list";
	const isGuest = isGuestUser(user);
	// #1396 M-1: 一度訪問したビューは保持する（keep-alive）。条件レンダーで毎回アンマウントすると、
	// ルート分割と同じ理由で Map の viewport（useRef）・各ビューのスクロール位置が毎回飛ぶ
	// （§2-2 が避けたかった挙動そのもの）。未訪問のビューはまだマウントしない
	const [visitedViews, setVisitedViews] = useState<Set<MyDishesView>>(() => new Set([activeView]));
	useEffect(() => {
		setVisitedViews((prev) => (prev.has(activeView) ? prev : new Set(prev).add(activeView)));
	}, [activeView]);

	useEffect(() => {
		logFrontendEvent({
			event_name: "screen_view",
			error_level: "log",
			payload: { screen: "my_dishes" },
		});
	}, [logFrontendEvent]);

	// #1396 【設計】ビュー切替では取得し直さない（設計書 (2/2) §3-3）。URL の `view` だけを
	// 履歴を積まずに書き換える（`router.setParams`）。3 ビューは同じフィルタ状態を共有する前提。
	const handleSelectView = useCallback(
		(next: MyDishesView) => {
			if (next === activeView) return;
			lightImpact();
			router.setParams({ view: next });
		},
		[activeView, lightImpact],
	);

	const handleLoginPress = useCallback(() => {
		lightImpact();
		router.push({ pathname: "/[locale]/auth/login", params: { locale, next: `/${locale}/my-dishes` } });
	}, [lightImpact, locale]);

	// #1396 【設計】フィルタ編集はルート（`my-dishes/filters`）へ push する。BlurModal は使わない（§8-5）
	const handleFilterPress = useCallback(() => {
		lightImpact();
		router.push({ pathname: "/[locale]/(tabs)/my-dishes/filters", params: { locale } });
	}, [lightImpact, locale]);

	// #1396 【設計】旧レビュータブの投稿導線（`review-post-button`）の後継。
	// 押下先は既存 `selectRestaurant.tsx` の移設先（店名検索は別 Sub-issue で組み替え予定、挙動不変）
	const handleRecordPress = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "my_dishes_record_button_clicked",
			error_level: "log",
			payload: {},
		});
		router.push({
			pathname: "/[locale]/(tabs)/my-dishes/select-restaurant",
			params: { locale },
		});
	}, [lightImpact, logFrontendEvent, locale]);

	return (
		<SafeAreaView edges={["top", "bottom"]} style={styles.container} testID="my-dishes-screen">
			<View style={styles.header}>
				<View style={styles.titleRow}>
					<Text style={styles.title}>{i18n.t("Tabs.myDishes")}</Text>
					{!isGuest && (
						<TouchableOpacity
							testID="my-dishes-filter-button"
							onPress={handleFilterPress}
							style={styles.filterButton}
							accessibilityRole="button"
							accessibilityLabel={i18n.t("MyDishes.filters.title")}>
							<SlidersHorizontal size={18} color="#374151" />
						</TouchableOpacity>
					)}
				</View>
				<View style={styles.viewSwitch}>
					{MY_DISHES_VIEWS.map((v) => {
						const Icon = VIEW_ICONS[v];
						const isActive = activeView === v;
						return (
							<TouchableOpacity
								key={v}
								testID={`my-dishes-view-${v}`}
								onPress={() => handleSelectView(v)}
								style={[styles.viewButton, isActive && styles.viewButtonActive]}
								accessibilityRole="button"
								accessibilityState={{ selected: isActive }}>
								<Icon size={18} color={isActive ? "#F05537" : "#6B7280"} />
								<Text style={[styles.viewButtonLabel, isActive && styles.viewButtonLabelActive]}>
									{i18n.t(`MyDishes.views.${v}`)}
								</Text>
							</TouchableOpacity>
						);
					})}
				</View>
			</View>

			<View style={styles.body}>
				{isGuest ? (
					<View style={styles.guestContainer}>
						<Text testID="my-dishes-guest-description" style={styles.guestDescription}>
							{i18n.t("MyDishes.guest.description")}
						</Text>
						<PrimaryButton
							testID="my-dishes-guest-login-button"
							onPress={handleLoginPress}
							label={i18n.t("MyDishes.guest.loginButton")}
							style={styles.guestButton}
						/>
					</View>
				) : (
					// #1396 【設計】ビュー切替では再取得しない（設計書 (2/2) §3-3）。3 ビューは
					// `useMyDishesFilterStore` の `queryKey` を共有しており、切り替えても
					// `queryKey` が変わらないので、既に読んだページをそのまま描く。
					//
					// M-1: 条件レンダーで毎回アンマウントすると、ルート分割と同じ理由で
					// Map の viewport（`MyDishesMapView` 内の `useRef`）・各ビューのスクロール位置が
					// 毎回飛ぶ（§2-2 が避けたかった挙動そのもの）。一度訪問したビューは
					// アンマウントせず `display: "none"` 相当で隠すだけにする（keep-alive）。
					// 未訪問のビューはまだマウントしない。RN / react-native-web の両方で効くよう
					// `pointerEvents="none"` と `accessibilityElementsHidden` /
					// `importantForAccessibility="no-hide-descendants"` で非表示ビューをタッチと
					// 読み上げから除外する。この器の形は PR4（Map）・PR5（Calendar）がそのまま踏襲する。
					// Calendar の中身自体は本 PR のスコープ外（引き続き空のプレースホルダー）。PR4 で
					// Map（`MyDishesMapView`）が入ったことで、keep-alive の器があって初めて
					// 内部の viewport `useRef` が意味を持つ（ビュー切替のたびにアンマウントされない）。
					<>
						{MY_DISHES_VIEWS.map((v) => {
							if (!visitedViews.has(v)) return null;
							const isActive = v === activeView;
							return (
								<View
									key={v}
									testID={`my-dishes-${v}-view`}
									style={[styles.viewPlaceholder, !isActive && styles.hiddenView]}
									pointerEvents={isActive ? "auto" : "none"}
									accessibilityElementsHidden={!isActive}
									importantForAccessibility={isActive ? "auto" : "no-hide-descendants"}>
									{v === "list" && <MyDishesListView />}
									{v === "map" && <MyDishesMapView />}
								</View>
							);
						})}
					</>
				)}
			</View>

			{!isGuest && (
				<TouchableOpacity
					testID="my-dishes-record-button"
					onPress={handleRecordPress}
					style={styles.fab}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("MyDishes.record.cta")}>
					<Plus size={20} color="#FFFFFF" />
					<Text style={styles.fabLabel}>{i18n.t("MyDishes.record.cta")}</Text>
				</TouchableOpacity>
			)}
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#FFFFFF",
	},
	header: {
		paddingHorizontal: 16,
		paddingTop: 8,
		paddingBottom: 12,
		borderBottomWidth: 1,
		borderBottomColor: "#EEE",
	},
	titleRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		marginBottom: 12,
	},
	title: {
		fontSize: 18,
		fontWeight: "700",
		color: "#1A1A1A",
	},
	filterButton: {
		padding: 8,
		borderRadius: 8,
		backgroundColor: "#F3F4F6",
	},
	viewSwitch: {
		flexDirection: "row",
		gap: 8,
	},
	viewButton: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 6,
		paddingVertical: 8,
		borderRadius: 8,
		backgroundColor: "#F3F4F6",
	},
	viewButtonActive: {
		backgroundColor: "#FDE7E1",
	},
	viewButtonLabel: {
		fontSize: 12,
		color: "#6B7280",
	},
	viewButtonLabelActive: {
		color: "#F05537",
		fontWeight: "700",
	},
	body: {
		flex: 1,
	},
	viewPlaceholder: {
		flex: 1,
	},
	// M-1: 非表示ビューを `display: "none"` で隠す。RN の View / react-native-web の両方で効く
	hiddenView: {
		display: "none",
	},
	guestContainer: {
		flex: 1,
		justifyContent: "center",
		paddingHorizontal: 24,
	},
	guestDescription: {
		fontSize: 16,
		color: "#666",
		textAlign: "center",
		marginBottom: 16,
	},
	guestButton: {
		width: "100%",
	},
	fab: {
		position: "absolute",
		right: 16,
		bottom: 16,
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		paddingHorizontal: 16,
		paddingVertical: 12,
		borderRadius: 24,
		backgroundColor: "#F05537",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.2,
		shadowRadius: 8,
		elevation: 6,
	},
	fabLabel: {
		color: "#FFFFFF",
		fontWeight: "700",
		fontSize: 14,
	},
});
