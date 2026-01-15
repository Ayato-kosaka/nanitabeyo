import React, { useEffect, useState } from "react";
import { StyleSheet, ActivityIndicator, View, Text } from "react-native";
import { useLocalSearchParams, router, Stack } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronLeft } from "lucide-react-native";
import DishMediaMap from "@/features/dishMedia/components/DishMediaMap";
import type { QueryDishMediaByIdsResponse } from "@shared/api/v1/res";
import type { QueryDishMediaByIdsDto } from "@shared/api/v1/dto";
import { useAPICall } from "@/hooks/useAPICall";
import { useDishMediaEntriesStore, selectEntryByMediaId } from "@/stores/useDishMediaEntriesStore";
import { useLocale } from "@/hooks/useLocale";
import i18n from "@/lib/i18n";

// #644 【設計】投稿した DishMedia をフルスクリーンで表示する画面
export default function ReviewPostScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const { callBackend } = useAPICall();
	const locale = useLocale();
	const entriesKey = "ReviewPostScreen";

	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// #644 【設計】ストアから該当 DishMedia を取得
	const entry = useDishMediaEntriesStore((state) => (id ? selectEntryByMediaId(id)(state) : null));

	useEffect(() => {
		// #644 【設計】ストアに存在しない場合は API 経由でフェッチ
		if (!id) {
			setError(i18n.t("Common.error"));
			return;
		}

		if (!entry) {
			const fetchData = async () => {
				setIsLoading(true);
				setError(null);
				try {
					const { upsertDishMediaEntries, updateMediaIdsByKey } = useDishMediaEntriesStore.getState();
					const requestPayload: QueryDishMediaByIdsDto = { ids: [id] };
					const response = await callBackend<QueryDishMediaByIdsDto, QueryDishMediaByIdsResponse>("v1/dish-media", {
						method: "GET",
						requestPayload,
					});

					if (response.items.length === 0) {
						setError(i18n.t("Common.error"));
						return;
					}

					// #644 【設計】ストアに反映
					upsertDishMediaEntries(response.items);
					updateMediaIdsByKey(entriesKey, () => [id]);
				} catch (err) {
					setError(i18n.t("Common.error"));
				} finally {
					setIsLoading(false);
				}
			};
			fetchData();
		} else {
			// #644 【設計】ストアに存在する場合は並び順だけ設定
			const { updateMediaIdsByKey } = useDishMediaEntriesStore.getState();
			updateMediaIdsByKey(entriesKey, () => [id]);
		}

		return () => {
			const { clearByKey } = useDishMediaEntriesStore.getState();
			clearByKey(entriesKey);
		};
	}, [id, entry, callBackend]);

	// #644 【設計】戻るボタンでレビュー開始画面へ遷移
	const handleBack = () => {
		router.replace(`/${locale}/(tabs)/review/index`);
	};

	// #644 【設計】ローディング中の表示
	if (isLoading) {
		return (
			<>
				<Stack.Screen
					options={{
						headerShown: true,
						headerTransparent: true,
						headerTitle: "",
						headerLeft: () => null,
						headerStyle: { backgroundColor: "transparent" },
					}}
				/>
				<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
					<View style={styles.loadingContainer}>
						<ActivityIndicator size="large" color="#5EA2FF" />
					</View>
				</LinearGradient>
			</>
		);
	}

	// #644 【設計】エラー時の表示
	if (error) {
		return (
			<>
				<Stack.Screen
					options={{
						headerShown: true,
						headerTransparent: true,
						headerTitle: "",
						headerLeft: () => null,
						headerStyle: { backgroundColor: "transparent" },
					}}
				/>
				<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
					<View style={styles.errorContainer}>
						<Text style={styles.errorText}>{error}</Text>
					</View>
				</LinearGradient>
			</>
		);
	}

	return (
		<>
			<Stack.Screen
				options={{
					headerShown: true,
					headerTransparent: true,
					headerTitle: "",
					headerLeft: () => (
						<ChevronLeft
							size={28}
							color="#FFFFFF"
							onPress={handleBack}
							style={styles.backButton}
							accessibilityLabel={i18n.t("Common.back")}
							accessibilityRole="button"
						/>
					),
					headerStyle: { backgroundColor: "transparent" },
				}}
			/>
			<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
				<DishMediaMap entriesKey={entriesKey} idType="dish_media" />
			</LinearGradient>
		</>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1 },
	loadingContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	errorContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 24,
	},
	errorText: {
		fontSize: 16,
		color: "#6B7280",
		textAlign: "center",
	},
	backButton: {
		marginLeft: 16,
	},
});
