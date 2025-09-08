import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, Image, Alert } from "react-native";
import { useAPICall } from "@/hooks/useAPICall";
import { useCursorPagination } from "@/features/profile/hooks/useCursorPagination";
import { useLogger } from "@/hooks/useLogger";
import type {
	CreateRestaurantDto,
	QueryRestaurantsByGooglePlaceIdDto,
	QueryRestaurantDishMediaDto,
} from "@shared/api/v1/dto";
import type {
	CreateRestaurantResponse,
	QueryRestaurantsByGooglePlaceIdResponse,
	QueryRestaurantDishMediaResponse,
} from "@shared/api/v1/res";
import i18n from "@/lib/i18n";

interface RestaurantManagerProps {
	googlePlaceId: string;
	languageCode?: string;
	onRestaurantLoaded?: (restaurant: CreateRestaurantResponse) => void;
	onDishMediaLoaded?: (dishMedia: QueryRestaurantDishMediaResponse["data"]) => void;
}

/**
 * RestaurantManager handles restaurant creation/retrieval and dish media management
 * Following the sequence diagram workflow from the user requirements
 */
export function RestaurantManager({
	googlePlaceId,
	languageCode = "ja",
	onRestaurantLoaded,
	onDishMediaLoaded,
}: RestaurantManagerProps) {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	
	const [restaurant, setRestaurant] = useState<CreateRestaurantResponse | null>(null);
	const [isLoadingRestaurant, setIsLoadingRestaurant] = useState(false);
	const [restaurantError, setRestaurantError] = useState<string | null>(null);

	// Restaurant creation/retrieval workflow
	const createOrGetRestaurant = useCallback(async () => {
		if (!googlePlaceId) return;
		
		setIsLoadingRestaurant(true);
		setRestaurantError(null);
		
		try {
			// First, try to find existing restaurant by Google Place ID
			logFrontendEvent({
				event_name: "restaurant_lookup_started",
				error_level: "debug",
				payload: { googlePlaceId },
			});

			let existingRestaurant: QueryRestaurantsByGooglePlaceIdResponse | null = null;
			try {
				existingRestaurant = await callBackend<
					QueryRestaurantsByGooglePlaceIdDto,
					QueryRestaurantsByGooglePlaceIdResponse
				>("v1/restaurants/by-google-place-id", {
					method: "GET",
					requestPayload: { googlePlaceId },
				});
			} catch (error: any) {
				// If restaurant doesn't exist, we'll create it below
				if (error?.status !== 404) {
					throw error;
				}
			}

			let finalRestaurant: CreateRestaurantResponse;

			if (existingRestaurant) {
				// Restaurant exists, use it
				logFrontendEvent({
					event_name: "restaurant_found",
					error_level: "log",
					payload: { restaurantId: existingRestaurant.id, googlePlaceId },
				});
				
				// Convert to CreateRestaurantResponse format (add review stats)
				finalRestaurant = {
					...existingRestaurant,
					reviewCount: 0, // Will be populated if needed
					averageRating: 0, // Will be populated if needed
				};
			} else {
				// Restaurant doesn't exist, create it
				logFrontendEvent({
					event_name: "restaurant_creation_started",
					error_level: "debug",
					payload: { googlePlaceId, languageCode },
				});

				finalRestaurant = await callBackend<CreateRestaurantDto, CreateRestaurantResponse>(
					"v1/restaurants",
					{
						method: "POST",
						requestPayload: { googlePlaceId, languageCode },
					}
				);

				logFrontendEvent({
					event_name: "restaurant_created",
					error_level: "log",
					payload: { restaurantId: finalRestaurant.id, googlePlaceId },
				});
			}

			setRestaurant(finalRestaurant);
			onRestaurantLoaded?.(finalRestaurant);
			
		} catch (error: any) {
			const errorMessage = error?.message || "Failed to load restaurant";
			setRestaurantError(errorMessage);
			
			logFrontendEvent({
				event_name: "restaurant_operation_error",
				error_level: "error",
				payload: { error: errorMessage, googlePlaceId },
			});
			
			Alert.alert(
				i18n.t("Error.title"),
				i18n.t("Restaurant.errors.loadFailed"),
				[{ text: i18n.t("Common.ok") }]
			);
		} finally {
			setIsLoadingRestaurant(false);
		}
	}, [googlePlaceId, languageCode, callBackend, logFrontendEvent, onRestaurantLoaded]);

	// Dish media pagination hook
	const {
		items: dishMediaItems,
		loadInitial: loadInitialDishMedia,
		loadMore: loadMoreDishMedia,
		refresh: refreshDishMedia,
		error: dishMediaError,
		isLoadingInitial: isLoadingInitialDishMedia,
		isLoadingMore: isLoadingMoreDishMedia,
	} = useCursorPagination<
		QueryRestaurantDishMediaDto,
		QueryRestaurantDishMediaResponse["data"][number]
	>(
		useCallback(
			async ({ cursor }) => {
				if (!restaurant?.id) {
					throw new Error("Restaurant not loaded yet");
				}

				const response = await callBackend<QueryRestaurantDishMediaDto, QueryRestaurantDishMediaResponse>(
					`v1/restaurants/${restaurant.id}/dish-media`,
					{
						method: "GET",
						requestPayload: cursor ? { cursor } : {},
					}
				);

				logFrontendEvent({
					event_name: "dish_media_loaded",
					error_level: "log",
					payload: { 
						restaurantId: restaurant.id, 
						count: response.data?.length || 0,
						cursor 
					},
				});

				return {
					data: response.data || [],
					nextCursor: response.nextCursor,
				};
			},
			[callBackend, restaurant?.id, logFrontendEvent]
		)
	);

	// Load restaurant when component mounts or googlePlaceId changes
	useEffect(() => {
		createOrGetRestaurant();
	}, [createOrGetRestaurant]);

	// Load dish media when restaurant is loaded
	useEffect(() => {
		if (restaurant) {
			loadInitialDishMedia();
		}
	}, [restaurant, loadInitialDishMedia]);

	// Notify parent when dish media is loaded
	useEffect(() => {
		if (dishMediaItems.length > 0) {
			onDishMediaLoaded?.(dishMediaItems);
		}
	}, [dishMediaItems, onDishMediaLoaded]);

	const renderDishMediaItem = ({ item }: { item: QueryRestaurantDishMediaResponse["data"][number] }) => (
		<TouchableOpacity style={styles.dishMediaItem}>
			<Image source={{ uri: item.signedUrl }} style={styles.dishMediaImage} />
			<View style={styles.dishMediaOverlay}>
				<Text style={styles.dishName} numberOfLines={1}>
					{item.dish?.name || "Unknown Dish"}
				</Text>
				<View style={styles.dishStats}>
					<Text style={styles.dishRating}>
						★ {item.dish?.averageRating?.toFixed(1) || "0.0"}
					</Text>
					<Text style={styles.dishReviews}>
						({item.dish?.reviewCount || 0})
					</Text>
				</View>
			</View>
		</TouchableOpacity>
	);

	if (isLoadingRestaurant) {
		return (
			<View style={styles.loadingContainer}>
				<ActivityIndicator size="large" color="#007AFF" />
				<Text style={styles.loadingText}>{i18n.t("Restaurant.loading.restaurant")}</Text>
			</View>
		);
	}

	if (restaurantError) {
		return (
			<View style={styles.errorContainer}>
				<Text style={styles.errorText}>{restaurantError}</Text>
				<TouchableOpacity style={styles.retryButton} onPress={createOrGetRestaurant}>
					<Text style={styles.retryButtonText}>{i18n.t("Common.retry")}</Text>
				</TouchableOpacity>
			</View>
		);
	}

	if (!restaurant) {
		return null;
	}

	return (
		<View style={styles.container}>
			{/* Restaurant Info Header */}
			<View style={styles.restaurantHeader}>
				<Text style={styles.restaurantName}>{restaurant.name}</Text>
				<Text style={styles.restaurantStats}>
					★ {restaurant.averageRating?.toFixed(1) || "0.0"} • {restaurant.reviewCount || 0} reviews
				</Text>
			</View>

			{/* Dish Media Grid */}
			<View style={styles.dishMediaContainer}>
				<Text style={styles.dishMediaTitle}>
					{i18n.t("Restaurant.dishMedia.title")} ({dishMediaItems.length})
				</Text>
				
				{isLoadingInitialDishMedia ? (
					<View style={styles.loadingContainer}>
						<ActivityIndicator size="small" color="#007AFF" />
						<Text style={styles.loadingText}>{i18n.t("Restaurant.loading.dishMedia")}</Text>
					</View>
				) : dishMediaError ? (
					<View style={styles.errorContainer}>
						<Text style={styles.errorText}>{dishMediaError}</Text>
						<TouchableOpacity style={styles.retryButton} onPress={refreshDishMedia}>
							<Text style={styles.retryButtonText}>{i18n.t("Common.retry")}</Text>
						</TouchableOpacity>
					</View>
				) : (
					<FlatList
						data={dishMediaItems}
						renderItem={renderDishMediaItem}
						numColumns={3}
						keyExtractor={(item) => item.id}
						onEndReached={loadMoreDishMedia}
						onEndReachedThreshold={0.5}
						ListFooterComponent={
							isLoadingMoreDishMedia ? (
								<ActivityIndicator size="small" color="#007AFF" style={styles.loadMoreIndicator} />
							) : null
						}
						contentContainerStyle={styles.dishMediaGrid}
						columnWrapperStyle={styles.dishMediaRow}
					/>
				)}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	loadingContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		padding: 20,
	},
	loadingText: {
		marginTop: 10,
		fontSize: 14,
		color: "#666",
	},
	errorContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		padding: 20,
	},
	errorText: {
		fontSize: 14,
		color: "#FF3B30",
		textAlign: "center",
		marginBottom: 16,
	},
	retryButton: {
		backgroundColor: "#007AFF",
		paddingHorizontal: 20,
		paddingVertical: 10,
		borderRadius: 8,
	},
	retryButtonText: {
		color: "#FFF",
		fontSize: 14,
		fontWeight: "600",
	},
	restaurantHeader: {
		padding: 16,
		borderBottomWidth: 1,
		borderBottomColor: "#E5E5E5",
	},
	restaurantName: {
		fontSize: 18,
		fontWeight: "bold",
		color: "#000",
		marginBottom: 4,
	},
	restaurantStats: {
		fontSize: 14,
		color: "#666",
	},
	dishMediaContainer: {
		flex: 1,
	},
	dishMediaTitle: {
		fontSize: 16,
		fontWeight: "600",
		color: "#000",
		padding: 16,
		paddingBottom: 8,
	},
	dishMediaGrid: {
		padding: 2,
	},
	dishMediaRow: {
		justifyContent: "space-between",
	},
	dishMediaItem: {
		width: "31%",
		aspectRatio: 1,
		margin: 1,
		position: "relative",
	},
	dishMediaImage: {
		width: "100%",
		height: "100%",
		borderRadius: 8,
	},
	dishMediaOverlay: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		backgroundColor: "rgba(0, 0, 0, 0.7)",
		padding: 6,
		borderBottomLeftRadius: 8,
		borderBottomRightRadius: 8,
	},
	dishName: {
		fontSize: 10,
		color: "#FFF",
		fontWeight: "600",
		marginBottom: 2,
	},
	dishStats: {
		flexDirection: "row",
		alignItems: "center",
	},
	dishRating: {
		fontSize: 8,
		color: "#FFD700",
		fontWeight: "600",
	},
	dishReviews: {
		fontSize: 8,
		color: "#FFF",
		marginLeft: 4,
	},
	loadMoreIndicator: {
		padding: 16,
	},
});