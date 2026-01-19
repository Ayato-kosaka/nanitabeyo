import { useCallback } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import { getGoogleMapsLink } from "@/lib/googlePlaces";
import { generateShareUrl, handleShare } from "@/lib/share";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useHaptics } from "@/hooks/useHaptics";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import i18n from "@/lib/i18n";
import type { SupabaseRestaurants } from "@shared/converters/convert_restaurants";

// #613 【設計】DishMedia の押下処理を hooks に切り出して共通化
interface UseDishMediaActionsProps {
	source: string; // #613 【設計】どのコンポーネントから呼ばれたかを識別
}

export function useDishMediaActions({ source }: UseDishMediaActionsProps) {
	const { lightImpact } = useHaptics();
	const { showSnackbar } = useSnackbar();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

	// #613 【設計】Google Maps で開く処理を共通化（緯度経度優先）
	const openInGoogleMaps = useCallback(
		async ({
			dishMediaId,
			restaurant,
		}: {
			dishMediaId: string;
			restaurant: Pick<SupabaseRestaurants, "id" | "name" | "google_place_id">;
		}) => {
			lightImpact();

			logFrontendEvent({
				event_name: "map_pin_clicked",
				error_level: "log",
				payload: {
					restaurantId: restaurant.id,
					googlePlaceId: restaurant.google_place_id,
					fromDishMediaId: dishMediaId,
					source, // #613 【設計】呼び出し元を記録
				},
			});

			try {
				const { mapUrl, canOpen } = await getGoogleMapsLink(restaurant);
				if (Platform.OS === "web") {
					window.open(mapUrl, "_blank", "noopener,noreferrer");
					return;
				}
				if (canOpen) {
					await Linking.openURL(mapUrl);
				} else {
					showSnackbar(i18n.t("DishMediaContent.errors.mapOpenFailed"));
				}
			} catch (error) {
				showSnackbar(i18n.t("DishMediaContent.errors.mapOpenFailed"));
				logFrontendEvent({
					event_name: "map_pin_open_failed",
					error_level: "error",
					payload: {
						restaurantId: restaurant.id,
						googlePlaceId: restaurant.google_place_id,
						error: error instanceof Error ? error.message : "Unknown error",
						source, // #613 【設計】呼び出し元を記録
					},
				});
			}
		},
		[lightImpact, logFrontendEvent, showSnackbar, source],
	);

	// #613 【設計】友人に共有する処理を共通化
	// #659 【設計】idsForShare 追加: 複数メディアの共有に対応
	const shareRestaurant = useCallback(
		async ({
			dishMediaId,
			restaurant,
			idsForShare,
		}: {
			dishMediaId: string;
			restaurant: Pick<SupabaseRestaurants, "id" | "name">;
			idsForShare?: string[]; // #659 【設計】複数共有用のID配列（オプショナル）
		}) => {
			lightImpact();

			try {
				// #659 【設計】idsForShare がある場合は複数ID、なければ単体
				const idsParam = idsForShare?.length ? idsForShare.join(",") : dishMediaId;
				const shareUrl = generateShareUrl(`/${locale}/posts?ids=${idsParam}`);

				logFrontendEvent({
					event_name: "dish_share_attempted",
					error_level: "log",
					payload: {
						dishMediaId: dishMediaId,
						restaurantId: restaurant.id,
						shareUrl,
						idsForShare, // #659 【設計】idsForShare をログに記録
						source, // #613 【設計】呼び出し元を記録
					},
				});

				await handleShare(
					shareUrl,
					i18n.t("DishMediaContent.share.title", { dishName: restaurant.name }),
					() => {
						logFrontendEvent({
							event_name: "dish_share_success",
							error_level: "log",
							payload: {
								dishMediaId: dishMediaId,
								restaurantId: restaurant.id,
								shareUrl,
								idsForShare, // #659 【設計】idsForShare をログに記録
								source, // #613 【設計】呼び出し元を記録
							},
						});
					},
					(error) => {
						logFrontendEvent({
							event_name: "dish_share_failed",
							error_level: "error",
							payload: {
								dishMediaId: dishMediaId,
								restaurantId: restaurant.id,
								shareUrl,
								idsForShare, // #659 【設計】idsForShare をログに記録
								error,
								source, // #613 【設計】呼び出し元を記録
							},
						});
					},
					showSnackbar,
				);
			} catch (error) {
				logFrontendEvent({
					event_name: "dish_share_error",
					error_level: "error",
					payload: {
						dishMediaId: dishMediaId,
						restaurantId: restaurant.id,
						error: error instanceof Error ? error.message : "Unknown error",
						source, // #613 【設計】呼び出し元を記録
					},
				});
			}
		},
		[locale, lightImpact, logFrontendEvent, showSnackbar, source],
	);

	return {
		openInGoogleMaps,
		shareRestaurant,
	};
}
