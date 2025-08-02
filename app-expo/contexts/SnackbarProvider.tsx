import React, { createContext, useContext, useState, ReactNode, useCallback } from "react";
import { Snackbar } from "react-native-paper";

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
				style={{ position: "absolute", bottom: 16, left: 16, right: 16 }}
				testID="global-snackbar">
				{message}
			</Snackbar>
		</SnackbarContext.Provider>
	);
};

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
