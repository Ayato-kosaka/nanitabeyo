import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { Check } from "lucide-react-native";
import * as Localization from "expo-localization";
import { useRouter, usePathname } from "expo-router";
import type { ExternalPathString } from "expo-router";

import { Card } from "@/components/Card";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { ScreenHeader } from "@/components/ScreenHeader";
import i18n from "@/lib/i18n";
import type { Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { useLocale } from "@/hooks/useLocale";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useAPICall } from "@/hooks/useAPICall";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { localeSwitchLandingPath } from "@/lib/localeSwitch";
import { resolvePublicLocale, type PublicLocale } from "@/constants/seoLocales";
import { LANGUAGE_DISPLAY_NAMES, SELECTABLE_LANGUAGE_LOCALES } from "@/constants/languageDisplayNames";
import {
	loadLanguagePreference,
	saveLanguagePreference,
	type LanguagePreference,
} from "@/features/settings/languagePreferenceStore";
import type { UpdateUserProfileDto } from "@shared/api/v1/dto";

/**
 * #1508 【設計】選択肢は「端末の設定に従う」＋ RTL を除く公開ロケール。
 * 表示名は LANGUAGE_DISPLAY_NAMES（ネイティブ名固定、i18n しない）。
 */
type LanguageOption = { key: LanguagePreference; label: string };

export default function LanguageScreen() {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	const router = useRouter();
	const pathname = usePathname();
	const { locale } = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { user, isAuthResolved } = useAuth();

	// `null` = AsyncStorage からまだ読み込んでいない
	const [preference, setPreference] = useState<LanguagePreference | null>(null);
	// #1508 【仕様】新しいロケールのフォントは端末に無ければここで初めてダウンロードされる
	// （useLocaleFonts.ts）。切り替え直後は数MBの読み込みが走りうるため、遷移が終わるまで
	// 「切り替えています」の表示で待たせる
	const [isSwitching, setIsSwitching] = useState(false);

	useEffect(() => {
		let cancelled = false;
		loadLanguagePreference().then((value) => {
			if (!cancelled) setPreference(value);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	// #1508 【設計】"system" の表示名は i18n.t() で、locale が変わるたびに再評価する必要がある
	// （render のたびに作り直す。モジュールスコープの定数にすると初回 import 時の locale に固定される）
	const options: LanguageOption[] = [
		{ key: "system", label: i18n.t("Settings.language.systemDefault") },
		...SELECTABLE_LANGUAGE_LOCALES.map((localeOption) => ({
			key: localeOption,
			label: LANGUAGE_DISPLAY_NAMES[localeOption],
		})),
	];

	const handleBack = useCallback(() => {
		lightImpact();
		router.back();
	}, [lightImpact, router]);

	const handleSelect = useCallback(
		async (next: LanguagePreference) => {
			if (isSwitching || preference === null || next === preference) return;

			lightImpact();
			setIsSwitching(true);

			// "system" は preferred_locale（NOT NULL の BCP47 カラム）へそのまま書けないため、
			// この時点の端末ロケールへ解決した値を使う
			const resolvedLocale: PublicLocale =
				next === "system" ? resolvePublicLocale(Localization.getLocales?.()[0]?.languageTag) : next;

			await saveLanguagePreference(next);
			setPreference(next);

			// #1092 【設計】user === null（未確定）はゲスト扱い。isGuestUser と同じ判定を使う
			const isGuest = !isAuthResolved || isGuestUser(user);
			if (!isGuest) {
				try {
					await callBackend<UpdateUserProfileDto, void>("v1/users/me", {
						method: "POST",
						requestPayload: { preferred_locale: resolvedLocale },
					});
				} catch (error) {
					// ベストエフォート: 端末側の切り替えは既に確定しているので、サーバ反映の失敗で
					// 画面遷移までは止めない。失敗してもこの画面を開き直せば再送される
					logFrontendEvent({
						event_name: "language_preference_sync_failed",
						error_level: "warn",
						payload: { error: toErrorLogMessage(error), preferred_locale: resolvedLocale },
					});
				}
			}

			logFrontendEvent({
				event_name: "language_changed",
				error_level: "log",
				payload: { from: locale, to: resolvedLocale, preference: next },
			});

			/*
			#1629【28】**タブの根へ着地する。いまのパスへ replace してはいけない。**

			`router.replace("/en-US/profile/language")` にすると、新しいロケールの Stack が
			«その 1 画面だけ» で組まれ、戻るがタブの初期タブ（検索）へ抜ける。
			しかも profile の Stack は `language` のまま残るので、もう一度プロフィールを
			開くと言語画面が出て、そこから戻るとまた検索へ行く ＝ **プロフィールへ
			二度と戻れない**（オーナー実機報告。web ビルドで再現・録画済み）。

			⚠️ `unstable_settings.initialRouteName` では直らない。あれは URL から state を
			   組み立てるときに効くもので、`replace` には効かない。
			   一度それで «直した» と報告して直っていなかった。
			*/
			router.replace(localeSwitchLandingPath(pathname, resolvedLocale) as ExternalPathString);
		},
		[
			isSwitching,
			preference,
			lightImpact,
			isAuthResolved,
			user,
			callBackend,
			logFrontendEvent,
			locale,
			router,
			pathname,
		],
	);

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader testID="language-header" title={i18n.t("Settings.language.pageTitle")} onPressBack={handleBack} />
				<ScrollView contentContainerStyle={styles.scrollContent}>
					<Card style={styles.card}>
						{options.map((option, index) => {
							const isSelected = preference === option.key;
							return (
								<React.Fragment key={option.key}>
									<TouchableOpacity
										style={styles.row}
										onPress={() => handleSelect(option.key)}
										disabled={isSwitching || preference === null}
										accessibilityRole="button"
										accessibilityState={{ selected: isSelected, disabled: isSwitching || preference === null }}
										testID={`language-option-${option.key}`}>
										<Text style={styles.rowLabel}>{option.label}</Text>
										{isSelected && (
											<Check
												size={20}
												// #1508 選択チェック。ライトの見た目を変えないため既存リテラル(#FF3E33)と
												// 同値の destructive を充てている。マイページのテーマ 3 択は brand(#F05537) を
												// 使っており色が揃っていないが、統一は見た目の変更になるので別途判断する
												color={colors.destructive}
												accessibilityElementsHidden
												importantForAccessibility="no"
											/>
										)}
									</TouchableOpacity>
									{index < options.length - 1 && <View style={styles.separator} />}
								</React.Fragment>
							);
						})}
					</Card>
				</ScrollView>
				{isSwitching && (
					<View style={styles.switchingOverlay} testID="language-switching-overlay">
						<LoadingIndicator size="large" />
						<Text style={styles.switchingText}>{i18n.t("Settings.language.switching")}</Text>
					</View>
				)}
			</SafeAreaView>
		</LinearGradient>
	);
}

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
		},
		safeArea: {
			flex: 1,
		},
		scrollContent: {
			paddingBottom: 32,
		},
		card: {
			padding: 0,
		},
		row: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			paddingHorizontal: 16,
			paddingVertical: 16,
		},
		rowLabel: {
			fontSize: 16,
			color: colors.textPrimary,
			fontWeight: "500",
		},
		separator: {
			height: 1,
			backgroundColor: colors.divider,
			marginHorizontal: 16,
		},
		switchingOverlay: {
			...StyleSheet.absoluteFillObject,
			// #1629 幕は必ずテーマで振る。白固定のままだと、この上に載る `switchingText`
			// （`textPrimary` ＝ ダークでは明るい字）が白い幕に埋もれて読めなくなる
			backgroundColor: colors.busyScrim,
			alignItems: "center",
			justifyContent: "center",
		},
		switchingText: {
			marginTop: 12,
			fontSize: 14,
			color: colors.textPrimary,
			fontWeight: "500",
		},
	});
