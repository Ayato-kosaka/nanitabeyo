/*
このファイルの責務
- 共有された SNS の URL を受け取り、**取り込みの入口として何が起きるか**をユーザーへ示す（#1400 PR1）。
- 3 分岐（取り込める / 展開が要る / 対応していない）をそれぞれ別の文言で出す。

## ルートである理由（BlurModal ではない）
`Portal.Host` は `<Stack>` を包んでいる（`app/[locale]/_layout.tsx`）ので、オーバーレイを開いたまま
push すると遷移先が下に潜る（#1364 で実測）。加えて共有からの着地は
**「アプリ未起動 → 起動 → ここ」** という経路を持ち、URL だけで再現できる必要がある。
`scripts/assert-legacy-blur-modal-boundary.mjs` が `Portal` の import を禁じており、
`__tests__/snsImportRoute.test.tsx` が「この画面は Portal を 1 つも描かない」を固定している。

## この PR での «準備中»（#1400 の範囲）
- 短縮 URL の展開は **API の仕事**（`POST /v1/dish-media/imports/resolve`。#1399）で、PR1 では叩かない。
- 取り込みの保存も #1399 の後続 PR（PR7 / PR11）で、ここでは行わない。
どちらも「押しても何も起きない」ではなく **準備中であると文字で言う**。共有は
「アプリを切り替えてまで持ってきた操作」なので、無言で終わらせるのが一番悪い。

## `url` は parseSnsUrl が組み直した値しか来ない
`lib/snsShareIntake.ts` が canonical / expand URL だけをクエリへ載せる。とはいえこの画面は
URL 直叩きでも開けるので、**受け取った値は必ず `resolveSnsShareIntakeView()` を通してから使う**
（生の `url` を画面に出さない）。
*/
import React, { useCallback } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import i18n from "@/lib/i18n";
import { resolveSnsShareIntakeView } from "@/lib/snsShareIntake";
import type { SnsProvider } from "@shared/utils/snsUrl";

/**
 * provider の表示名。**固有名詞なので翻訳しない**（8 ロケールへ同じ値を 3 つずつ置くと、
 * 表記ゆれが入る余地だけが増える）。文章に混ざる形の文言は locale ファイル側に置いてある。
 */
const PROVIDER_LABELS: Record<SnsProvider, string> = {
	instagram: "Instagram",
	tiktok: "TikTok",
	youtube: "YouTube Shorts",
};

export default function SnsImportScreen() {
	useScreenTrace("SnsImport");
	const { lightImpact } = useHaptics();
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const { url } = useLocalSearchParams<{ url?: string }>();

	const view = resolveSnsShareIntakeView(url);

	const handleBack = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "sns_import_screen_back_pressed",
			error_level: "log",
			payload: { state: view.state },
		});
		// 共有からの着地は履歴が無いことがある（ログイン往復の replace / コールドスタート）。
		// その場合は my-dishes（取り込んだものが並ぶ場所）へ倒す
		if (router.canGoBack()) {
			router.back();
			return;
		}
		router.replace(`/${locale}/my-dishes`);
	}, [lightImpact, locale, logFrontendEvent, view.state]);

	return (
		<SafeAreaView edges={["bottom"]} style={styles.container} testID="sns-import-screen">
			<ScreenHeader title={i18n.t("SnsImport.title")} onPressBack={handleBack} testID="sns-import-screen" />
			<ScrollView contentContainerStyle={styles.content}>
				{view.state === "confirm" && (
					<View testID="sns-import-confirm">
						<Text style={styles.heading}>{i18n.t("SnsImport.confirm.heading")}</Text>
						<Text style={styles.provider} testID="sns-import-provider">
							{PROVIDER_LABELS[view.content.provider]}
						</Text>
						<Text style={styles.url} testID="sns-import-url" numberOfLines={3}>
							{view.content.canonicalUrl}
						</Text>
						{/* #1399 PR7 / PR11 が入るまでは保存できない。押せないボタンを出すより文字で言う */}
						<Text style={styles.pending} testID="sns-import-confirm-pending">
							{i18n.t("SnsImport.confirm.pending")}
						</Text>
					</View>
				)}

				{view.state === "expandPending" && (
					<View testID="sns-import-expand-pending">
						<Text style={styles.heading}>{i18n.t("SnsImport.expandPending.heading")}</Text>
						<Text style={styles.provider} testID="sns-import-provider">
							{PROVIDER_LABELS[view.shortlink.provider]}
						</Text>
						{/* 「非対応」と言ってはいけない。TikTok アプリの共有ボタンが出すのはこの形である */}
						<Text style={styles.pending}>{i18n.t("SnsImport.expandPending.description")}</Text>
					</View>
				)}

				{view.state === "unsupported" && (
					<View testID="sns-import-unsupported">
						<Text style={styles.heading}>{i18n.t("SnsImport.unsupported.heading")}</Text>
						{/* 設計 §3: 黙って落とさず «対応しているもの» を必ず明示する */}
						<Text style={styles.description} testID="sns-import-unsupported-description">
							{i18n.t("SnsImport.unsupported.description")}
						</Text>
					</View>
				)}
			</ScrollView>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#FFFFFF",
	},
	content: {
		paddingHorizontal: 16,
		paddingBottom: 24,
	},
	heading: {
		marginTop: 16,
		fontSize: 18,
		fontWeight: "700",
		color: "#1A1A1A",
	},
	provider: {
		marginTop: 12,
		fontSize: 14,
		fontWeight: "700",
		color: "#F05537",
	},
	url: {
		marginTop: 4,
		fontSize: 13,
		color: "#374151",
	},
	description: {
		marginTop: 12,
		fontSize: 14,
		lineHeight: 20,
		color: "#374151",
	},
	pending: {
		marginTop: 16,
		fontSize: 13,
		lineHeight: 19,
		color: "#6B7280",
	},
});
