/*
このファイルの責務
- #1486 §7 Welcome 画面。ロゴ + クラッカー演出 + 確定コピー + 「はじめる」。
- **オンボーディング完了フラグを確定する唯一の場所**（#1486 §7）。

## 完了フラグをここで確定する理由

旧チュートリアルは «シートを閉じた時点» で既読にしていた。新オンボーディングは
ログイン・位置情報・通知と複数画面にまたがるため、どこで確定するかを決めておかないと
「3 枚目まで見てログイン画面で離脱した人」を既読にしてしまい、権限フローが
二度と出なくなる。チケットは「Welcome画面完了時点でオンボーディング完了フラグを確定」と
定めており、ここが最後の 1 枚である。

⚠️ 「はじめる」を押す前に離脱した場合は未読のまま残る（＝次回起動でまた出る）。
これは意図した挙動で、権限フローを 1 度も通っていない人に案内をやり直す機会を残している。
*/
import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import type { ExternalPathString } from "expo-router";

import { PrimaryButton } from "@/components/PrimaryButton";
import { type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import { ConfettiBurst } from "@/features/onboarding/components/ConfettiBurst";
import { OnboardingScreenOptions } from "@/features/onboarding/components/OnboardingScreenOptions";
import { appRootPath } from "@/features/onboarding/navigation";
import { markOnboardingSeen } from "@/features/onboarding/onboardingSeenStore";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import i18n from "@/lib/i18n";

export default function OnboardingWelcomeScreen() {
	const styles = useThemedStyles(createStyles);
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const reducedMotion = useReducedMotion();
	const [isLeaving, setIsLeaving] = useState(false);

	const handleStart = useCallback(async () => {
		if (isLeaving) return;
		setIsLeaving(true);

		// #1486 §7 ここで完了フラグを確定する。書き込みの完了を待ってから遷移するのは、
		// 遷移先の検索画面が «未読なら自動でオンボーディングへ送る» 判定を持っているため。
		// 待たずに遷移すると、書き込みが終わる前に検索画面が古い値を読んで
		// オンボーディングへ送り返す（無限ループ）可能性がある
		await markOnboardingSeen();

		logFrontendEvent({
			event_name: "onboarding_completed",
			error_level: "log",
			payload: { completed: true },
		});

		// オンボーディングは検索画面から push されている。積み上がった画面をすべて畳んで
		// «元いた検索画面» へ帰す（履歴が無いときだけ置き換えで着地させる）
		if (router.canDismiss()) {
			router.dismissAll();
			return;
		}
		router.replace(appRootPath(locale) as ExternalPathString);
	}, [isLeaving, logFrontendEvent, locale]);

	return (
		<View style={styles.container}>
			<OnboardingScreenOptions />
			<SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
				<View style={styles.content} testID="onboarding-welcome">
					{/* 見本（SARAH の Welcome）の余白比: ロゴの上に約 1、下（CTA まで）に約 1.6。
					    justifyContent: "center" だと端末の縦横比で詰まり方が変わるため、
					    flex スペーサーで比率そのものを固定する */}
					<View style={styles.topSpacer} />
					<Image
						source={require("@/assets/images/icon.webp")}
						style={styles.logo}
						contentFit="contain"
						accessibilityElementsHidden
						importantForAccessibility="no-hide-descendants"
					/>

					<Text style={styles.title} testID="onboarding-welcome-title">
						{i18n.t("Onboarding.welcome.title")}
					</Text>
					<Text style={styles.body} testID="onboarding-welcome-body">
						{`${i18n.t("Onboarding.welcome.body1")}\n${i18n.t("Onboarding.welcome.body2")}`}
					</Text>
					<View style={styles.bottomSpacer} />
				</View>

				<View style={styles.footer}>
					<PrimaryButton
						label={i18n.t("Onboarding.welcome.cta")}
						onPress={handleStart}
						loading={isLeaving}
						borderRadius={28}
						contentStyle={styles.ctaContent}
						testID="onboarding-welcome-start"
					/>
				</View>
			</SafeAreaView>

			{/* #1486 §7 紙吹雪は «画面全体» に、ロゴやテキストの上へ被せて弾けさせる
			   （デザインレビューで「派手に・ロゴに被ってよい」が確定）。
			    pointerEvents="none" なので「はじめる」の操作は妨げない */}
			<ConfettiBurst reducedMotion={reducedMotion} testID="onboarding-welcome-confetti" />
		</View>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: c.surface,
		},
		safeArea: {
			flex: 1,
		},
		// ロゴ・見出し・本文は中央よりやや上（見本の構成）。
		// 紙吹雪の主戦場が画面上部なので、その中へ絵として収まる
		content: {
			flex: 1,
			alignItems: "center",
			paddingHorizontal: 32,
		},
		topSpacer: {
			flex: 1,
		},
		bottomSpacer: {
			flex: 1.6,
		},
		logo: {
			width: 132,
			height: 132,
			borderRadius: 66,
			// 見本: ロゴと見出しの間はたっぷり空く
			marginBottom: 44,
		},
		title: {
			fontSize: 27,
			lineHeight: 38,
			fontWeight: "700",
			color: c.textPrimary,
			textAlign: "center",
		},
		body: {
			marginTop: 18,
			fontSize: 15,
			lineHeight: 26,
			color: c.textSecondaryAlt,
			textAlign: "center",
		},
		footer: {
			paddingHorizontal: 24,
			paddingBottom: 24,
		},
		ctaContent: {
			paddingVertical: 15,
		},
	});
