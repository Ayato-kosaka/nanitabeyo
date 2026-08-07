// #1196 error-triage / 契約とガードレールの定数。
//
// このファイルは「外部I/Oゼロ」の純モジュール群の一部。ネットワークもファイルシステムも触らない。
// 値はすべて凍結し、呼び出し側が書き換えられないようにする（上限を可変にすると上限ではなくなる）。

"use strict";

/**
 * 契約（エンベロープ）のスキーマ版。破壊的変更のたびにインクリメントする。
 * 横断レビュー §3 / G7 で数値 1 に統一された（`"error-triage/v1"` ではない）。
 */
const SCHEMA_VERSION = 1;

/**
 * fingerprint 定義（正規化ルール表 + キー構成 + ハッシュ合成）の世代。
 *
 * 横断レビュー 1-3: fingerprint 定義は SQL 側の正規化と JS 側の合成の両方に跨がるため、
 * 「JS の定数1つ」を唯一の正とし、SQL ファイル冒頭の `-- fpalgo: N` と一致することを
 * ユニットテストで検査する（一致検査の実装は fingerprint.js の parseSqlFpAlgoVersion）。
 * 片方だけ変えて既存 Issue と全件突合が外れる事故を構造的に防ぐ。
 */
const FP_ALGO_VERSION = 1;

/** surface の既知3値。これ以外は契約違反として破棄する（不変条件 6）。 */
const SURFACES = Object.freeze(["frontend", "backend", "external"]);

/** 正規化済みメッセージの最大長。ハッシュ入力と Issue タイトルを有界にする（#1197 §3-2）。 */
const MESSAGE_PATTERN_MAX_LENGTH = 200;

/**
 * 集計窓の既定の遡り時間。24h + 1h の重複で schedule 遅延の取りこぼしを防ぐ（#1199 §3 / G1）。
 * 重複ぶんは fingerprint 突合が吸収するので二重起票にはならないが、
 * `occurrences` は run 間で重複し得る（G6）。
 */
const DEFAULT_LOOKBACK_HOURS = 25;

/** 1 run で SQL から受け取るグループ数の上限。超過は runSummary.truncated で必ず可視化する（G3）。 */
const GROUP_LIMIT = 500;

/**
 * BigQuery ジョブのスキャン上限（バイト）。200MB。
 * 実際に `--maximum_bytes_billed` へ載せるのは PR2 の bq.js だが、
 * 「Workflow の env / inputs から渡せない定数」であることをここで固定しておく（#1199 §5）。
 */
const MAX_BYTES_BILLED = 200000000;

/** 1 run あたりの新規起票上限（#1196 で確定）。 */
const CREATE_LIMIT = 5;
/** 1 run あたりの reopen 上限。回帰の一斉 reopen による通知洪水を防ぐ（#1198 §2）。 */
const REOPEN_LIMIT = 5;
/** 1 run あたりの body 更新上限（#1198 §2）。 */
const BODY_UPDATE_LIMIT = 20;
/** 未知 fingerprint がこれを超えたら1件も起票せず abort（#1198 §3 の PANIC ブレーカー）。 */
const PANIC_THRESHOLD = 50;
/** 再発判定の猶予時間。close 直前ログの遅延取り込みを吸収する（#1198 §5-A）。 */
const GRACE_HOURS = 24;
/** 猶予後にこの件数以上出ていないと reopen しない（#1198 §5-A(2)）。 */
const MIN_EVENTS_REOPEN = 3;

/**
 * 一時障害として扱う HTTP ステータス。
 *
 * ★ `app-expo/lib/logQueue.ts` の `TRANSIENT_STATUSES`（同ファイル 60行目付近）と同一定義。
 *   あちらのコメントを引くと:
 *     「5xx と TRANSIENT_STATUSES は transient、それ以外の4xx（= 400/403/404/422 など、
 *       送信しているDTOやエンドポイントの契約が壊れている状態）だけを rejected とする。」
 *   401=flush中のトークン失効レース / 408=経路タイムアウト / 425=リプレイ懸念の再送要求 /
 *   426=アプリバージョン起因（maintenance.guard） / 429=レート制限。
 *
 * 片方だけ書き換えると「このリポジトリが不具合とみなす4xx」の定義が2つに割れるので、
 * 変更するときは必ず app-expo/lib/logQueue.ts と揃えること（相互参照コメントは向こうにも無い点に注意）。
 */
const TRANSIENT_HTTP_STATUSES = Object.freeze([401, 408, 425, 426, 429]);

/**
 * トリアージ対象から除外する HTTP ステータス（横断レビュー §6-4 / S3 の結論）。
 *
 * = TRANSIENT_HTTP_STATUSES + 403 + 404。
 * - 403 / 404 は Cloud Run が公開エンドポイントである以上、外部スキャナ由来のノイズが乗るため除外する。
 * - **400 / 409 / 422 は残す。** このリポジトリは logQueue.ts で既に
 *   「400/422 は契約が壊れている状態＝不具合」と定義済みであり、この API の一次クライアントは
 *   自前の app-expo なので ValidationError 400 はほぼ常に自分たちの DTO 不整合＝実バグ。
 *   #1197 §4 の E6（backend 4xx 一律除外）をそのまま入れると、リリース直後の
 *   スキーマ不整合という最も検知したい事故が丸ごと消える。
 *
 * frontend の E4 と backend の E6 はこの同じ定数を共有する。
 */
const EXCLUDED_HTTP_STATUSES = Object.freeze([...TRANSIENT_HTTP_STATUSES, 403, 404].sort((a, b) => a - b));

/** 除外理由の識別子（runSummary.excludedBreakdown の reason に載る値）。 */
const EXCLUSION_REASONS = Object.freeze([
	"unknown_build_meta", // E1 frontend の created_commit_id が unknown- 始まり
	"unauthenticated_race", // E2 Supabase access_token is missing
	"client_network", // E3 frontend api_call_error かつ status=0
	"transient_status", // E4 frontend の EXCLUDED_HTTP_STATUSES
	"user_denied_permission", // E5 位置情報の権限拒否（S2: kind は denied/timeout/unavailable/unsupported の4値）
	"expected_client_error", // E6 backend の EXCLUDED_HTTP_STATUSES
	"external_transient", // E7 外部API側の一時障害
]);

module.exports = Object.freeze({
	SCHEMA_VERSION,
	FP_ALGO_VERSION,
	SURFACES,
	MESSAGE_PATTERN_MAX_LENGTH,
	DEFAULT_LOOKBACK_HOURS,
	GROUP_LIMIT,
	MAX_BYTES_BILLED,
	CREATE_LIMIT,
	REOPEN_LIMIT,
	BODY_UPDATE_LIMIT,
	PANIC_THRESHOLD,
	GRACE_HOURS,
	MIN_EVENTS_REOPEN,
	TRANSIENT_HTTP_STATUSES,
	EXCLUDED_HTTP_STATUSES,
	EXCLUSION_REASONS,
});
