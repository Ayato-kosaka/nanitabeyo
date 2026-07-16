-- ==============================================================================
-- 20260715T0000_create_dish_category_label_alias_overrides.sql
-- ==============================================================================
-- 手動 label / alias 補正テーブルを追加する。
--
-- ## 目的
-- Wikidata の label は百科事典としては正しくても、Nanitabeyo の検索・表示・料理名としては
-- 長すぎる、あるいは日本の飲食店検索で一般的ではないことがある。
--
-- 例:
--   Q1419233
--   Wikidata label_ja: アーリオ・オーリオ・エ・ペペロンチーノ
--   実運用で望ましい代表名: ペペロンチーノ
--
-- dish_category_catalog を直接 UPDATE すると、3_2_refresh_dish_category_catalog_core.py の
-- 再実行時に Wikidata 値へ戻ってしまう。そこで「人手で採用した補正」を別テーブルに
-- 永続化し、3_4_apply_label_alias_overrides.py で refresh 後に再適用する。
--
-- ## 反映ルール
-- - apply_to_label = TRUE:
--   - surface_form を対象 locale の代表 label に昇格する
--   - 上書き前の元 label は aliases_json に降格して保持する
-- - apply_to_label = FALSE:
--   - 代表 label は変えず、surface_form を aliases_json に追加する
-- - 同一 item_qid + locale で apply_to_label = TRUE が複数ある場合は 3_4 側でエラー
--
-- ## 注意
-- このテーブルは補正元の監査ログに近い「採用ルール」であり、Serving が直接読む
-- dish_category_variant_catalog のスキーマは変更しない。
-- ==============================================================================

CREATE TABLE IF NOT EXISTS `${DATASET}.dish_category_label_alias_overrides` (
  item_qid        STRING NOT NULL,    -- dish_category QID（例: Q1419233）
  locale          STRING NOT NULL,    -- BCP47/短縮 locale（現状は主に ja / en を想定）
  surface_form    STRING NOT NULL,    -- 採用したい表記。label 昇格または alias 追加の対象
  apply_to_label  BOOL NOT NULL,      -- TRUE: 代表 label に昇格 / FALSE: alias 追加のみ
  source          STRING NOT NULL,    -- 'manual' など。将来 rule / llm も許容できる余地を残す
  note            STRING,             -- 補正理由。Google Maps 検索精度など運用判断を残す
  created_at      TIMESTAMP NOT NULL, -- 初回登録日時
  updated_at      TIMESTAMP NOT NULL  -- 最終更新日時
);
