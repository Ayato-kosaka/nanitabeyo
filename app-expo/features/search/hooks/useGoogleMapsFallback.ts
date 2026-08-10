import { useCallback } from "react";
import * as Linking from "expo-linking";
import { useDialog } from "@/contexts/DialogProvider";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { buildGoogleMapsSearchUrl } from "@/lib/googleMaps";

type GoogleMapsFallbackArgs = {
	entriesKey?: string;
	category: string;
	location: {
		latitude: number;
		longitude: number;
	};
	locale: string;
};

type UseGoogleMapsFallbackParams = {
	source: string;
};

/**
 * 検索結果が 0 件のときの Google Maps fallback ダイアログを扱う。
 *
 * ダイアログの表示、openURL、dismiss ログを 1 か所に閉じることで、
 * 同じ fallback 体験を各画面で再利用する。呼び出し元は 3 つ（#1243 レビュー Major-1 / 2026-08-10 時点）:
 *   - app/[locale]/(tabs)/search/result.tsx（source: search_result_screen）
 *   - features/dishCategoryGroupVotes/hooks/useCandidateDishMediaCache.ts
 *     （source: dish_category_group_vote_result_screen）
 *   - app/[locale]/(tabs)/profile/search-results.tsx（source: profile_search_result_screen。#1243 で追加）
 */
export function useGoogleMapsFallback({ source }: UseGoogleMapsFallbackParams) {
	const { showDialog } = useDialog();
	const { logFrontendEvent } = useLogger();

	const showGoogleMapsFallbackDialog = useCallback(
		({ entriesKey, category, location, locale }: GoogleMapsFallbackArgs) => {
			const url = buildGoogleMapsSearchUrl(category, location, {
				hl: locale.split("-")[0],
			});

			// #1196 【設計】このログは「ユーザーが行き止まりになった」印ではなく、
			// **退避導線が正常に提示された**印。次にこのログを見た人が誤解しないように明記する。
			//
			// 出る条件は 2 つあり、どちらも warn のままにしている（#1196 で条件は変えていない）:
			//   (1) 検索結果 0 件（そもそも該当店舗が無い。異常ではない）
			//   (2) v1/dishes/bulk-import の失敗（#1196 以降は上流クォータ枯渇で 429）。
			//       store が 0 件のままになるので search/result.tsx と profile/search-results.tsx が
			//       (1) と同じ判定でここへ来る（後者は #1243 で追加）。
			// 実測（BigQuery）でも (2) の失敗 340 件／125 人に対しこのログが 340 件／125 人と一致し、
			// うち 115 人（92%）が実際に Google Maps を開いている。**ユーザーは行き止まりになっていない。**
			logFrontendEvent({
				event_name: "google_maps_fallback_dialog_shown",
				error_level: "warn",
				payload: {
					entriesKey,
					category,
					latitude: location.latitude,
					longitude: location.longitude,
					source,
				},
			});

			showDialog(i18n.t("Search.googleMapsFallback.message"), {
				okLabel: i18n.t("Search.googleMapsFallback.confirm"),
				cancelLabel: i18n.t("Search.googleMapsFallback.cancel"),
				onConfirm: async () => {
					try {
						await Linking.openURL(url);
						logFrontendEvent({
							event_name: "google_maps_fallback_opened",
							error_level: "log",
							payload: {
								entriesKey,
								category,
								latitude: location.latitude,
								longitude: location.longitude,
								source,
							},
						});
					} catch (error) {
						logFrontendEvent({
							event_name: "google_maps_fallback_open_failed",
							error_level: "error",
							payload: {
								entriesKey,
								category,
								// #1092 PR4b 置換前は (B) なので message 側へ寄せる（Error は message のみで非回帰）
								error_message: toErrorLogMessage(error),
								source,
							},
						});
					}
				},
				onHide: (reason) => {
					if (reason !== "confirm") {
						logFrontendEvent({
							event_name: "google_maps_fallback_dismissed",
							error_level: "log",
							payload: {
								entriesKey,
								category,
								reason,
								source,
							},
						});
					}
				},
			});

			return url;
		},
		[logFrontendEvent, showDialog, source],
	);

	return { showGoogleMapsFallbackDialog };
}
