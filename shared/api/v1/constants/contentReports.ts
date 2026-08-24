/**
 * 🚩 コンテンツの通報（`content_reports`）の共有定義（#1514 / SAF-01）。
 *
 * API・app・e2e がこの 1 ファイルだけを見るようにする。
 *
 * ⚠️ ここの配列は **`content_reports` の CHECK 制約と同じ集合**でなければならない
 * （migration: `infra/supabase/migrations/20260826T0300_create_content_reports.sql`）。
 * 片方だけ増やすと、API は 201 を返すのに INSERT が落ちる（`share_links` で同じ形の
 * 落とし穴が既に文書化されている）。
 */

/**
 * 通報できる対象の種別。
 *
 * ⚠️ **値は「対象テーブル名」にすること。** このリポジトリの `target_type` は
 * `reactions` / `contribution_tasks` / `share_links` で既に対象テーブル名を採っている。
 *
 * 対象は **投稿（`dish_media`）とレビュー（`dish_reviews`）**。オーナー確定仕様により、
 * ユーザー・店舗は対象外。列を polymorphic にしてあるのは、対象が増えたときに
 * テーブルを作り直さずに済ませるためで、増やすときは
 * **CHECK 制約の変更（= migration）とこの配列の両方**が要る。
 * 加えて API 側の存在検証（`ContentReportsRepository.existsTarget`）の分岐も要る
 * （足し忘れは `never` 代入でコンパイルエラーになる）。
 */
export const CONTENT_REPORT_TARGET_TYPES = ["dish_media", "dish_reviews"] as const;

export type ContentReportTargetType = (typeof CONTENT_REPORT_TARGET_TYPES)[number];

/**
 * 通報理由コード。
 *
 * 自由記述だけにしないのは、運営が「同じ理由の通報が何件あるか」を集計できないと
 * 優先順位を付けられないため。表示文言は i18n（app-expo/locales/*.json の `Report.reasons`）で、
 * **8 言語すべてに同じキーが存在すること**が前提。
 *
 * 投稿・レビューで同じ集合を使う。`irrelevant`（料理・飲食店と関係がない）まで含めて
 * どちらにも意味が通るので、対象種別ごとに理由を出し分けない。
 *
 * ⚠️ 並び順はそのまま選択肢の表示順になる。`other`（その他）は最後に置くこと。
 */
export const CONTENT_REPORT_REASON_CODES = [
	/** スパム・宣伝目的の投稿 */
	"spam",
	/** 性的なコンテンツ */
	"sexual",
	/** 暴力的・不快なコンテンツ */
	"violence",
	/** 嫌がらせ・誹謗中傷 */
	"harassment",
	/** 違法行為（無許可営業・薬物など） */
	"illegal",
	/** 店舗・料理についての誤った情報 */
	"misinformation",
	/** 著作権などの権利侵害 */
	"rights",
	/** 個人情報が写り込んでいる */
	"privacy",
	/** 料理・飲食店と関係のない内容 */
	"irrelevant",
	/** その他 */
	"other",
] as const;

export type ContentReportReasonCode = (typeof CONTENT_REPORT_REASON_CODES)[number];

/**
 * 運営側の処理ステータス。
 *
 * 今回のスコープでは API が `pending` を作るところまでで、遷移させる導線は無い
 * （審査結果の通知は #1514 のスコープ外）。列と値だけ先に確定させておく。
 */
export const CONTENT_REPORT_STATUSES = ["pending", "reviewing", "actioned", "rejected"] as const;

export type ContentReportStatus = (typeof CONTENT_REPORT_STATUSES)[number];

/**
 * 自由記述の最大文字数。
 *
 * DB 側にも `CHECK (char_length(reason_text) <= 1000)` を置いてある。
 * DTO だけで守ると、API を経由しない経路（将来のバッチ等）で青天井になる。
 */
export const CONTENT_REPORT_REASON_TEXT_MAX_LENGTH = 1000;
