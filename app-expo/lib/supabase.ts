import "react-native-url-polyfill/auto";
import { Platform, AppState, AppStateStatus } from "react-native";
import { createClient, processLock } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Env } from "@/constants/Env";
import { RATE_LIMIT_STATUS } from "@/lib/authRecovery";
// import { Database } from "@shared/supabase/database.types";

// #1089 【設計】auth エンドポイントが 429 を返したときの `Retry-After` を記録するための箱。
// supabase-js の AuthApiError は `status` / `code` しか持たずレスポンスヘッダを参照できないため、
// fetch を包んでヘッダだけ拾い、AuthProvider のクールダウン計算（lib/authRecovery.ts）へ渡す。
let lastAuthRetryAfterHeader: string | null = null;

/**
 * 直近の auth 429 応答に付いていた `Retry-After` を取り出す（取り出したら消す）。
 *
 * 「消す」のは、古い 429 の待ち時間を後続の別の失敗に誤って適用しないため。
 * @returns ヘッダの生値。直近の失敗が 429 でなかった / ヘッダが無かった場合は null
 */
export const consumeAuthRetryAfterHeader = (): string | null => {
	const value = lastAuthRetryAfterHeader;
	lastAuthRetryAfterHeader = null;
	return value;
};

/** supabase-js 全体（auth / postgrest / storage）が使う fetch。挙動は素の fetch と同じで、429 の観測だけ足している */
const fetchWithRateLimitCapture = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
	const response = await fetch(input, init);

	if (response.status === RATE_LIMIT_STATUS) {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		// auth 以外（postgrest 等）の 429 まで拾うと、匿名サインインのクールダウンが無関係な理由で伸びる
		if (url.includes("/auth/v1/")) {
			lastAuthRetryAfterHeader = response.headers.get("retry-after");
		}
	}

	return response;
};

/**
 * 📦 Supabase クライアントのインスタンス。
 *
 * - プラットフォーム（Web / ネイティブ）に応じて `storage` を切り替える
 * - 認証セッションの自動復元・自動更新が有効化されている
 * - DB スキーマは `Env.DB_SCHEMA` により動的に切り替え可能
 */
// export const supabase = createClient<Database>(Env.SUPABASE_URL, Env.SUPABASE_ANON_KEY, {
export const supabase = createClient(Env.SUPABASE_URL, Env.SUPABASE_ANON_KEY, {
	auth: {
		...(Platform.OS !== "web" ? { storage: AsyncStorage } : {}),
		flowType: "pkce",
		autoRefreshToken: true,
		persistSession: true,
		detectSessionInUrl: false,
		lock: processLock,
	},
	db: {
		schema: Env.DB_SCHEMA,
	},
	global: {
		fetch: fetchWithRateLimitCapture,
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
