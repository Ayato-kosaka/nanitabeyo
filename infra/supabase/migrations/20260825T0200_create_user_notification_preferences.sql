-- 変更チケット: #1510 SET-02 通知をカテゴリ別にオン/オフする
--
-- ## 目的
-- ユーザー × 通知カテゴリ単位の受信設定 user_notification_preferences を新設する。
--
-- ## 背景
-- 通知の基盤（notifications / notification_recipients / user_device_tokens）は既にあるが、
-- 「どの種別を受け取るか」をユーザーが選ぶ手段が無く、全部届くか OS レベルで全部切るかの二択だった。
-- プッシュ送信の可否はサーバー側（api/src/internal/notifications/notification-job.service.ts）で
-- 判定するため、端末ローカル保存では足りない。既読カーソル（user_notification_cursors）や
-- デバイストークン（user_device_tokens）と同様に「ユーザー × 通知」の専用テーブルとして分離する。
--
-- ## 実装方針
-- - 行が無い = 未設定 = カテゴリの既定値に従う（現状すべてオン）。
--   リーダー判断により、既存ユーザーへのバックフィルは行わない。ユーザーがオフにしたときに初めて行が出来る。
-- - category は text とし CHECK も enum も置かない。カテゴリの正は
--   shared/api/v1/constants/notification-categories.ts の対応表であり、
--   カテゴリ追加のたびに migration を要求しない構成にする
--   （action_type / target_table に CHECK を置いていない既存方針と同じ）。
-- - enabled は boolean。「行の存在＝オフ」にはしない。将来 既定オフのカテゴリを足したときに
--   「明示的にオンにした」を表現できなくなるため。
--
-- ## 既存データへの影響
-- 無し（新規テーブルのみ。既存テーブルは一切変更しない）。
-- 適用直後は行が 0 件 = 全ユーザー全カテゴリ既定値（オン）= 現行挙動と完全に同一。
--
-- ## 適用順
-- API のデプロイより先に適用する（API 側がこのテーブルを参照するため）。
-- 逆順でも「テーブルが無い＝設定を引けない」だけで、実装側は既定値（オン）へフォールバックせず
-- 例外を投げて Cloud Tasks のリトライに乗るため、通知が黙って消えることはない。
--
-- ## ロールバック
-- DROP TABLE IF EXISTS user_notification_preferences;

-- 依存拡張
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- Table: user_notification_preferences
-- 役割: 通知カテゴリ別の受信設定（ユーザー × カテゴリ。行が無ければ既定値）
-- =========================

CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id     uuid NOT NULL,
  category    text NOT NULL,
  enabled     boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);

-- コメント
COMMENT ON TABLE user_notification_preferences IS '通知カテゴリ別の受信設定（ユーザー×カテゴリ。行が無ければ既定値）';
COMMENT ON COLUMN user_notification_preferences.category IS '通知カテゴリ key（likes / saves / group_votes 等。対応表は shared 側で管理し CHECK は置かない）';
COMMENT ON COLUMN user_notification_preferences.enabled IS 'true=受け取る / false=プッシュを止める（アプリ内一覧には残る）';

-- 索引
-- 参照は送信直前の (user_id, category) 1 点引きと、設定画面の user_id 前方一致のみ。
-- どちらも PK の複合索引で足りるため追加索引は作らない。

-- RLS（有効化のみ。ポリシーは作らない＝クライアント直アクセス不可、API 経由のみ）
-- user_device_tokens（20251031T0005）と同じ作法。
ALTER TABLE user_notification_preferences ENABLE ROW LEVEL SECURITY;
