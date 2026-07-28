import React, { createContext, useContext, useState, ReactNode, useCallback, useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { Snackbar } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import i18n from "@/lib/i18n";

/** #936 【仕様】Undo等の任意アクションボタン。onPress後は自動でスナックバーを閉じる */
export type SnackbarAction = {
	label: string;
	onPress: () => void;
};

export type ShowSnackbarOptions = {
	action?: SnackbarAction;
	/** 表示時間(ms)。未指定時は既存の4000msを維持する */
	duration?: number;
};

/**
 * Snackbar の表示制御用 Context の型定義。
 */
type SnackbarContextType = {
	/**
	 * 指定したメッセージを一時的に表示する。
	 *
	 * @param message - 表示するメッセージ文字列
	 * @param options - Undoボタン等の任意アクションと表示時間
	 */
	showSnackbar: (message: string, options?: ShowSnackbarOptions) => void;
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
	const [action, setAction] = useState<SnackbarAction | undefined>(undefined);
	const [duration, setDuration] = useState(4000);
	const insets = useSafeAreaInsets();

	// タブバーのおおよその高さ（必要に応じて調整）
	const TAB_BAR_HEIGHT = 32;

	const bottomOffset = insets.bottom + TAB_BAR_HEIGHT + 8;

	/**
	 * スナックバーを表示する。
	 *
	 * @param message - 表示するテキスト
	 * @param options - Undoボタン等の任意アクションと表示時間
	 */
	const showSnackbar = useCallback((message: string, options?: ShowSnackbarOptions) => {
		setMessage(message);
		setAction(options?.action);
		setDuration(options?.duration ?? 4000);
		setVisible(true);
	}, []);

	// #1013 【パフォーマンス】DialogProvider/AuthProvider と同様に context value を安定化し、
	// Snackbar表示時に無関係な consumer まで再レンダーされるのを防ぐ
	const value = useMemo<SnackbarContextType>(() => ({ showSnackbar }), [showSnackbar]);

	return (
		<SnackbarContext.Provider value={value}>
			{children}
			<Snackbar
				visible={visible}
				onDismiss={() => setVisible(false)}
				duration={duration}
				style={[styles.snackbar, { bottom: bottomOffset }]}
				testID="global-snackbar"
				// #936 【仕様】スクリーンリーダーにメッセージ表示を自動通知する(Web は aria-live="polite" に対応)
				accessibilityLiveRegion="polite"
				action={
					action
						? {
								label: action.label,
								onPress: () => {
									action.onPress();
									setVisible(false);
								},
							}
						: undefined
				}>
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
