import React, { useEffect, useState } from "react";
import { View, StyleSheet, ActivityIndicator, TouchableOpacity, Text } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { ReviewForm } from "@/features/map/components/ReviewForm";
import { useRestaurantStore, type RestaurantEntry } from "@/features/review/stores/useRestaurantStore";
import {
	NormalizedDishMediaEntry,
	selectEntryByMediaId,
	useDishMediaEntriesStore,
} from "@/stores/useDishMediaEntriesStore";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLogger } from "@/hooks/useLogger";
import type { GetRestaurantByIdResponse, QueryDishMediaByIdsResponse } from "@shared/api/v1/res";
import i18n from "@/lib/i18n";
import { QueryDishMediaByIdsDto } from "@shared/api/v1/dto";

export default function ReviewFromMediaScreen() {
	const { restaurantId, dishMediaId } = useLocalSearchParams<{ restaurantId: string; dishMediaId: string }>();
	const { lightImpact } = useHaptics();
	const { callBackend } = useAPICall();
	const { showSnackbar } = useSnackbar();
	const { logFrontendEvent } = useLogger();

	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [restaurantEntry, setRestaurantEntry] = useState<RestaurantEntry | undefined>(undefined);
	const [dishMedia, setDishMedia] = useState<NormalizedDishMediaEntry | null>(null);

	// #644 【設計】restaurant.id と dishMediaId でデータを取得
	useEffect(() => {
		if (!restaurantId || !dishMediaId) return;

		// Restaurant 情報取得（ストアキャッシュ優先）
		const { getById, upsert } = useRestaurantStore.getState();
		const restaurantCached = getById(restaurantId);

		// DishMedia 情報取得（ストアキャッシュ優先）
		const dishMediaEntriesStore = useDishMediaEntriesStore.getState();
		const mediaEntryCached = selectEntryByMediaId(dishMediaId)(dishMediaEntriesStore);
		if (restaurantCached && mediaEntryCached) {
			// 両方キャッシュがあれば即座に表示
			setRestaurantEntry(restaurantCached);
			setDishMedia(mediaEntryCached);
			return;
		}

		// キャッシュがない場合は最新情報を取得して更新
		const fetchData = async () => {
			setIsLoading(true);

			try {
				// restaurant 情報取得
				const restaurantEntry = await callBackend<Record<string, never>, GetRestaurantByIdResponse>(
					`v1/restaurants/${restaurantId}`,
					{
						method: "GET",
						requestPayload: {},
					},
				).then((response) => ({
					restaurant: response.restaurant,
					meta: response.meta,
				}));
				upsert(restaurantEntry);
				setRestaurantEntry(restaurantEntry);

				// dishMedia 情報取得
				const dishMediaEntries = await callBackend<QueryDishMediaByIdsDto, QueryDishMediaByIdsResponse>(
					"v1/dish-media",
					{
						method: "GET",
						requestPayload: { ids: [dishMediaId] },
					},
				).then((response) => response.items);
				dishMediaEntriesStore.upsertDishMediaEntries(dishMediaEntries);
				const normalizedEntry = selectEntryByMediaId(dishMediaId)(useDishMediaEntriesStore.getState());
				setDishMedia(normalizedEntry);

				setError(null);

				logFrontendEvent({
					event_name: "review_from_media_screen_loaded",
					error_level: "log",
					payload: { restaurantId, dishMediaId },
				});
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Failed to load data";
				setError(errorMessage);
				showSnackbar(i18n.t("Common.errors.unexpected"));

				logFrontendEvent({
					event_name: "review_from_media_screen_load_error",
					error_level: "error",
					payload: { restaurantId, dishMediaId, error: errorMessage },
				});
			} finally {
				setIsLoading(false);
			}
		};

		fetchData();
	}, [restaurantId, dishMediaId, callBackend, showSnackbar, logFrontendEvent]);

	// #644 【設計】ローディング表示
	if (isLoading) {
		return (
			<SafeAreaView edges={["top"]} style={styles.container}>
				<View style={styles.headerContainer}>
					<TouchableOpacity
						style={styles.backButton}
						onPress={() => {
							lightImpact();
							router.back();
						}}>
						<ChevronLeft size={24} color="#1A1A1A" />
					</TouchableOpacity>
					<Text style={styles.headerTitle}>{i18n.t("Review.title")}</Text>
					<View style={styles.headerRightSpacer} />
				</View>
				<View style={styles.loadingContainer}>
					<ActivityIndicator size="large" color="#5EA2FF" />
				</View>
			</SafeAreaView>
		);
	}

	// #644 【設計】エラー表示
	if (error || !restaurantEntry || !dishMedia) {
		return (
			<SafeAreaView edges={["top"]} style={styles.container}>
				<View style={styles.headerContainer}>
					<TouchableOpacity
						style={styles.backButton}
						onPress={() => {
							lightImpact();
							router.back();
						}}>
						<ChevronLeft size={24} color="#1A1A1A" />
					</TouchableOpacity>
					<Text style={styles.headerTitle}>{i18n.t("Review.title")}</Text>
					<View style={styles.headerRightSpacer} />
				</View>
				<View style={styles.errorContainer}>
					<Text style={styles.errorText}>{i18n.t("Common.errors.notFound")}</Text>
				</View>
			</SafeAreaView>
		);
	}

	return (
		<SafeAreaView edges={["top", "bottom"]} style={styles.container}>
			<View style={styles.headerContainer}>
				<TouchableOpacity
					style={styles.backButton}
					onPress={() => {
						lightImpact();
						router.back();
					}}>
					<ChevronLeft size={24} color="#1A1A1A" />
				</TouchableOpacity>
				<Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">
					{restaurantEntry.restaurant.name}
				</Text>
				<View style={styles.headerRightSpacer} />
			</View>

			{/* #644 【設計】ReviewForm を既存メディア利用モード（prefilledMedia）で表示 */}
			<ReviewForm
				restaurant={restaurantEntry.restaurant}
				prefilledMedia={{ ...dishMedia.dish_media, dish: dishMedia.dish }}
				onCancel={() => router.back()}
			/>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#FFFFFF",
	},
	headerContainer: {
		backgroundColor: "#FFFFFF",
		paddingVertical: 16,
		paddingHorizontal: 16,
		borderBottomWidth: 1,
		borderBottomColor: "#E5E7EB",
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
	},
	backButton: {
		padding: 4,
		marginRight: 8,
	},
	headerTitle: {
		fontSize: 18,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
		flex: 1,
	},
	headerRightSpacer: {
		width: 32,
	},
	loadingContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	errorContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		padding: 16,
	},
	errorText: {
		fontSize: 16,
		color: "#666",
		textAlign: "center",
	},
});
