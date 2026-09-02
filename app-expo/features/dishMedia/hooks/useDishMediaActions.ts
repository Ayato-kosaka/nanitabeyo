import { useCallback, useRef } from "react";
import { Platform } from "react-native";
import { getGoogleMapsLink } from "@/lib/googlePlaces";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { generateShareUrl, handleShare } from "@/lib/share";
import { createShareLink } from "@/lib/createShareLink";
import { useAPICall } from "@/hooks/useAPICall";
import { resolvePublicLocale } from "@/constants/seoLocales";
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
	const { callBackend } = useAPICall();

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
				// #1121 Web の別タブ起動は openExternalUrl へ寄せた。
				// canOpen（Linking.canOpenURL）はネイティブのハンドラ有無の判定なので Web では見ない
				if (Platform.OS !== "web" && !canOpen) {
					showSnackbar(i18n.t("DishMediaContent.errors.mapOpenFailed"));
					return;
				}
				await openExternalUrl(mapUrl);
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
	/**
	 * #1205 【修正】共有処理が走っている dish_media の id。多重実行を同期的に弾く。
	 *
	 * `shareRestaurant` は `createShareLink`（POST /v1/share-links）を呼ぶので、
	 * 連打すると **同じ投稿に対する share_links の行が 2 本できる**。
	 * このフックには表示用の state すら無く、呼び出し側のボタンにも disabled が無いため、
	 * ここで弾かないと止まる場所がどこにもない。
	 *
	 * 単一の boolean にせず **id ごとの Set** にしているのは、投稿一覧では別々の投稿の
	 * 共有ボタンが同時に存在するため。boolean だと「A を共有中は B も押せない」になる。
	 *
	 * 解除は finally の 1 箇所（成功・失敗・例外のいずれでも通る）。
	 */
	const sharingIdsRef = useRef<Set<string>>(new Set());

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
			// #1205 この投稿の共有が進行中なら何もしない（宣言箇所のコメント参照）。
			// haptics より前に弾く（押しても無反応に見えるより、振動しない方が自然）
			if (sharingIdsRef.current.has(dishMediaId)) return;
			sharingIdsRef.current.add(dishMediaId);

			lightImpact();

			try {
				// #659 【設計】idsForShare がある場合は複数ID、なければ単体
				const ids = idsForShare?.length ? idsForShare : [dishMediaId];

				// #721 共有カードに «投稿ごとの» タイトルとサムネイルを出すため、
				// 共有 URL を /s/:token へ移す。Web は output: "static" なので、
				// `?ids=` に応じて初回 HTML の OGP を変えられない（クローラは初回 HTML しか見ない）。
				//
				// 発行に失敗しても共有そのものは止めない。既存形式へ落とすと OGP は既定に戻るが、
				// 着地する画面は同じ（`?ids=` は後方互換で残してある）。
				// 「共有ボタンを押したのに何も起きない」方が損失が大きい
				const shareUrl =
					(await createShareLink(callBackend, {
						target: { type: "dish_media", params: { ids } },
						locale: resolvePublicLocale(locale),
					} as never)) ?? generateShareUrl(`/${locale}/posts?ids=${ids.join(",")}`);

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
			} finally {
				// #1205 失敗しても押し直せるよう、成功・失敗・例外のいずれでも必ず解除する
				sharingIdsRef.current.delete(dishMediaId);
			}
		},
		[locale, lightImpact, logFrontendEvent, showSnackbar, source, callBackend],
	);

	return {
		openInGoogleMaps,
		shareRestaurant,
	};
}
