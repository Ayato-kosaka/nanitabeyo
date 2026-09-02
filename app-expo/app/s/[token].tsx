import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useLocale } from "@/hooks/useLocale";
import { resolvePublicLocale } from "@/constants/seoLocales";
import { toShareLinkHref } from "@/lib/shareLinkRoute";
import type { ResolveShareLinkResponse } from "@shared/api/v1/res";
import { type Palette } from "@/constants/Palette";
import { ThemeProvider, useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

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
 *
 * ## ⚠️ `useAPICall` を使ってはいけない（Detox が捕まえた実バグ）
 * この画面は `app/[locale]/` の **外**にあり、`AuthProvider` / `DialogProvider` は
 * `app/[locale]/_layout.tsx` の中にある。`useAPICall` は内部で `useAuth()` と
 * `useDialog()` を呼ぶため、ここで使うと **レンダー時に例外**になる。
 *
 * 症状は「共有リンクでアプリに着地した瞬間に落ちる」で、#721 の核心そのもの。
 * dev では App Links が本番ドメインにしか紐付いておらず **実機で踏めない**経路なので、
 * Detox（`tests/smoke/share-link.test.ts`）でしか検出できない。
 *
 * `GET /v1/share-links/:token/resolve` は `AuthAnonGuard` を持たない **公開エンドポイント**
 * なので、認証は不要。`fetchWithAuth` を素の関数として直接呼ぶ
 * （`x-app-version` を付ける必要があるので素の `fetch` にはしない。
 *  グローバルの `MaintenanceGuard` がこのヘッダを見る）。
 */
/**
 * #1509 【設計】このルートだけ `ThemeProvider` を自分で張る。
 *
 * テーマの起点は `app/[locale]/_layout.tsx` にあるが、この画面は上の JSDoc のとおり
 * `app/[locale]/` の **外**に居るため、その Provider の子孫ではない。張らないと
 * `useAppTheme()` が既定値（ライト固定）を返し、端末がダークでも地だけが白く光る。
 *
 * ⚠️ `AuthProvider` / `DialogProvider` を «同じ理由で» ここへ張ってはいけない。
 * あちらはセッションという単一の状態を持つため二重に張ると壊れる。`ThemeProvider` が
 * 二重でも安全なのは、持つのが端末ローカルの設定値（AsyncStorage）だけで、
 * この画面が resolve 後に replace で消える一時的な着地点だからである。
 */
export default function ShareLinkResolverScreen() {
	return (
		<ThemeProvider>
			<ShareLinkResolver />
		</ThemeProvider>
	);
}

function ShareLinkResolver() {
	const { token } = useLocalSearchParams<{ token?: string | string[] }>();
	const router = useRouter();
	const { locale } = useLocale();
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
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

		// 認証不要の公開エンドポイント。accessToken は空文字で良い
		// （このルートに AuthAnonGuard は付いていないため Authorization は参照されない）
		fetchWithAuth(`v1/share-links/${encodeURIComponent(rawToken)}/resolve`, { method: "GET", requestPayload: {} }, "")
			.then(async ({ response }) => {
				if (!response.ok) throw new Error(`resolve failed: ${response.status}`);
				const body = (await response.json()) as { data?: ResolveShareLinkResponse };
				if (!body?.data) throw new Error("resolve returned no data");
				return body.data;
			})
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
	}, [token, router, locale, fallbackLocale]);

	// resolve は 1 往復で終わるので、専用のエラー画面は作らない（失敗時はホームへ落とす）
	return (
		<View style={styles.container} testID="share-link-resolver">
			{/* #1629 色を渡さないと OS 既定の灰で描かれ、ダークの地の上でほとんど見えない */}
			<ActivityIndicator size="large" color={colors.brand} />
		</View>
	);
}

// #1509 【設計】`StyleSheet.create` はモジュール評価時に 1 度だけ走るためテーマを追従できない。
// パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.surface,
		},
	});
