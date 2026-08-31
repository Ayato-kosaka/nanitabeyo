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
import { rememberOnboardingPermissionOutcome } from "@/features/onboarding/permissionOutcomes";
import {
	getNotificationPermissionState,
	requestNotificationPermission,
	type PermissionOutcome,
} from "@/features/onboarding/permissions";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";

export default function OnboardingNotificationsScreen() {
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();

	const handleSettled = useCallback(
		(outcome: PermissionOutcome) => {
			// #1736 断られたことを覚えておく。オンボーディングを抜けた瞬間に effect が張り直される
			// components/PushTokenRegistration.tsx が、この直後に説明の無い許可ダイアログを
			// 続けて出さないようにするため（features/onboarding/permissionOutcomes.ts）
			rememberOnboardingPermissionOutcome("notifications", outcome);

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
				probe={getNotificationPermissionState}
				request={requestNotificationPermission}
				// 中央に置く iOS 通知ダイアログのダミー。2 択なので実物どおり横並びになり、
				// おすすめの「許可」を強調する
				dialogPreview={{
					title: i18n.t("Onboarding.notifications.dialog.title"),
					message: i18n.t("Onboarding.notifications.dialog.message"),
					buttons: [
						{ label: i18n.t("Onboarding.notifications.dialog.deny") },
						{ label: i18n.t("Onboarding.notifications.dialog.allow"), emphasized: true },
					],
				}}
				onSettled={handleSettled}
				testID="onboarding-notifications"
			/>
		</>
	);
}
