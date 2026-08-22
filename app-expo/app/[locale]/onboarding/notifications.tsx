/*
このファイルの責務
- #1486 §6 通知許可の説明画面。表示と同時に OS の許可ダイアログを出す。
- 答えが出たら Welcome 画面へ進む。

この画面へ来るのは **ログイン済みユーザーだけ**（振り分けは location.tsx が行う）。
ログインをスキップした人には、このオンボーディング中は通知許可を要求しない。
*/
import React, { useCallback } from "react";
import { router } from "expo-router";
import type { ExternalPathString } from "expo-router";

import { OnboardingPermissionScreen } from "@/features/onboarding/components/OnboardingPermissionScreen";
import { OnboardingScreenOptions } from "@/features/onboarding/components/OnboardingScreenOptions";
import { onboardingWelcomePath } from "@/features/onboarding/navigation";
import { requestNotificationPermission, type PermissionOutcome } from "@/features/onboarding/permissions";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";

export default function OnboardingNotificationsScreen() {
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();

	const handleSettled = useCallback(
		(outcome: PermissionOutcome) => {
			logFrontendEvent({
				event_name: "onboarding_notification_permission_settled",
				error_level: "log",
				payload: { outcome },
			});

			router.replace(onboardingWelcomePath(locale) as ExternalPathString);
		},
		[locale, logFrontendEvent],
	);

	return (
		<>
			<OnboardingScreenOptions />
			<OnboardingPermissionScreen
				title={i18n.t("Onboarding.notifications.title")}
				body={i18n.t("Onboarding.notifications.body")}
				progress={0.8}
				request={requestNotificationPermission}
				onSettled={handleSettled}
				testID="onboarding-notifications"
			/>
		</>
	);
}
