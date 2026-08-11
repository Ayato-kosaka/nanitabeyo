import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useAPICall } from "@/hooks/useAPICall";
import { useLocale } from "@/hooks/useLocale";
import { resolvePublicLocale } from "@/constants/seoLocales";
import { toShareLinkHref } from "@/lib/shareLinkRoute";
import type { ResolveShareLinkResponse } from "@shared/api/v1/res";

/**
 * 🔗 共有リンク `/s/:token` の着地点（#721）。
 *
 * ## この画面が要る理由
 * Universal Links は `/*`（`public/.well-known/apple-app-site-association`）、
 * App Links は `pathPrefix: "/"`（`app.config.ts`）なので、**共有リンクは
 * アプリを入れている端末では必ずアプリへ来る**。受け側の route が無いと、
 * 共有を踏んだユーザーが空画面か 404 に着地する。
 *
 * ロケールを持たない URL なので `app/[locale]/` の外に置く（`app/store.tsx` と同じ位置）。
 *
 * ## 何をするか
 * token を resolve API へ投げ、返ってきた `target.type` を **アプリ側の allowlist**
 * （`lib/shareLinkRoute.ts`）で遷移先へ変換して `replace` する。
 * 履歴に残さないのは、遷移後に戻るとこの画面へ戻って再度 resolve が走るため。
 *
 * ## 失敗したらホームへ落とす
 * revoked / 期限切れ / 未知の target / 通信失敗のいずれでも、**この画面に留まらない**。
 * 共有リンクは «アプリを初めて触る人» が踏む導線なので、
 * 白い画面で止まるのが一番損失が大きい。
 */
export default function ShareLinkResolverScreen() {
	const { token } = useLocalSearchParams<{ token?: string | string[] }>();
	const router = useRouter();
	const { callBackend } = useAPICall();
	const { locale } = useLocale();
	// #1027 と同じ理由でナビゲータの準備を待つ必要はないが、
	// resolve が二重に走らないよう「1 回だけ実行した」ことは持つ
	const hasResolved = useRef(false);
	const [fallbackLocale] = useState(() => resolvePublicLocale(locale));

	useEffect(() => {
		if (hasResolved.current) return;
		const rawToken = Array.isArray(token) ? token[0] : token;
		if (!rawToken) return;
		hasResolved.current = true;

		let cancelled = false;

		const goHome = () => {
			if (!cancelled) router.replace(`/${fallbackLocale}`);
		};

		callBackend<Record<string, never>, ResolveShareLinkResponse>(
			`v1/share-links/${encodeURIComponent(rawToken)}/resolve`,
			{ method: "GET", requestPayload: {} },
		)
			.then((resolved) => {
				if (cancelled) return;
				// 遷移先の組み立てはアプリ側の allowlist で行う。
				// サーバが返した文字列をそのまま router.push すると、
				// サーバ側の不備がそのままアプリ内の任意遷移になる
				const href = toShareLinkHref(resolved, resolvePublicLocale(locale));
				if (!href) {
					goHome();
					return;
				}
				router.replace(href);
			})
			.catch(goHome);

		return () => {
			cancelled = true;
		};
	}, [token, callBackend, router, locale, fallbackLocale]);

	// resolve は 1 往復で終わるので、専用のエラー画面は作らない（失敗時はホームへ落とす）
	return (
		<View style={styles.container} testID="share-link-resolver">
			<ActivityIndicator size="large" />
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#FFFFFF",
	},
});
