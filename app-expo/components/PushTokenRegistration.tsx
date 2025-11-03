import { useEffect } from "react";
import { useExpoPushToken } from "@/hooks/useExpoPushToken";

/**
 * 📲 Push 通知トークン登録コンポーネント
 *
 * - アプリ起動時に Expo Push Token を取得して Backend に登録
 * - useExpoPushToken フック内で全てのロジックを処理
 * - UI をレンダリングせず、副作用のみ実行
 */
export function PushTokenRegistration() {
	// #通知機能 【設計】Push Token 登録フックを呼び出すだけ
	useExpoPushToken();

	return null;
}
