import { useCallback } from "react";
import { useDialog } from "@/contexts/DialogProvider";
import { useMapsEmbedModal } from "@/contexts/MapsEmbedModalProvider";
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
 * #843【設計】確認後に開くのは外部ブラウザではなく、アプリ内地図
 * （`MapsEmbedModalProvider` の `showMapsEmbedModal`、mode=search）。
 * Google Maps アプリ/ブラウザへの外部遷移は、埋め込みが使えない/失敗したときの
 * 退避として `MapsEmbedModal` の中に残る（外へは出さない）。
 *
 * ダイアログの表示・dismiss ログを 1 か所に閉じることで、
 * search/result と group vote で同じ fallback 体験を再利用する。
 */
export function useGoogleMapsFallback({ source }: UseGoogleMapsFallbackParams) {
	const { showDialog } = useDialog();
	const { showMapsEmbedModal } = useMapsEmbedModal();
	const { logFrontendEvent } = useLogger();

	const showGoogleMapsFallbackDialog = useCallback(
		({ entriesKey, category, location, locale }: GoogleMapsFallbackArgs) => {
			const hl = locale.split("-")[0];
			const url = buildGoogleMapsSearchUrl(category, location, { hl });

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
				onConfirm: () => {
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
					showMapsEmbedModal({
						mode: "search",
						q: category,
						center: location,
						hl,
						title: category,
						externalUrl: url,
						source,
					});
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
		[logFrontendEvent, showDialog, showMapsEmbedModal, source],
	);

	return { showGoogleMapsFallbackDialog };
}
