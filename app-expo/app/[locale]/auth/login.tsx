/*
このファイルの責務
- ログイン UI（features/auth/components/LoginForm）を «画面» として提供する。
- 戻る導線（ScreenHeader / ハードウェアバック）から、履歴または `?next=` に沿って離脱する。

#1359 【設計】ログインは長らく BlurModal のオーバーレイで、呼び出し 4 箇所に複製されていた。
モーダルは「表示状態が遷移と無関係な boolean」なので、遷移が起きても誰も閉じず、
呼び出し側が閉じる責務を持つ必要があった（#498 の「OAuth 成功後もモーダルが閉じない」の根）。
ルートにすると **ログイン UI の寿命 = ルートの寿命** になり、その状態自体が存在しなくなる。

presentation を指定していない（＝既定の card）のは意図的:
- `formSheet` / `transparentModal` は OS ごとの差分と Android のぼかし（#286）を持ち込む。
  この画面に TextInput は 1 つも無いため、シートである利点も無い。
- 既定の card なら Android の戻る・ブラウザバック・URL 共有がすべて Navigator の既定挙動で賄える。
  `app/[locale]/(tabs)/profile/feedback.tsx`（#951）と同じ構成。
`app/[locale]/_layout.tsx` への Stack.Screen 追加が不要なのも、presentation を変えないため
（兄弟の `auth/callback.tsx` も列挙されていないが動いている）。

⚠️ この PR の時点では、まだどこからもこのルートへ遷移してこない。
呼び出し 4 箇所を `router.push` へ切り替えるのは次の PR で、E2E と catalog/screens.json も同時に更新する。
*/
import React, { useCallback } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import type { ExternalPathString } from "expo-router";

import { ScreenHeader } from "@/components/ScreenHeader";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { resolvePostLoginTarget } from "@/lib/authNext";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";

export default function LoginScreen() {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	// `next` は外部（URL / ディープリンク）から来る値。行き先として採用してよいかは
	// lib/authNext.ts で検証する。ここでは生のまま受け取るだけにする
	const { next } = useLocalSearchParams<{ next?: string }>();

	const handleBack = useCallback(() => {
		lightImpact();

		// 履歴があれば back。元画面がマウントされたまま残っているので、URL に出ていない
		// 画面内 state（例: 地図の選択中の店）ごと復帰できる。`next` は履歴が無いときの保険
		const target = resolvePostLoginTarget({ canGoBack: router.canGoBack(), next, locale });

		logFrontendEvent({
			event_name: "login_screen_back_pressed",
			error_level: "log",
			payload: { targetType: target.type, ...(target.type === "replace" ? { href: target.href } : {}) },
		});

		if (target.type === "back") {
			router.back();
			return;
		}
		// authNext が「先頭 / の内部パス」まで絞り込んだ後の値なので、typed routes の
		// 型と一致しないことを承知でキャストする（app/index.tsx のディープリンク遷移と同じ扱い）
		router.replace(target.href as ExternalPathString);
	}, [lightImpact, logFrontendEvent, next, locale]);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				{/* タイトルはヘッダー側が持つため、LoginForm 自身の見出しは出さない */}
				<ScreenHeader title={i18n.t("auth.login_title")} onPressBack={handleBack} testID="login-screen" />
				<ScrollView
					style={styles.scrollView}
					contentContainerStyle={styles.scrollContent}
					keyboardShouldPersistTaps="handled">
					<LoginForm testID="login-screen" showTitle={false} />
				</ScrollView>
			</SafeAreaView>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	safeArea: {
		flex: 1,
	},
	scrollView: {
		flex: 1,
	},
	scrollContent: {
		paddingVertical: 16,
		paddingBottom: 40,
	},
});
