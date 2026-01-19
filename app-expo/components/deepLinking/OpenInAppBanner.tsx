import React, { memo, useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, Linking } from "react-native";
import i18n from "@/lib/i18n";
import { Env } from "@/constants/Env";

export interface OpenInAppBannerProps {
	/** 現在のロケール（例: "ja-JP"） */
	locale: string;
	/** 現在のパス（例: "posts"） */
	path: string;
	/** クエリパラメータ（例: { ids: "aaa,bbb" }） */
	params?: Record<string, string | string[] | undefined>;
}

/**
 * #688 【設計】Web Deep Linking 用バナーコンポーネント
 * 
 * Web 表示時にアプリ導線を提供：
 * - 「アプリで開く」ボタン（Custom Scheme でアプリ起動を試行）
 * - 「App Store」ボタン（iOS ストアへ）
 * - 「Google Play」ボタン（Android ストアへ）
 * 
 * PC の場合はストア導線のみ表示。
 * ネイティブアプリでは表示しない（Web のみ）。
 */
const OpenInAppBannerComponent: React.FC<OpenInAppBannerProps> = ({ locale, path, params }) => {
	// ネイティブアプリでは非表示
	if (Platform.OS !== "web") {
		return null;
	}

	const [isMobile, setIsMobile] = useState(false);

	useEffect(() => {
		// モバイルブラウザ判定（簡易版）
		const checkMobile = () => {
			const ua = navigator.userAgent;
			const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
			setIsMobile(mobile);
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
		// Custom Scheme を叩く
		window.location.href = customUrl;

		// タイムアウト判定：アプリが開かなければストアへ
		setTimeout(() => {
			// アプリが起動しなかった場合、ストアへ誘導
			// iOS と Android の判定
			const ua = navigator.userAgent;
			const isIOS = /iPhone|iPad|iPod/i.test(ua);
			const isAndroid = /Android/i.test(ua);

			if (isIOS && Env.APP_STORE_URL) {
				window.location.href = Env.APP_STORE_URL;
			} else if (isAndroid && Env.PLAY_STORE_URL) {
				window.location.href = Env.PLAY_STORE_URL;
			}
		}, 2000);
	}, [buildCustomSchemeUrl]);

	const handleAppStore = useCallback(() => {
		if (Env.APP_STORE_URL) {
			window.open(Env.APP_STORE_URL, "_blank");
		}
	}, []);

	const handlePlayStore = useCallback(() => {
		if (Env.PLAY_STORE_URL) {
			window.open(Env.PLAY_STORE_URL, "_blank");
		}
	}, []);

	return (
		<View style={styles.container}>
			<View style={styles.banner}>
				<Text style={styles.title}>{i18n.t("Common.site")}</Text>
				<View style={styles.buttonsContainer}>
					{isMobile && (
						<Pressable style={styles.primaryButton} onPress={handleOpenInApp}>
							<Text style={styles.primaryButtonText}>{i18n.t("DeepLinking.openInApp")}</Text>
						</Pressable>
					)}
					<Pressable style={styles.secondaryButton} onPress={handleAppStore}>
						<Text style={styles.secondaryButtonText}>{i18n.t("DeepLinking.appStore")}</Text>
					</Pressable>
					<Pressable style={styles.secondaryButton} onPress={handlePlayStore}>
						<Text style={styles.secondaryButtonText}>{i18n.t("DeepLinking.playStore")}</Text>
					</Pressable>
				</View>
			</View>
		</View>
	);
};

export const OpenInAppBanner = memo(OpenInAppBannerComponent);

const styles = StyleSheet.create({
	container: {
		backgroundColor: "#F8F9FA",
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
	banner: {
		backgroundColor: "#FFFFFF",
		borderRadius: 12,
		padding: 16,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 8,
		elevation: 4,
	},
	title: {
		fontSize: 16,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 12,
		textAlign: "center",
	},
	buttonsContainer: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 8,
		justifyContent: "center",
	},
	primaryButton: {
		backgroundColor: "#f05537",
		paddingVertical: 10,
		paddingHorizontal: 20,
		borderRadius: 8,
		minWidth: 120,
		alignItems: "center",
	},
	primaryButtonText: {
		color: "#FFFFFF",
		fontSize: 14,
		fontWeight: "700",
	},
	secondaryButton: {
		backgroundColor: "#FFFFFF",
		paddingVertical: 10,
		paddingHorizontal: 16,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: "#E0E0E0",
		minWidth: 100,
		alignItems: "center",
	},
	secondaryButtonText: {
		color: "#1A1A1A",
		fontSize: 14,
		fontWeight: "600",
	},
});
