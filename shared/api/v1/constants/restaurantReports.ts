/**
 * 🏪 店舗情報の «この情報が違う» 報告（`restaurant_reports`）の共有定義（#1933 / 決定元: #1827）。
 *
 * API・app・e2e がこの 1 ファイルだけを見るようにする。
 *
 * ⚠️ ここの配列は **`restaurant_reports` の CHECK 制約と同じ集合**でなければならない
 * （migration: `infra/supabase/migrations/20260923T0000_create_restaurant_reports.sql`）。
 * 片方だけ増やすと、API は 201 を返すのに INSERT が落ちる（`content_reports` で
 * 同じ形の落とし穴が既に文書化されている）。
 *
 * ⚠️ **通報（`content_reports`）とは別物である。** 通報は «消すかどうか»、報告は
 * «値を直すかどうか» で、持つべき列も運用も違う（2026-09-23 オーナー判断
 * 「テーブルが違うなら分けるべき」）。共通化しないこと。
 */

/**
 * 何が違うのか（報告できる項目）。
 *
 * ⚠️ **«店舗画面に出ていて、ユーザーが間違いに気づけるもの» だけを入れる。**
 * 2026-09-23 に画面を撮って確定した（`docs/evidence/1933/01-detail-with-data.png`）。
 *
 * - `name` … 店名。画面の一番上に出ている
 * - `closed` … 閉店した。画面に表示は無いが、**行けば分かる**種類の誤り
 * - `opening_hours` … 営業時間。#1666 で入った。出所と取得日つきで出ている
 *
 * 住所・位置は **画面に 1 文字も出ていない**ので入れない（「Google マップで開く」で
 * 外部アプリへ出るだけ）。見えないものは «違う» と気づきようがなく、報告口だけ作っても
 * 判定しようのない行が溜まる。画面へ出すようになったら、ここと CHECK 制約の両方へ足す。
 *
 * ⚠️ 並び順はそのまま選択肢の表示順になる。
 */
export const RESTAURANT_REPORT_FIELDS = ["name", "closed", "opening_hours"] as const;

export type RestaurantReportField = (typeof RESTAURANT_REPORT_FIELDS)[number];

/**
 * 「正しい値」の入力を伴わない項目。
 *
 * `closed`（閉店した）は事実の申告であって値を持たないので、`proposed_value` は NULL になる。
 * DB 側も `proposed_value` を NULL 可にしてある。
 */
export const RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE: readonly RestaurantReportField[] = [
	"closed",
];

/**
 * オーナーの処理ステータス。
 *
 * ⚠️ `content_reports` にある `reviewing` は**置かない**。報告は 1 件ごとに Issue が立ち、
 * その Issue が open であること自体が «確認中» を表すため、DB 側に中間状態を持つと
 * Issue と DB の 2 か所で状態を管理することになる（必ずずれる）。
 */
export const RESTAURANT_REPORT_STATUSES = ["pending", "actioned", "rejected"] as const;

export type RestaurantReportStatus = (typeof RESTAURANT_REPORT_STATUSES)[number];

/**
 * 「正しい値」の最大文字数。
 *
 * DB 側にも `CHECK (char_length(proposed_value) <= 500)` を置いてある。
 * DTO だけで守ると、API を経由しない経路で青天井になる。
 */
export const RESTAURANT_REPORT_PROPOSED_VALUE_MAX_LENGTH = 500;
