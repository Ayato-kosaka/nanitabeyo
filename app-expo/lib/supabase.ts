import "react-native-url-polyfill/auto";
import { Platform, AppState, AppStateStatus } from "react-native";
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Env } from "@/constants/Env";
// import { Database } from "@shared/supabase/database.types";

/**
 * 📦 Supabase クライアントのインスタンス。
 *
 * - プラットフォーム（Web / ネイティブ）に応じて `storage` を切り替える
 * - 認証セッションの自動復元・自動更新が有効化されている
 * - DB スキーマは `Env.DB_SCHEMA` により動的に切り替え可能
 */
// export const supabase = createClient<Database>(Env.SUPABASE_URL, Env.SUPABASE_ANON_KEY, {
export const supabase = createClient(Env.SUPABASE_URL, Env.SUPABASE_ANON_KEY, {
	auth:
		Platform.OS === "web"
			? {}
			: {
					storage: AsyncStorage,
					autoRefreshToken: true,
					persistSession: true,
					detectSessionInUrl: false,
				},
	db: {
		schema: Env.DB_SCHEMA,
	},
});

/**
 * 🔄 App が Foreground にある間、自動的にトークン更新を有効にする。
 *
 * - Supabase Auth は `startAutoRefresh()` を使って定期的にトークンを更新できる
 * - アプリが Background に移動したら `stopAutoRefresh()` を呼び出し、通信の最小化を図る
 * - このリスナーは多重登録を防ぐ必要があるため、登録/解除に注意
 */
if (Platform.OS !== "web") {
	let isRegistered = false;

	const handleAppStateChange = (state: AppStateStatus) => {
		if (state === "active") {
			supabase.auth.startAutoRefresh();
		} else {
			supabase.auth.stopAutoRefresh();
		}
	};

	if (!isRegistered) {
		AppState.addEventListener("change", handleAppStateChange);
		isRegistered = true;
	}
}
