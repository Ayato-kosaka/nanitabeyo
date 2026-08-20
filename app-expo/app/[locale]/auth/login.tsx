/*
このファイルの責務
- ログイン UI（features/auth/components/LoginForm）を «画面» として提供する。
- 認証が未確定の間は OAuth ボタンを描かず、確定後にログイン済みなら自動で離脱する。
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

⚠️ E2E の注意: `ScreenHeader` は `login-screen` コンテナ（LoginForm 側の View）の **外側**にある。
そのため `getByTestId("login-screen")` の配下に戻るボタンは入らない。戻る導線を検証するときは
`login-screen-back`（#1404 で ScreenHeader は `${testID}-back` を付ける）か
URL（`toHaveURL(/\/auth\/login/)`）を使うこと。
*/
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import type { ExternalPathString } from "expo-router";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useAuth } from "@/contexts/AuthProvider";
import { LoginForm } from "@/features/auth/components/LoginForm";
import { isGuestUser } from "@/lib/authGuest";
import { resolveNextPath, resolvePostLoginTarget } from "@/lib/authNext";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";

export default function LoginScreen() {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const { user, isAuthResolved } = useAuth();
	// `next` は外部（URL / ディープリンク）から来る値。行き先として採用してよいかは
	// lib/authNext.ts で検証する。ここでは生のまま受け取るだけにする
	const { next } = useLocalSearchParams<{ next?: string }>();

	// #1370 【設計】OAuth の redirectTo に載せる行き先。**検証を通した値だけ**を LoginForm へ渡す。
	// web の OAuth は全画面リダイレクトなので、URL に載せる以外に callback へ引き継ぐ手段が無い。
	// 生の `next` を渡すと、検証されない値が URL を一往復して戻ってくる経路ができる
	const nextPath = useMemo(() => resolveNextPath(next, locale) ?? undefined, [next, locale]);

	/**
	 * #1359 【設計】自動離脱を 1 回に限るための記録。
	 *
	 * `router.replace` を呼んでもこの画面が即座に unmount されるとは限らず、その間に user が
	 * 更新されると effect が再実行されて replace が二重に走る。ref は同期的に確定するので、
	 * 同一 JS タスク内の再入も含めて 1 回に閉じられる。
	 */
	const hasLeftRef = useRef(false);

	// #1359 【設計】ログイン済みになった瞬間にこの画面から離脱する保険（設計 §4）。
	// 通常は native なら AuthProvider が callback へ replace し、web ならページごと消えるため
	// ここは発火しない。発火するのは「ログイン済みなのに login ルートに居る」状態
	//（ログイン済みのまま URL 直叩き / ディープリンク、あるいは replace が走る前にセッションが
	// 確立した場合）で、#498 型の「ログインできたのにログイン UI が残る」に対する二重の防波堤になる。
	//
	// `isGuestUser` は user === null（認証未確定）をゲストへ倒す（lib/authGuest.ts）ので、
	// 未確定の間は発火しない。それでも isAuthResolved を明示的に見るのは、この不変条件を
	// authGuest 側の実装に依存させないため。
	useEffect(() => {
		if (!isAuthResolved || isGuestUser(user) || hasLeftRef.current) return;
		hasLeftRef.current = true;

		// ここは back を使わない。back は「ログイン導線を出した画面」へ戻す動きで、
		// ログイン済みで着地したこの経路では «行き先» を指す next の方が意図に合う
		const href = nextPath ?? `/${locale}/profile`;
		logFrontendEvent({
			event_name: "login_screen_already_authenticated",
			error_level: "log",
			payload: { href },
		});
		router.replace(href as ExternalPathString);
	}, [isAuthResolved, user, nextPath, locale, logFrontendEvent]);

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
				{/* #1359 タイトルはこのヘッダーだけが持つ（LoginForm 側の見出しは削除済み） */}
				<ScreenHeader title={i18n.t("auth.login_title")} onPressBack={handleBack} testID="login-screen" />
				{/* #1359 【設計】auth 未確定（user === null）の間は OAuth ボタンを «描かない»（設計 §4）。
				    未確定のまま押させると LoginForm 側のガードで「押しても何も起きない + Snackbar」になり、
				    さらに昇格チェックボックスが一瞬だけ出て消える。モーダル時代はこれを避けられなかったが、
				    画面ならマイページ（app/[locale]/(tabs)/profile/index.tsx）と同じくスピナーで待てる。
				    ⚠️ 戻る導線は待たせないこと。ヘッダーはこのゲートの外に置いてある */}
				{!isAuthResolved ? (
					<View style={styles.loadingContainer}>
						<LoadingIndicator size="large" />
					</View>
				) : (
					<ScrollView
						style={styles.scrollView}
						contentContainerStyle={styles.scrollContent}
						keyboardShouldPersistTaps="handled">
						<LoginForm testID="login-screen" next={nextPath} />
					</ScrollView>
				)}
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
	loadingContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	scrollContent: {
		paddingVertical: 16,
		paddingBottom: 40,
	},
});
