import { AppState, AppStateStatus } from "react-native";
import type { CreateFrontendLogDto } from "@shared/api/v1/dto";
import { Env } from "@/constants/Env";
import { supabase } from "./supabase";
import { fetchWithAuth } from "./fetchWithAuth";

// #1012 【設計】フロントログ送信のキュー化・バッチ送信(クライアント側)
// useLogger.logFrontendEvent はここへ enqueue するだけにし、実際の送信は
// 件数(20件)または時間(5秒)のいずれか早い方の条件でまとめて行う
const FLUSH_BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 5_000;

let queue: CreateFrontendLogDto[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// #1012 【設計】送信の度に supabase.auth.getSession() を await せずに済むよう、
// Auth状態の変化を購読してアクセストークンをメモリにキャッシュする
let cachedAccessToken: string | undefined;
supabase.auth.onAuthStateChange((_event, session) => {
	cachedAccessToken = session?.access_token;
});

const getAccessToken = async (): Promise<string | undefined> => {
	if (cachedAccessToken) return cachedAccessToken;

	const {
		data: { session },
	} = await supabase.auth.getSession();
	cachedAccessToken = session?.access_token;
	return cachedAccessToken;
};

const sendBatch = async (logs: CreateFrontendLogDto[]): Promise<void> => {
	if (logs.length === 0) return;

	try {
		const accessToken = await getAccessToken();
		if (!accessToken) {
			throw new Error("User is not authenticated: Supabase access_token is missing.");
		}

		await fetchWithAuth(
			"v1/logs/frontend/batch",
			{
				method: "POST",
				requestPayload: { logs },
				isMultipart: false,
			},
			accessToken,
		);
	} catch (err: any) {
		// 【設計】送信失敗は黙殺（ログ出力のみ）。失われたログの再送はしない
		if (Env.NODE_ENV === "development") {
			console.error("🚨 Failed to flush frontend log batch", {
				message: err.message,
				full: err,
				count: logs.length,
			});
		}
	}
};

const clearFlushTimer = (): void => {
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
};

/**
 * キューに溜まっているログを即座にバッチ送信する。
 * 件数上限到達時・バックグラウンド遷移時・タイマー満了時に呼び出される。
 */
export const flushLogQueue = (): void => {
	clearFlushTimer();
	if (queue.length === 0) return;

	const logs = queue;
	queue = [];
	void sendBatch(logs);
};

/**
 * フロントエンドログをローカルキューへ蓄積する。
 * 件数が FLUSH_BATCH_SIZE に達した場合は即時flushし、それ以外は
 * FLUSH_INTERVAL_MS 後にflushするタイマーを(未予約なら)予約する。
 */
export const enqueueLog = (dto: CreateFrontendLogDto): void => {
	queue.push(dto);

	if (queue.length >= FLUSH_BATCH_SIZE) {
		flushLogQueue();
		return;
	}

	if (!flushTimer) {
		flushTimer = setTimeout(flushLogQueue, FLUSH_INTERVAL_MS);
	}
};

// #1012 【設計】バックグラウンド遷移直前のログを消失させないよう、AppState監視でキューをflushする
// (features/dishMedia/hooks/useMediaTracking.ts のAppState監視パターンを参考に、モジュール単位で1回だけ購読する)
AppState.addEventListener("change", (nextState: AppStateStatus) => {
	if (nextState === "background" || nextState === "inactive") {
		flushLogQueue();
	}
});
