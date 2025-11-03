import { useEffect } from "react";
import { useNotifications } from "@/hooks/useNotifications";
import { useAuth } from "@/contexts/AuthProvider";

/**
 * 📬 通知機能統合コンポーネント
 *
 * - アプリ起動時に通知許可を取得しトークンを登録
 * - ログイン後にトークンを再登録（forceRegister）
 * - 匿名ユーザーの場合は登録をスキップ
 *
 * #通知機能 【設計】認証状態の変化を監視し、ログイン後にトークン再登録を行う
 */
export const NotificationManager = () => {
	const { checkAndRegisterToken } = useNotifications();
	const { user, isAuthenticated } = useAuth();

	// アプリ起動時とログイン後に実行
	useEffect(() => {
		if (!isAuthenticated || !user || user.is_anonymous) return;

		// #通知機能 【設計】ログイン後は強制的にトークンを再登録
		const isRealUser = !user.is_anonymous;
		checkAndRegisterToken(isRealUser);
	}, [user?.id, user?.is_anonymous, isAuthenticated]);

	return null;
};
