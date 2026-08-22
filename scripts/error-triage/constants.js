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
 *
 * 世代の履歴:
 *   1 … 初版（#1196 / PR2）
 *   2 … `pathName` の先頭ロケールを剥がす（#1196 CLUSTERING.md 類型1）。
 *       `/ja-JP/search/result` と `/en-US/search/result` が同じ fingerprint になる。
 *       **移行方法は MIGRATABLE_ALGO_VERSIONS と README.md「fingerprint 世代の移行」を参照。**
 */
const FP_ALGO_VERSION = 2;

/**
 * 「旧 fingerprint を復元して既存 Issue と突合できる」世代の一覧（＝リキー可能な世代）。
 *
 * ここに載っている世代の Issue は、`fingerprint.js` の `computeLegacyFingerprints()` が
 * 旧 fingerprint を復元して突合するので、**新 fingerprint で重複起票されない**。
 * ここに載っていない世代（未来の世代 / 復元器を捨てた過去の世代）が索引に混ざったら
 * その run は1件も書かずに abort する（#1198 §8-A）。
 *
 * v1 → v2 の復元が可能なのは、v2 が「v1 の pathName から先頭ロケールを剥がす」だけの変更で、
 * 剥がしたロケールの内訳（`localeCounts`）を SQL が出力に残しているため
 * （`/` + locale + newPathName で v1 の pathName が**厳密に**再構成できる）。
 */
const MIGRATABLE_ALGO_VERSIONS = Object.freeze([1]);

/** 索引に載っていてよい世代（現行 + 復元可能な旧世代）。 */
const SUPPORTED_ALGO_VERSIONS = Object.freeze([...MIGRATABLE_ALGO_VERSIONS, FP_ALGO_VERSION].sort((a, b) => a - b));

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
 * 1グループあたりに出すロケール内訳（`localeCounts`）の件数上限。
 *
 * ロケールは端末の言語設定そのものなので理論上は数百種になり得る。
 *
 * ⚠️ **移行中（`pendingAlgoVersions` が空でない間）は、ここで溢れたロケールが重複起票を生み得る。**
 *   `computeLegacyFingerprints()` が復元できる旧 fingerprint は、その run の `localeCounts` に
 *   載っているロケールぶんだけである。旧 Issue が持つロケールが溢れて載らなかった場合、
 *   「リキーを取り逃がす」のではなく **突合そのものが外れて `create` になる**（＝旧 Issue が孤児化する）。
 *   同じ穴は「旧 Issue のロケールがその run の窓に1件も出ていない」ときにも開く。
 *   → その対処として、移行中は frontend の起票を保留する（`buildPlan()` の `withheld`）。
 *   REKEY_LIMIT 側の「溢れても重複起票にはならない」は**突合が成立した後**の後片付けの話であって、
 *   こちらとは別問題。混同しないこと。
 */
const LOCALE_BREAKDOWN_LIMIT = 50;

/**
 * BigQuery ジョブのスキャン上限（バイト）。1GB。
 * 実際に `--maximum_bytes_billed` へ載せるのは PR2 の bq.js だが、
 * 「Workflow の env / inputs から渡せない定数」であることをここで固定しておく（#1199 §5）。
 *
 * #1196 【実測】当初は 200MB だったが、**2026-08-19 の run がこの上限で落ちて**引き上げた
 * （見積り 249,701,781 バイト > 200,000,000 バイト → クエリを投げずに abort）。
 * 原因は障害ではなく利用者の増加で、25h 窓のログ量が 08-18 に約 3 倍へ跳ねた
 * （ユーザー 394 → 1,478 人/日。error 率は 4.17% → 4.48% でほぼ横ばい）。
 *
 * ⚠️ **クエリ側の節約余地はほぼ無い。** 同じ窓を dry-run で実測すると:
 *
 *   | 読む列 | 見積り |
 *   |---|---|
 *   | 現行の全列 | 382 MB |
 *   | `jsonPayload.payload` を除く 12 列 | 59 MB |
 *
 * つまり **85% が `payload` の 1 列**で、これは messagePattern の正規化＝fingerprint の
 * 素材なので落とせない。そして Sink テーブルは `timestamp` の DAY パーティションのみで
 * **クラスタリングが無い**ため、`error_level = 'error'`（全行の約 4%）で絞っても
 * スキャンバイトは減らない。列を削る以外に効く手が無く、残り 12 列はすべて出力契約で使っている。
 *
 * したがってここは「使う量に合わせて上限を上げる」以外に手が無い。1GB は現行 240MB/日に対して
 * 約 4 倍の余裕で、月 30GB ＝ BigQuery 無料枠 1TB の 3%（従量でも月 $0.2 未満）に収まる。
 * さらに増えて再び落ちたら、**上限を上げる前に「利用者が増えたのか、障害でログが暴れているのか」を
 * 必ず error 率で切り分けること。** 後者なら上げてはいけない。
 */
const MAX_BYTES_BILLED = 1000000000;

/**
 * 1 run あたりの新規起票上限。
 *
 * #1196 の当初値は 5 だったが、**オーナー判断で 20 へ引き上げ**た（#1196「オーナー対応・判断結果」）。
 * 根拠は実データ: PR2 の dry-run を本番で回し、25h 窓の除外後エラーグループは **21 件**
 * （backend 10 / frontend 11、保持行 5,575）だった。除外前 526 件のうち 505 件は
 * `ApiExceptionFilter` / `HttpException` の 404（`wp-login.php` `.env` `wp-json/` 等の
 * 外部脆弱性スキャナ）で、E6 の除外が正しく落としている。
 * 5 のままだと 21 件を捌くのに5日かかり、その間ずっと「毎日5件ずつ増える」状態になる。
 * 20 なら初回 20 件・翌日 1 件で収束する。
 */
const CREATE_LIMIT = 20;
/** 1 run あたりの reopen 上限。回帰の一斉 reopen による通知洪水を防ぐ（#1198 §2）。 */
const REOPEN_LIMIT = 5;
/** 1 run あたりの body 更新上限（#1198 §2）。 */
const BODY_UPDATE_LIMIT = 20;
/**
 * 1 run あたりの fingerprint リキー（旧世代マーカーの書き換え）上限。
 *
 * リキーは body の PATCH なので通知は飛ばないが、`updated_at` は動く。
 * 上限で溢れても**重複起票にはならない**（突合は旧 fingerprint の復元で成立しており、
 * リキーはマーカーの後片付けにすぎない）ので、次回 run へ繰り越して構わない。
 */
const REKEY_LIMIT = 50;
/** 未知 fingerprint がこれを超えたら1件も起票せず abort（#1198 §3 の PANIC ブレーカー）。 */
const PANIC_THRESHOLD = 50;
/** 再発判定の猶予時間。close 直前ログの遅延取り込みを吸収する（#1198 §5-A）。 */
const GRACE_HOURS = 24;
/** 猶予後にこの件数以上出ていないと reopen しない（#1198 §5-A(2)）。 */
const MIN_EVENTS_REOPEN = 3;

// ---------------------------------------------------------------------------
// PR3: GitHub 同期側の定数
// ---------------------------------------------------------------------------

/** 起票先の親 Issue。Sub-issue 紐付けと常駐サマリコメントの置き場所（#1196）。 */
const PARENT_ISSUE_NUMBER = 1196;

/**
 * 索引に使うラベル。**1枚だけ**（横断レビュー §4 で `err/auto` の追加は却下）。
 * 冗長化はラベルの枚数ではなく「親の sub_issues を第2の索引源にする」で行う。
 */
const TRIAGE_LABEL = "error-triage";

/** 恒久無視のラベル。オーナーが作成済み（色 `#6e7781`）。スクリプトからは作らない。 */
const SKIP_LABEL = "err/skip";

/**
 * 索引のページング上限（100件/page × 50 = 5000件）。
 * 超えたら**1件も書かずに abort** する。部分索引のまま起票すると既存 Issue を重複起票する（#1198 §1-B）。
 */
const MAX_INDEX_PAGES = 50;

/** 再発判定 (3) の commit 日時解決に使う API 呼び出しの上限 / run（#1198 §2）。 */
const COMMIT_LOOKUP_LIMIT = 30;

/** 1 run で貼り直す sub-issue 紐付けの上限。best-effort なので溢れたら次回に回す。 */
const SUB_ISSUE_LINK_LIMIT = 20;

/**
 * 親1件あたりの sub-issue 上限（100 と認識。#1198 §10-1 は未確認としている）と、警告を出す閾値。
 *
 * ★ S11: **上限接近時に古い sub-issue を親から自動 DELETE してはならない**（#1198 §7-14 は削除）。
 *   紐付け自体が best-effort な状態で付け外しを自動化すると reconcile と競合して振動する。
 *   ここでできるのは**警告だけ**で、外すかどうかは人間が決める。
 */
const SUB_ISSUE_SOFT_LIMIT = 100;
const SUB_ISSUE_WARN_THRESHOLD = 80;

/** 自動領域を最後に更新してからこの日数が過ぎたら、変化が無くても body を更新する（#1198 §6-C(2)）。 */
const BODY_STALE_DAYS = 7;

/** GET のリトライ回数。**POST / PATCH / DELETE はリトライしない**（#1198 §7-4）。 */
const GET_RETRY_LIMIT = 3;

/** 起票の POST が結果不明で落ちたときに、索引を読み直すまで待つ時間（ms）（#1198 §7-4 / §10-5）。 */
const CREATE_RECHECK_DELAY_MS = 3000;

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
	// E5 端末が現在地を返せない（kind = denied/timeout/unavailable）。
	//    「権限拒否」だけではないので user_denied_permission から改名した。除外の対象は
	//    current_location_* の event に閉じてある（sql-generator.js の E5 を参照）。
	"device_location_failed",
	"expected_client_error", // E6 backend の EXCLUDED_HTTP_STATUSES
	"external_transient", // E7 外部API側の一時障害
]);

module.exports = Object.freeze({
	SCHEMA_VERSION,
	FP_ALGO_VERSION,
	MIGRATABLE_ALGO_VERSIONS,
	SUPPORTED_ALGO_VERSIONS,
	SURFACES,
	MESSAGE_PATTERN_MAX_LENGTH,
	DEFAULT_LOOKBACK_HOURS,
	GROUP_LIMIT,
	LOCALE_BREAKDOWN_LIMIT,
	MAX_BYTES_BILLED,
	CREATE_LIMIT,
	REOPEN_LIMIT,
	BODY_UPDATE_LIMIT,
	REKEY_LIMIT,
	PANIC_THRESHOLD,
	GRACE_HOURS,
	MIN_EVENTS_REOPEN,
	PARENT_ISSUE_NUMBER,
	TRIAGE_LABEL,
	SKIP_LABEL,
	MAX_INDEX_PAGES,
	COMMIT_LOOKUP_LIMIT,
	SUB_ISSUE_LINK_LIMIT,
	SUB_ISSUE_SOFT_LIMIT,
	SUB_ISSUE_WARN_THRESHOLD,
	BODY_STALE_DAYS,
	GET_RETRY_LIMIT,
	CREATE_RECHECK_DELAY_MS,
	TRANSIENT_HTTP_STATUSES,
	EXCLUDED_HTTP_STATUSES,
	EXCLUSION_REASONS,
});
