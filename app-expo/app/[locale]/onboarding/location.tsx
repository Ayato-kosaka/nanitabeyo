/*
このファイルの責務
- #1486 §5 位置情報許可の説明画面。表示と同時に OS の許可ダイアログを出す。
- 答えが出たら、ログイン済みかどうかで «通知許可» か «Welcome» かへ進む（#1486 §6）。

許可 / 拒否のどちらでもオンボーディングは止めない（#1486 §9）。
*/
import React, { useCallback } from "react";
import { router } from "expo-router";
import type { ExternalPathString } from "expo-router";

import { OnboardingPermissionScreen } from "@/features/onboarding/components/OnboardingPermissionScreen";
import { OnboardingScreenOptions } from "@/features/onboarding/components/OnboardingScreenOptions";
import { resolveAfterLocationPath } from "@/features/onboarding/navigation";
import {
	getLocationPermissionState,
	requestLocationPermission,
	type PermissionOutcome,
} from "@/features/onboarding/permissions";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";

export default function OnboardingLocationScreen() {
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const { user, isAuthResolved } = useAuth();

	const handleSettled = useCallback(
		(outcome: PermissionOutcome) => {
			// #1486 §6【設計】通知許可は «ログイン済みユーザーのみ»。
			//
			// `isGuestUser` は user === null（認証未確定）をゲストへ倒す（lib/authGuest.ts）ので、
			// 認証がまだ解決していない間は「未ログイン」として扱われる。ここは許可ダイアログを
			// 待っている間に AuthProvider の解決が終わっている場合がほとんどだが、
			// 解決していなければ通知を尋ねずに Welcome へ進む＝ #1486 §6 の「スキップした人には
			// 要求しない」側へ倒れるので、安全側に落ちる。
			const isLoggedIn = isAuthResolved && !isGuestUser(user);

			logFrontendEvent({
				event_name: "onboarding_location_permission_settled",
				error_level: "log",
				payload: { outcome, is_logged_in: isLoggedIn },
			});

			router.replace(resolveAfterLocationPath({ isLoggedIn, locale }) as ExternalPathString);
		},
		[isAuthResolved, user, locale, logFrontendEvent],
	);

	return (
		<>
			<OnboardingScreenOptions />
			<OnboardingPermissionScreen
				title={i18n.t("Onboarding.location.title")}
				body={i18n.t("Onboarding.location.body")}
				progress={0.6}
				probe={getLocationPermissionState}
				request={requestLocationPermission}
				// 中央に置く iOS 位置情報ダイアログのダミー。実物と同じ並び順で、
				// おすすめの「Appの使用中は許可」を強調する
				dialogPreview={{
					title: i18n.t("Onboarding.location.dialog.title"),
					message: i18n.t("Onboarding.location.dialog.message"),
					buttons: [
						{ label: i18n.t("Onboarding.location.dialog.allowOnce") },
						{ label: i18n.t("Onboarding.location.dialog.allowWhileUsing"), emphasized: true },
						{ label: i18n.t("Onboarding.location.dialog.deny") },
					],
				}}
				onSettled={handleSettled}
				testID="onboarding-location"
			/>
		</>
	);
}
