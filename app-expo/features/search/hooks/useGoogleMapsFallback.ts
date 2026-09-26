import { useCallback } from "react";
import { useDialog } from "@/contexts/DialogProvider";
import { useMapsEmbedModal } from "@/features/maps/hooks/useMapsEmbedModal";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { buildGoogleMapsSearchUrl } from "@/lib/googleMaps";

/**
 * #843 【設計】この退避導線が出た «理由»。**型で必須にしてある。**
 *
 * - `empty`        … 店提案が本当に 0 件だった（自社 DB にも無く、Google も «無い» と答えた）
 * - `fetch_failed` … 取得に失敗して 0 件のまま来た（Places の日次上限 429 など）。**探しにすら行けていない**
 *
 * ⚠️ **省略可能にしてはいけない。** 本番 30 日の実測で、このダイアログ 5,627 件のうち
 * 3,021 件（53.7%）は «同じユーザーが直前に bulk-import で 429 を受けている» ものだった。
 * 日ごとに見ると 09-11 以降は **ほぼ 100%** これである（09-26 は 87/87、09-25 は 107/107、
 * 09-20 は 202/202。一方 09-09 以前は 0 件）。つまりこの 1 つのイベントが
 * «この条件では店が無い»（= #843 が埋めるべき coverage）と
 * «我々の Google の枠が切れた»（= #1781 で «上げない» と決着済み）を混ぜており、
 * **#843 の進捗を測る当の指標が読めなくなっていた。**
 *
 * 必須にしてあるので、新しい呼び出し口は理由を決めないと typecheck が通らない。
 */
export type GoogleMapsFallbackReason = "empty" | "fetch_failed";

/**
 * #843 【設計】ストアの `errorByKey` から退避導線の理由を決める **唯一の場所**。
 *
 * `handleAsyncAction`（`useDishMediaEntriesStore`）は失敗を `.catch` で `errorByKey` へ立て、
 * **その後に** `.finally` で `isLoading` を false にする。したがって «0 件かつ非ロード中» の
 * 時点で `error` を読めば «取れなかった» と «無かった» を取り違えない。
 *
 * ⚠️ 呼び出し側で `error ? … : …` を手書きしないこと（同じ判定が 2 箇所に分かれた時点でずれる）。
 */
export const googleMapsFallbackReasonFor = (error: string | null | undefined): GoogleMapsFallbackReason =>
	error ? "fetch_failed" : "empty";

type GoogleMapsFallbackArgs = {
	reason: GoogleMapsFallbackReason;
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
 * （`useMapsEmbedModal` の `showMapsEmbedModal`、mode=search）。
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
		({ reason, entriesKey, category, location, locale }: GoogleMapsFallbackArgs) => {
			const hl = locale.split("-")[0];
			const url = buildGoogleMapsSearchUrl(category, location, { hl });

			logFrontendEvent({
				event_name: "google_maps_fallback_dialog_shown",
				// ⚠️ **`fetch_failed` でも `error` へ上げないこと。** #2070 / #2078 の «恒久的な
				// 自分側の失敗は error へ» に当てはまるように見えるが、いま `fetch_failed` の
				// ほぼ全件は #1781 で «枠は上げない» と決着済みの Text Search の日次上限である。
				// error へ上げると夜間 Error Triage が毎晩 «障害規模» で鳴り、#1946（本物の障害が
				// 38 件の中に埋もれて 6 日間気づかれなかった）を自分から作り直すことになる。
				error_level: "warn",
				payload: {
					// ⚠️ 既存の `reason` は dismissed 側が «閉じ方» に使っている名前なので、
					// 原因はどのイベントでも `fallbackReason` で揃える（片方だけ改名しない）
					fallbackReason: reason,
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
							fallbackReason: reason,
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
				onHide: (dismissReason) => {
					if (dismissReason !== "confirm") {
						logFrontendEvent({
							event_name: "google_maps_fallback_dismissed",
							error_level: "log",
							payload: {
								fallbackReason: reason,
								entriesKey,
								category,
								// ⚠️ この `reason` は «閉じ方»（dismiss の種別）で、以前からある名前。
								// 過去のクエリが読んでいるので意味を変えない
								reason: dismissReason,
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
