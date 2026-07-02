import { useCallback } from "react";
import * as Linking from "expo-linking";
import { useDialog } from "@/contexts/DialogProvider";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
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
 * search/result と group vote で同じ fallback 体験を再利用する。
 */
export function useGoogleMapsFallback({ source }: UseGoogleMapsFallbackParams) {
	const { showDialog } = useDialog();
	const { logFrontendEvent } = useLogger();

	const showGoogleMapsFallbackDialog = useCallback(
		({ entriesKey, category, location, locale }: GoogleMapsFallbackArgs) => {
			const url = buildGoogleMapsSearchUrl(category, location, {
				hl: locale.split("-")[0],
			});

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
								error_message: error instanceof Error ? error.message : String(error),
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
