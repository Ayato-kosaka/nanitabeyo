import React, { createContext, useContext, useState, ReactNode, useCallback } from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { Snackbar } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import i18n from "@/lib/i18n";

/**
 * Snackbar の表示制御用 Context の型定義。
 */
type SnackbarContextType = {
	/**
	 * 指定したメッセージを一時的に表示する。
	 *
	 * @param message - 表示するメッセージ文字列
	 */
	showSnackbar: (message: string) => void;
};

const SnackbarContext = createContext<SnackbarContextType | undefined>(undefined);

/**
 * 🧃 SnackbarProvider
 *
 * アプリ全体で簡易的な通知メッセージを表示するための Provider。
 * - メッセージを一時表示して自動で消える
 * - Snackbar は `react-native-paper` を使用
 *
 * @param children - React ツリーに渡す子要素
 * @returns プロバイダー付きのコンポーネントラップ
 */
export const SnackbarProvider = ({ children }: { children: ReactNode }) => {
	const [visible, setVisible] = useState(false);
	const [message, setMessage] = useState("");
	const insets = useSafeAreaInsets();

	// タブバーのおおよその高さ（必要に応じて調整）
	const TAB_BAR_HEIGHT = 32;

	const bottomOffset = insets.bottom + TAB_BAR_HEIGHT + 8;

	/**
	 * スナックバーを表示する。
	 *
	 * @param message - 表示するテキスト
	 */
	const showSnackbar = useCallback((message: string) => {
		setMessage(message);
		setVisible(true);
	}, []);

	return (
		<SnackbarContext.Provider value={{ showSnackbar }}>
			{children}
			<Snackbar
				visible={visible}
				onDismiss={() => setVisible(false)}
				duration={4000}
				style={[styles.snackbar, { bottom: bottomOffset }]}
				testID="global-snackbar">
				<TouchableOpacity activeOpacity={0.8} onPress={() => setVisible(false)}>
					<Text style={{ color: "#FFF" }}>{message}</Text>
				</TouchableOpacity>
			</Snackbar>
		</SnackbarContext.Provider>
	);
};

const styles = StyleSheet.create({
	snackbar: {
		position: "absolute",
		left: 16,
		right: 16,
	},
});

/**
 * useSnackbar フック
 *
 * - グローバルなスナックバーを表示するカスタムフック
 * - 必ず `SnackbarProvider` 内で使用する必要あり
 *
 * @throws Error - プロバイダー外で使用された場合のエラー
 * @returns Snackbar 操作関数
 */
export const useSnackbar = (): SnackbarContextType => {
	const context = useContext(SnackbarContext);
	if (!context) {
		throw new Error("[useSnackbar] This hook must be used within a <SnackbarProvider>.");
	}
	return context;
};
