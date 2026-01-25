import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";

import i18n from "@/lib/i18n";
import { Env } from "@/constants/Env";
import { useLocale } from "@/hooks/useLocale";

export interface OpenInAppBannerProps {
	/** 現在のパス（例: "posts"） */
	path: string;
	/** クエリパラメータ（例: { ids: "aaa,bbb" } or { ids: ["aaa","bbb"] }） */
	params?: Record<string, string | string[] | undefined>;
	/**
	 * Universal Links のベースURL（例: "https://app.nanitabeyo.net"）
	 * 既に Env にあるなら省略可
	 */
	universalBaseUrl?: string;
	/**
	 * カスタムスキーム（例: "nanitabeyo"）
	 * ※ 最後の手段。可能な限り Universal Links を優先する。
	 */
	scheme?: string;
}

/**
 * OpenInAppBanner（全方位ベストプラクティス版）
 *
 * 方針：
 * 1) 可能な限り Universal Links を最優先（Safari/Chrome/多くの環境で最も安定）
 * 2) iOS/Android の “自動ストア遷移” は避ける（ポップアップ/リダイレクト制限・UX悪化）
 *    → 代わりに「入手」ボタンをユーザー操作で提供
 * 3) In-App Browser（Instagram/FB等）は OS委譲が阻害されがち
 *    → 「Safari/Chrome で開く」案内に切り替える（成功率が上がる）
 * 4) カスタムスキームは最後の手段として用意（環境によっては抑止される）
 *
 * 重要：
 * - 本コンポーネントは Web のみ表示（ネイティブは return null）
 * - “アプリが開いたか” の検出は完全ではないため、過信しない
 */
const OpenInAppBannerComponent: React.FC<OpenInAppBannerProps> = ({
	path,
	params,
	universalBaseUrl = Env.WEB_BASE_URL /* 例: https://app.nanitabeyo.net を想定。違うなら差し替え */,
	scheme = "nanitabeyo",
}) => {
	// ネイティブアプリでは不要（Web deep linking 導線専用）
	if (Platform.OS !== "web") return null;

	const { locale } = useLocale();

	// SSR/Prerender 対策：window が無い環境では何もしない
	const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

	const [isMobile, setIsMobile] = useState(false);
	const [isInAppBrowser, setIsInAppBrowser] = useState(false);
	const [showHelp, setShowHelp] = useState(false);
	const [didAttemptOpen, setDidAttemptOpen] = useState(false);
	// 【設計】help UI を閉じた後は再表示しない（セッション中のみ有効）
	const [isHelpDismissed, setIsHelpDismissed] = useState(false);

	// “アプリ起動できたかも” を推測するためのフラグ（visibilitychange）
	const becameHiddenRef = useRef(false);
	// 【設計】A案：遅延後に同一ページに残っている場合のみ fallback/help を表示
	const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const buildQueryString = useCallback(() => {
		if (!params) return "";
		const query = new URLSearchParams();
		Object.entries(params).forEach(([key, value]) => {
			if (value === undefined) return;
			// 配列は comma join（既存実装互換）
			const val = Array.isArray(value) ? value.join(",") : value;
			query.append(key, val);
		});
		const qs = query.toString();
		return qs ? `?${qs}` : "";
	}, [params]);

	const universalUrl = useMemo(() => {
		// 例: https://app.nanitabeyo.net/ja/posts?ids=...
		// ※ universalBaseUrl が末尾 "/" の場合も考慮
		const base = universalBaseUrl?.replace(/\/+$/, "") || "";
		const qs = buildQueryString();
		return `${base}/${locale}/${path}${qs}`;
	}, [universalBaseUrl, locale, path, buildQueryString]);

	const customSchemeUrl = useMemo(() => {
		// 例: nanitabeyo:///ja/posts?ids=...
		const qs = buildQueryString();
		return `${scheme}:///${locale}/${path}${qs}`;
	}, [scheme, locale, path, buildQueryString]);

	// 【設計】タイマークリーンアップ用のヘルパー関数
	const clearDelayTimer = useCallback(() => {
		if (delayTimerRef.current) {
			clearTimeout(delayTimerRef.current);
			delayTimerRef.current = null;
		}
	}, []);

	const storeUrl = useMemo(() => {
		// “自動遷移”はしない方針なので、ボタン用にURLを返すだけ
		// iOS/Android の判定は UA で行う（Web のみなので許容）
		if (!isBrowser) return undefined;
		const ua = navigator.userAgent || "";
		const isIOS = /iPhone|iPad|iPod/i.test(ua);
		const isAndroid = /Android/i.test(ua);

		if (isIOS) return Env.APP_STORE_URL || undefined;
		if (isAndroid) return Env.PLAY_STORE_URL || undefined;
		return undefined;
	}, [isBrowser]);

	useEffect(() => {
		if (!isBrowser) return;

		// モバイル判定：Feature Detection 優先、UA はフォールバック
		const checkMobile = () => {
			try {
				const hasCoarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
				const noHover = window.matchMedia?.("(hover: none)")?.matches ?? false;
				const featureDetection = hasCoarsePointer && noHover;

				const ua = navigator.userAgent || "";
				const uaDetection = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

				setIsMobile(featureDetection || uaDetection);
			} catch {
				// matchMedia 未対応などの保険
				const ua = navigator.userAgent || "";
				setIsMobile(/Android|iPhone|iPad|iPod/i.test(ua));
			}
		};

		// In-App Browser 判定（完全ではないが実務上はかなり効く）
		const checkInApp = () => {
			const ua = navigator.userAgent || "";
			// Instagram / Facebook / Messenger / LINE / TikTok などの典型
			const inApp =
				/Instagram/i.test(ua) ||
				/\bFBAN\b/i.test(ua) ||
				/\bFBAV\b/i.test(ua) ||
				/FB_IAB/i.test(ua) ||
				/Line/i.test(ua) ||
				/TikTok/i.test(ua);

			setIsInAppBrowser(inApp);
		};

		checkMobile();
		checkInApp();
	}, [isBrowser]);

	useEffect(() => {
		if (!isBrowser) return;

		const onVis = () => {
			// アプリへ遷移できた場合、ブラウザがバックグラウンドに回ることが多い
			if (document.visibilityState === "hidden") {
				becameHiddenRef.current = true;
			}
		};
		document.addEventListener("visibilitychange", onVis);
		return () => {
			document.removeEventListener("visibilitychange", onVis);
			// 【設計】コンポーネントアンマウント時にタイマーをクリーンアップ
			clearDelayTimer();
		};
	}, [isBrowser, clearDelayTimer]);

	const openUrlTopLevel = useCallback((url: string) => {
		// ベストプラクティス：ユーザー操作の同期処理でトップレベル遷移を使う
		// iframe / setTimeout 内 window.open は Safari 等でブロックされやすい
		window.location.assign(url);
	}, []);

	const addNonce = useCallback((urlString: string) => {
		const url = new URL(urlString);
		// analytics/ログで除外しやすいキー名にするのがコツ
		url.searchParams.set("_oia", "1"); // open-in-app
		url.searchParams.set("_t", String(Date.now())); // nonce
		return url.toString();
	}, []);

	const normalizeForCompare = useCallback((urlString: string) => {
		try {
			const url = new URL(urlString);
			url.hash = ""; // hash は比較から除外
			return url.toString().replace(/\/$/, "");
		} catch {
			return urlString.replace(/\/$/, "");
		}
	}, []);

	const handleOpenInApp = useCallback(() => {
		if (!isBrowser) return;

		// クリア既存のタイマー（多重クリック対策）
		clearDelayTimer();

		setDidAttemptOpen(true);
		becameHiddenRef.current = false;

		// A案：押下直後は fallback/help を表示しない
		// 700ms 後に「まだ同一ページに残っている場合のみ」表示する
		delayTimerRef.current = setTimeout(() => {
			// アプリに移動できた可能性（ページが hidden になった）
			if (becameHiddenRef.current || document.visibilityState === "hidden") {
				return;
			}

			// まだ visible かつ同一ページにいる場合
			// In-App Browser: help を表示（dismiss されていなければ）
			// 通常ブラウザ: fallback を表示
			if (isInAppBrowser && !isHelpDismissed) {
				setShowHelp(true);
			}
			// 通常ブラウザの場合は didAttemptOpen=true で fallback が自動表示される
		}, 700);
	}, [isBrowser, isInAppBrowser, isHelpDismissed, clearDelayTimer]);

	const handleTryScheme = useCallback(() => {
		if (!isBrowser) return;
		setDidAttemptOpen(true);
		becameHiddenRef.current = false;

		// 注意：ここは環境によって無視される（特に iOS Safari / IAB）
		openUrlTopLevel(customSchemeUrl);
	}, [isBrowser, openUrlTopLevel, customSchemeUrl]);

	// “モバイルでない”なら出さない（PC にバナーはノイズ）
	if (!isMobile || !isBrowser) return null;

	return (
		<View style={styles.overlay} pointerEvents="box-none">
			<View style={styles.banner}>
				<View style={styles.bannerInfo}>
					<Image
						source={require("@/assets/images/icon.webp")}
						style={styles.icon}
						contentFit="cover"
						transition={0}
						cachePolicy={"memory-disk"}
					/>
					<View style={styles.textBlock}>
						<Text style={styles.bannerName}>{i18n.t("Common.site")}</Text>
					</View>
				</View>

				<View style={styles.actions}>
					{/* メイン：Universal Link（<a href> でトップレベル遷移を実現） */}
					<a href={addNonce(universalUrl)} style={styles.openButtonLink} onClick={handleOpenInApp}>
						<Text style={styles.openButtonText}>{i18n.t("DeepLinking.openInApp")}</Text>
					</a>

					{/* ストア：自動ではなく“ボタン”で提供（ポリシー/ブロック回避・UX改善） */}
					{!!storeUrl && (
						<Pressable
							style={styles.storeButton}
							// target="_blank" 相当：RNW の Pressable では a タグじゃないので window.open する
							// ただし “クリック同期” なのでブロックされにくい
							onPress={() => window.open(storeUrl, "_blank", "noopener,noreferrer")}>
							<Text style={styles.storeButtonText}>{i18n.t("DeepLinking.getApp")}</Text>
						</Pressable>
					)}
				</View>
			</View>

			{/* “最後の手段” を必要なときだけ出す（乱用しない） */}
			{didAttemptOpen && !becameHiddenRef.current && (
				<View style={styles.fallbackRow}>
					<Text style={styles.fallbackText}>{i18n.t("DeepLinking.fallbackText")}</Text>

					<Pressable style={styles.schemeButton} onPress={handleTryScheme}>
						<Text style={styles.schemeButtonText}>{i18n.t("DeepLinking.tryScheme")}</Text>
					</Pressable>
				</View>
			)}

			{/* In-App Browser 向けの補助案内（必要時だけ表示） */}
			{showHelp && isInAppBrowser && (
				<View style={styles.helpBox}>
					<Text style={styles.helpTitle}>{i18n.t("DeepLinking.helpTitle")}</Text>
					<Text style={styles.helpBody}>{i18n.t("DeepLinking.helpBody")}</Text>
					<Pressable
						style={styles.helpClose}
						onPress={() => {
							setShowHelp(false);
							setIsHelpDismissed(true);
						}}>
						<Text style={styles.helpCloseText}>{i18n.t("Common.close")}</Text>
					</Pressable>
				</View>
			)}
		</View>
	);
};

export const OpenInAppBanner = memo(OpenInAppBannerComponent);

const styles = StyleSheet.create({
	// 画面上部に重ねる（ページ内容を完全に隠さないよう余白は最小）
	overlay: {
		position: "absolute" as any,
		top: 0,
		left: 0,
		right: 0,
		zIndex: 1000,
		paddingVertical: 8,
		paddingHorizontal: 12,
	},
	banner: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		backgroundColor: "#fbeedd",
		borderRadius: 10,
		paddingVertical: 10,
		paddingHorizontal: 12,

		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.12,
		shadowRadius: 6,
		elevation: 4,
	},
	bannerInfo: {
		flexDirection: "row",
		alignItems: "center",
		flex: 1,
		paddingRight: 10,
	},
	icon: {
		width: 32,
		height: 32,
		borderRadius: 7,
		marginRight: 10,
	},
	textBlock: {
		flex: 1,
		minWidth: 0,
	},
	bannerName: {
		fontSize: 15,
		fontWeight: "800",
		color: "#1A1A1A",
	},
	actions: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	openButton: {
		backgroundColor: "#f05537",
		paddingVertical: 9,
		paddingHorizontal: 14,
		borderRadius: 8,
	},
	// 【設計】<a> タグのスタイルは React Native Web の制約によりオブジェクト形式
	openButtonLink: {
		textDecoration: "none",
		backgroundColor: "#f05537",
		paddingTop: 9,
		paddingBottom: 9,
		paddingLeft: 14,
		paddingRight: 14,
		borderRadius: 8,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	} as any, // React Native Web の <a> タグは any が必要
	openButtonText: {
		color: "#FFFFFF",
		fontSize: 13,
		fontWeight: "800",
	},
	storeButton: {
		backgroundColor: "#1A1A1A",
		paddingVertical: 9,
		paddingHorizontal: 12,
		borderRadius: 8,
	},
	storeButtonText: {
		color: "#FFFFFF",
		fontSize: 13,
		fontWeight: "800",
	},

	// “開けないときの次の手” を控えめに
	fallbackRow: {
		marginTop: 8,
		backgroundColor: "rgba(255,255,255,0.92)",
		borderRadius: 10,
		paddingVertical: 10,
		paddingHorizontal: 12,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",

		shadowColor: "#000",
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.08,
		shadowRadius: 4,
		elevation: 2,
	},
	fallbackText: {
		flex: 1,
		paddingRight: 10,
		fontSize: 12,
		fontWeight: "600",
		color: "#333",
	},
	schemeButton: {
		backgroundColor: "#f05537",
		paddingVertical: 8,
		paddingHorizontal: 10,
		borderRadius: 8,
	},
	schemeButtonText: {
		color: "#fff",
		fontSize: 12,
		fontWeight: "800",
	},

	// In-App Browser ヘルプ
	helpBox: {
		marginTop: 8,
		backgroundColor: "rgba(26,26,26,0.96)",
		borderRadius: 12,
		paddingVertical: 12,
		paddingHorizontal: 12,
	},
	helpTitle: {
		color: "#fff",
		fontSize: 13,
		fontWeight: "900",
	},
	helpBody: {
		marginTop: 6,
		color: "#fff",
		fontSize: 12,
		fontWeight: "600",
		lineHeight: 16,
	},
	helpClose: {
		marginTop: 10,
		alignSelf: "flex-end",
		paddingVertical: 8,
		paddingHorizontal: 10,
		borderRadius: 8,
		backgroundColor: "rgba(255,255,255,0.16)",
	},
	helpCloseText: {
		color: "#fff",
		fontSize: 12,
		fontWeight: "800",
	},
});
