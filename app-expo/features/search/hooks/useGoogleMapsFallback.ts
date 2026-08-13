import { useCallback } from "react";
import { useDialog } from "@/contexts/DialogProvider";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { buildGoogleMapsSearchUrl } from "@/lib/googleMaps";
import { openExternalUrl } from "@/lib/openExternalUrl";

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
						// #1121 Web は別タブで開く。同一タブ遷移だと SPA を離脱し、戻ったときに画面が壊れる
						await openExternalUrl(url);
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
