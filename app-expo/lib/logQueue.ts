import { AppState, AppStateStatus } from "react-native";
import type { CreateFrontendLogDto } from "@shared/api/v1/dto";
import { Env } from "@/constants/Env";
import { supabase } from "./supabase";
import { fetchWithAuth } from "./fetchWithAuth";
import { splitLogBatchesByByteSize } from "./logBatchSize";

// #1012 【設計】フロントログ送信のキュー化・バッチ送信(クライアント側)
// useLogger.logFrontendEvent はここへ enqueue するだけにし、実際の送信は
// 件数(20件)または時間(5秒)のいずれか早い方の条件でまとめて行う
const FLUSH_BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 5_000;

let queue: CreateFrontendLogDto[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// #1012 【設計】送信の度に supabase.auth.getSession() を await せずに済むよう、
// Auth状態の変化を購読してアクセストークンをメモリにキャッシュする
// (購読の登録は flushLogQueue 定義後にファイル末尾で行う)
let cachedAccessToken: string | undefined;
let cachedUserId: string | null = null;

const getAccessToken = async (): Promise<string | undefined> => {
	if (cachedAccessToken) return cachedAccessToken;

	const {
		data: { session },
	} = await supabase.auth.getSession();
	cachedAccessToken = session?.access_token;
	return cachedAccessToken;
};

// #1079 【設計】送信結果のカウンタ（プロセス内メモリのみ。永続化しない）
// フロントログ送信の失敗を耐久的に残せる場所は「フロントログ以外の経路」しかなく、
// それは親Issue対象外の「送信経路そのものの再設計」になるため、クライアント側は揮発に留める。
// 主要な失敗モード（要素の検証エラー）はサーバに到達しているのでサーバ側が記録する。
const stats = {
	sentBatches: 0,
	sentLogs: 0,
	/** 契約違反系の4xx（400/403/404/422 など）で落ちた件数（= クライアント側のバグ） */
	droppedByReject: 0,
	/** 5xx / TRANSIENT_STATUSES / ネットワーク / 認証欠落で落ちた件数（一時障害） */
	droppedByTransient: 0,
	/** 2xx だがサーバが要素単位で棄却した件数（#1079 部分受理） */
	partiallyRejected: 0,
	/**
	 * #1194 1 件だけでボディ上限を超えており、送信せずに捨てた件数。
	 * 送れば必ず 413 になり、内容が同じである限り何度でも失敗するため送らない。
	 * ここが増えていたら「ログの payload が大きすぎる」＝ 呼び出し側を直すべきサイン。
	 */
	droppedByOversize: 0,
	/** 直近の失敗の要約。ログ本文は含めない */
	lastFailure: undefined as { status: number | null; kind: string; count: number; at: string } | undefined,
};

/** 送信失敗の分類。rejected は「自分たちの契約が壊れている」、transient は「相手/環境が一時的に落ちている」 */
type FailureKind = "rejected" | "transient";

// #1079 4xx でも「クライアント側の契約違反」ではないステータス。
// droppedByReject は #1076 のような「送っているログのDTOが壊れている」を検知するための数値なので、
// 直せば消えるわけではない・時間や環境で解消する類の4xxを混ぜるとシグナルが汚れる。
//   401 Unauthorized      … flush中のトークン失効レース。次のトークンで送れば通る
//   408 Request Timeout   … サーバ/経路側のタイムアウト
//   425 Too Early         … リプレイ懸念による再送要求
//   426 Upgrade Required  … アプリバージョン起因（maintenance.guard）。ログ本文とは無関係
//   429 Too Many Requests … レート制限
const TRANSIENT_STATUSES: readonly number[] = [401, 408, 425, 426, 429];

/**
 * HTTPステータスから失敗の分類を決める。
 * 5xx と TRANSIENT_STATUSES は transient、それ以外の4xx（= 400/403/404/422 など、
 * 送信しているDTOやエンドポイントの契約が壊れている状態）だけを rejected とする。
 */
const classifyFailure = (status: number): FailureKind =>
	status >= 500 || TRANSIENT_STATUSES.includes(status) ? "transient" : "rejected";

/**
 * #1079 送信の成否を外から観測するための読み取り専用スナップショット（E2E / デバッグ用）
 * lastFailure も複製する。参照を共有すると呼び出し側が持っているスナップショットが
 * 後続のflushで書き換わり、「そのとき何が起きていたか」の観測にならないため。
 */
export const getLogQueueStats = () =>
	Object.freeze({
		...stats,
		lastFailure: stats.lastFailure ? Object.freeze({ ...stats.lastFailure }) : undefined,
	});

const recordFailure = (status: number | null, count: number, kind: FailureKind, err?: any): void => {
	if (kind === "rejected") stats.droppedByReject += count;
	else stats.droppedByTransient += count;
	stats.lastFailure = { status, kind, count, at: new Date().toISOString() };

	// #1079 NODE_ENV に依らず1行だけ出す。flush間隔(5秒)以上の頻度にはならないので
	// production でもコンソールを溢れさせない。ログ本文(payload/path_name)は出さない。
	// production でゲートすると #1076 の「障害が見えない」が再来するため無条件にする。
	console.warn(`⚠️ frontend log batch dropped: kind=${kind} status=${status ?? "n/a"} count=${count}`);

	// 詳細（例外オブジェクト）は development のみ。
	//
	// ⚠️ #1592 **HTTP ステータスを伴わない失敗は `console.error` では出さない。**
	// `status === null` は「サーバが応答を返す前に切れた」ケース（通信断、画面遷移や
	// リロードによる中断など）で、fetch は `TypeError: Failed to fetch` で reject する。
	// flush は 5 秒間隔で走るので、**遷移のたびに飛んでいるリクエストが中断されて普通に起きる**。
	//
	// これを `console.error` で出すと、#1500 で入れた «console error が出たらテストを失敗に
	// する» ゲートを踏み、e2e-web が画面の中身と無関係にまとめて赤くなる
	//（2026-08-25 の main で 223 件中 73 件が失敗。8/21 が最後の緑だった）。
	//
	// **握り潰してはいない。** 同じ内容を `console.warn` で出す。ゲートが拾うのは
	// `console.error` と `pageerror` だけ（`e2e-web/fixtures/test.ts`）なので、
	// 開発時の見え方は保ったままテストの信号だけを回復できる。
	//
	// **ステータスを伴う失敗（400/500 など）は今までどおり `console.error`。**
	// #1076 で検知したかった «送っているログの DTO が壊れていて 400 で全滅する» は
	// サーバが応答を返す側なので、この切り分けで失われない。
	if (Env.NODE_ENV === "development" && err) {
		const detail = { message: err.message, full: err, count };
		if (status === null) {
			console.warn("⚠️ frontend log batch aborted before the server responded", detail);
		} else {
			console.error("🚨 Failed to flush frontend log batch", detail);
		}
	}
};

const sendBatch = async (logs: CreateFrontendLogDto[]): Promise<void> => {
	if (logs.length === 0) return;

	// ⚠️ #1079 この関数と、この関数が呼ぶ全ての処理から
	//    enqueueLog() / useLogger().logFrontendEvent() を呼んではならない。
	//    失敗そのものがログを生むと、原因が入力側にある限り 100% 再び失敗するため収束せず、
	//    FLUSH_BATCH_SIZE(20) の即時flush条件により5秒間隔の制限すら効かない同期ループに落ちる。
	//    報告は console とメモリカウンタのみで行い、失敗したログはキューへ戻さず破棄する（再送しない）。
	try {
		const accessToken = await getAccessToken();
		if (!accessToken) {
			recordFailure(null, logs.length, "transient");
			return;
		}

		const { response } = await fetchWithAuth(
			"v1/logs/frontend/batch",
			{
				method: "POST",
				requestPayload: { logs },
				isMultipart: false,
			},
			accessToken,
		);

		// #1079 fetchWithAuth は非2xxで throw しないため、これまで 400 は catch にすら入らず
		// development でも何も出ていなかった（「黙殺」以前に「未検知」）。ここで明示的に判定する。
		if (!response.ok) {
			recordFailure(response.status, logs.length, classifyFailure(response.status));
			return;
		}

		stats.sentBatches += 1;
		stats.sentLogs += logs.length;

		// #1079 2xx でもサーバが要素単位で棄却しているケースを拾う
		try {
			const body = await response.json();
			const rejected: number = body?.data?.rejected ?? 0;
			if (rejected > 0) {
				stats.partiallyRejected += rejected;
				console.warn(`⚠️ frontend log batch partially rejected: ${rejected}/${logs.length}`);
			}
		} catch {
			// body の解析失敗は無視（送信自体は成功しているため）
		}
	} catch (err: any) {
		// ネットワーク例外・AbortError など
		recordFailure(null, logs.length, "transient", err);
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

	// #1194 件数（20件）で区切るだけではボディ上限を超えうる。
	// 超えると body-parser が Nest へ到達する前に落ちて 500 になり、バッチごと消える
	// （実機で `kind=transient status=500 count=17` として観測）。送る前に必ずバイト数で割る
	const { batches, oversized } = splitLogBatchesByByteSize(logs);

	if (oversized.length > 0) {
		stats.droppedByOversize += oversized.length;
		// ⚠️ ログ本文（payload / path_name）は出さない。件数だけで十分に気付ける
		console.warn(`⚠️ frontend log dropped: kind=oversize count=${oversized.length}`);
	}

	for (const batch of batches) void sendBatch(batch);
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

// #1012 【設計】キューはenqueue時のセッションに紐付ける。ユーザーが変わる場合は
// cachedAccessToken を差し替える前にflushし、旧ユーザーのログが新トークンで送信されて
// API側の user.id により新ユーザーのイベントとして記録されるのを防ぐ。
// flushLogQueue → sendBatch → getAccessToken は最初のawaitまで同期実行されるため、
// この時点では旧トークンが読まれる。
// (SIGNED_OUT で旧トークンが失効済みの場合は送信失敗として黙殺され、従来どおりログは破棄される)
supabase.auth.onAuthStateChange((_event, session) => {
	const nextUserId = session?.user?.id ?? null;
	if (nextUserId !== cachedUserId) {
		flushLogQueue();
		cachedUserId = nextUserId;
	}
	cachedAccessToken = session?.access_token;
});

// #1012 【設計】バックグラウンド遷移直前のログを消失させないよう、AppState監視でキューをflushする
// (features/dishMedia/hooks/useMediaTracking.ts のAppState監視パターンを参考に、モジュール単位で1回だけ購読する)
AppState.addEventListener("change", (nextState: AppStateStatus) => {
	if (nextState === "background" || nextState === "inactive") {
		flushLogQueue();
	}
});
