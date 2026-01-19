import React, { memo, useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, Linking } from "react-native";
import i18n from "@/lib/i18n";
import { Env } from "@/constants/Env";
import { useLocale } from "@/hooks/useLocale";

export interface OpenInAppBannerProps {
	/** 現在のパス（例: "posts"） */
	path: string;
	/** クエリパラメータ（例: { ids: "aaa,bbb" }） */
	params?: Record<string, string | string[] | undefined>;
}

/**
 * #688 【設計】Web Deep Linking 用バナーコンポーネント
 *
 * Web 表示時にアプリ導線を提供：
 * - position absolute で画面上部に半透明でオーバーレイ表示
 * - サイト名の右に「アプリで開く」ボタンを配置
 * - ボタン押下時：
 *   - アプリインストール済み → アプリで開く
 *   - 未インストール → ストアへ誘導
 *
 * ネイティブアプリでは表示しない（Web のみ）。
 */
const OpenInAppBannerComponent: React.FC<OpenInAppBannerProps> = ({ path, params }) => {
	// ネイティブアプリでは非表示
	if (Platform.OS !== "web") {
		return null;
	}

	// #688 【設計】locale の取得は OpenInAppBanner の責務とする
	const { locale } = useLocale();
	const [isMobile, setIsMobile] = useState(false);

	useEffect(() => {
		// #688 【設計】モバイルブラウザ判定（Feature Detection 優先、User Agent をフォールバック）
		const checkMobile = () => {
			// Feature Detection: タッチデバイス && ホバー不可能
			const hasCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
			const noHover = window.matchMedia("(hover: none)").matches;
			const featureDetection = hasCoarsePointer && noHover;

			// User Agent フォールバック
			const ua = navigator.userAgent;
			const uaDetection = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);

			// Feature Detection を優先、未対応ブラウザでは UA を使用
			setIsMobile(featureDetection || uaDetection);
		};
		checkMobile();
	}, []);

	const buildCustomSchemeUrl = useCallback(() => {
		// nanitabeyo:// スキームで同じパスを構築
		let url = `nanitabeyo:///${locale}/${path}`;
		if (params) {
			const query = new URLSearchParams();
			Object.entries(params).forEach(([key, value]) => {
				if (value !== undefined) {
					const val = Array.isArray(value) ? value.join(",") : value;
					query.append(key, val);
				}
			});
			const queryString = query.toString();
			if (queryString) {
				url += `?${queryString}`;
			}
		}
		return url;
	}, [locale, path, params]);

	const handleOpenInApp = useCallback(() => {
		const customUrl = buildCustomSchemeUrl();

		// #688 【設計】iframe を使用してページ遷移を防ぐ（Custom Scheme 失敗時の対策）
		const iframe = document.createElement("iframe");
		iframe.style.display = "none";
		iframe.src = customUrl;
		document.body.appendChild(iframe);

		// タイムアウト判定：アプリが開かなければストアへ（ユーザーアクションとして提示）
		// 注意：visibilitychange を使用してもアプリ起動判定は完全ではないため、
		// 長めのタイムアウト（3秒）を設定し、ユーザーが気づきやすくする
		setTimeout(() => {
			document.body.removeChild(iframe);

			// iOS と Android の判定
			const ua = navigator.userAgent;
			const isIOS = /iPhone|iPad|iPod/i.test(ua);
			const isAndroid = /Android/i.test(ua);

			if (isIOS && Env.APP_STORE_URL) {
				window.open(Env.APP_STORE_URL, "_blank");
			} else if (isAndroid && Env.PLAY_STORE_URL) {
				window.open(Env.PLAY_STORE_URL, "_blank");
			}
		}, 3000);
	}, [buildCustomSchemeUrl]);

	// モバイルでない場合は非表示
	if (!isMobile) {
		return null;
	}

	return (
		<View style={styles.overlay}>
			<View style={styles.banner}>
				<Text style={styles.siteName}>{i18n.t("Common.site")}</Text>
				<Pressable style={styles.openButton} onPress={handleOpenInApp}>
					<Text style={styles.openButtonText}>{i18n.t("DeepLinking.openInApp")}</Text>
				</Pressable>
			</View>
		</View>
	);
};

export const OpenInAppBanner = memo(OpenInAppBannerComponent);

const styles = StyleSheet.create({
	// #688 【設計】position absolute で画面上部に半透明オーバーレイとして配置
	overlay: {
		position: "absolute" as any,
		top: 0,
		left: 0,
		right: 0,
		zIndex: 1000,
		backgroundColor: "rgba(0, 0, 0, 0.4)", // 半透明の黒背景
		paddingVertical: 8,
		paddingHorizontal: 16,
	},
	banner: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		backgroundColor: "rgba(255, 255, 255, 0.95)", // 半透明の白背景
		borderRadius: 8,
		paddingVertical: 8,
		paddingHorizontal: 12,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 4,
		elevation: 3,
	},
	siteName: {
		fontSize: 16,
		fontWeight: "700",
		color: "#1A1A1A",
		flex: 1,
	},
	openButton: {
		backgroundColor: "#f05537",
		paddingVertical: 8,
		paddingHorizontal: 16,
		borderRadius: 6,
		marginLeft: 12,
	},
	openButtonText: {
		color: "#FFFFFF",
		fontSize: 14,
		fontWeight: "700",
	},
});
