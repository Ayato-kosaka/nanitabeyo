import { useCallback } from "react";
import { Linking, Platform } from "react-native";

import { Env } from "@/constants/Env";
import { useDialog } from "@/contexts/DialogProvider";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { openExternalUrl } from "@/lib/openExternalUrl";

/**
 * #611 ストアのレビュー画面へ送る導線。
 *
 * #1583 で «なに食べよ を応援する» として «なに食べよについて» ページへ移った。
 * profile/index.tsx に閉じていたロジックをそのまま出しただけで、ダイアログの文言・
 * ストア URL の選び方・フォールバックの順序はどれも変えていない。
 *
 * ⚠️ web には «ストア» が無いので、呼び出し側で `Platform.OS !== "web"` を見て
 *    行ごと出さないこと（このフック自体はプラットフォームを判定しない）。
 */
export function useStoreReview() {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { showDialog } = useDialog();
	const { showSnackbar } = useSnackbar();

	// #611 【設計】ストア直接遷移（market:// / itms-apps:// → https:// フォールバック）
	const openStoreReviewPage = useCallback(async () => {
		try {
			let primaryUrl: string;
			let fallbackUrl: string;

			if (Platform.OS === "ios") {
				// iOS: itms-apps:// を優先、不可なら https:// にフォールバック
				const appStoreUrl = Env.APP_STORE_URL;
				if (!appStoreUrl) {
					logFrontendEvent({
						event_name: "settings_leave_review_open_store_failed",
						error_level: "warn",
						payload: { platform: Platform.OS, reason: "missing_app_store_url" },
					});
					return;
				}
				// URL から App ID を抽出（例: https://apps.apple.com/app/id<APP_ID>）
				const appIdMatch = appStoreUrl.match(/id(\d+)/);
				if (appIdMatch) {
					primaryUrl = `itms-apps://apps.apple.com/app/id${appIdMatch[1]}?action=write-review`;
					fallbackUrl = `${appStoreUrl}?action=write-review`;
				} else {
					// App ID が見つからない場合は不正な URL と判断し、スキップ
					logFrontendEvent({
						event_name: "settings_leave_review_open_store_failed",
						error_level: "warn",
						payload: {
							platform: Platform.OS,
							reason: "invalid_app_store_url_format",
							appStoreUrl,
						},
					});
					return;
				}
			} else if (Platform.OS === "android") {
				// Android: market:// を優先、不可なら https:// にフォールバック
				const playStoreUrl = Env.PLAY_STORE_URL;
				if (!playStoreUrl) {
					logFrontendEvent({
						event_name: "settings_leave_review_open_store_failed",
						error_level: "warn",
						payload: { platform: Platform.OS, reason: "missing_play_store_url" },
					});
					return;
				}
				// URL からパッケージ名を抽出（例: https://play.google.com/store/apps/details?id=<package>）
				const packageMatch = playStoreUrl.match(/id=([^&]+)/);

				const packageName = packageMatch?.[1];
				// パッケージ名は Play Store の一般的なフォーマット（英数字・ドット・アンダースコア）のみ許可
				const isValidPackageName = typeof packageName === "string" && /^[A-Za-z0-9._]+$/.test(packageName);
				if (isValidPackageName) {
					primaryUrl = `market://details?id=${packageName}&showAllReviews=true`;
					fallbackUrl = `https://play.google.com/store/apps/details?id=${packageName}&showAllReviews=true`;
				} else {
					// パッケージ名が抽出・検証できない場合は不正な URL で遷移しないようにスキップ
					logFrontendEvent({
						event_name: "settings_leave_review_open_store_failed",
						error_level: "warn",
						payload: {
							platform: Platform.OS,
							reason: "invalid_play_store_url_format",
							playStoreUrl,
						},
					});
					return;
				}
			} else {
				// web など他のプラットフォームでは何もしない
				logFrontendEvent({
					event_name: "settings_leave_review_open_store_skipped",
					error_level: "log",
					payload: { platform: Platform.OS, reason: "unsupported_platform" },
				});
				return;
			}

			// 優先 URL を試し、開けなければフォールバック
			const canOpenPrimary = await Linking.canOpenURL(primaryUrl);
			const urlToOpen = canOpenPrimary ? primaryUrl : fallbackUrl;

			// #1121 外部遷移は openExternalUrl へ統一する。
			// ここは上で web を早期 return しているので実行されるのはネイティブのみ
			await openExternalUrl(urlToOpen);

			logFrontendEvent({
				event_name: "settings_leave_review_open_store_success",
				error_level: "log",
				payload: { url: urlToOpen },
			});
		} catch (error) {
			logFrontendEvent({
				event_name: "settings_leave_review_open_store_error",
				error_level: "error",
				payload: { error: (error as Error).message },
			});
			showSnackbar(i18n.t("Common.error"));
		}
	}, [logFrontendEvent, showSnackbar]);

	// #611 【設計】満足度確認ダイアログ → OK で openStoreReviewPage()
	const handleLeaveReview = useCallback(async () => {
		lightImpact();
		logFrontendEvent({
			event_name: "settings_leave_review_pressed",
			error_level: "log",
			payload: {},
		});

		showDialog(i18n.t("Settings.rateDialogMessage"), {
			title: i18n.t("Settings.rateDialogTitle"),
			okLabel: i18n.t("Settings.rateDialogOk"),
			cancelLabel: i18n.t("Common.cancel"),
			onConfirm: async () => {
				logFrontendEvent({
					event_name: "settings_leave_review_confirmed",
					error_level: "log",
					payload: {},
				});
				await openStoreReviewPage();
			},
		});
	}, [lightImpact, logFrontendEvent, showDialog, openStoreReviewPage]);

	return { handleLeaveReview };
}
