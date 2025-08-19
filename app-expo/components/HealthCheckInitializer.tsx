import { useEffect } from "react";
import { useHealthCheck } from "@/hooks/useHealthCheck";

/**
 * HealthCheckInitializer
 *
 * アプリ起動時にヘルスチェックを実行する軽量コンポーネント
 * - 画面描画を妨げない
 * - プロバイダ初期化後に実行
 */
export const HealthCheckInitializer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { isChecking, hasCompleted, error } = useHealthCheck();

	// デバッグ用（開発環境でのみ表示）
	useEffect(() => {
		if (__DEV__) {
			console.log("[HealthCheck] Status:", { isChecking, hasCompleted, error });
		}
	}, [isChecking, hasCompleted, error]);

	// 画面描画は常に続行（ヘルスチェックは非同期）
	return <>{children}</>;
};
