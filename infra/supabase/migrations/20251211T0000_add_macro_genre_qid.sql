-- チケット: macro_genre_qid 付与バッチ（Wikidataベース） #533
-- ## 内容
-- - `dish_categories` テーブルに `macro_genre_qid` カラムを追加
-- - ancestor 保存用テーブル `dish_category_ancestors` を作成
-- - macro_genre ホワイトリストテーブル `macro_genre_whitelist` を作成
------------------------------------------------------------------------------------------------------------
-- ## 背景 / 目的
-- - カテゴリレコメンドAPIでスレート多様性制御のために、
--   料理カテゴリを粗い料理枠（macro_genre）にマッピングする必要がある
-- - Wikidata の ancestor 情報をオフラインで保存し、ホワイトリストベースで macro_genre を決定する
------------------------------------------------------------------------------------------------------------
-- ## ロールバック
-- - `ALTER TABLE dish_categories DROP COLUMN macro_genre_qid;`
-- - `DROP TABLE IF EXISTS dish_category_ancestors;`
-- - `DROP TABLE IF EXISTS macro_genre_whitelist;`
------------------------------------------------------------------------------------------------------------

-- =========================================
-- Up
-- =========================================

-- 1) dish_categories に macro_genre_qid カラムを追加
ALTER TABLE dish_categories
  ADD COLUMN macro_genre_qid TEXT NULL;

COMMENT ON COLUMN dish_categories.macro_genre_qid IS '料理カテゴリを分類するためのマクロジャンルのWikidata QID（例: ヌードルスープの場合はQ4939235）';

-- 2) dish_category_ancestors テーブルを作成
-- ancestor（P31/P279 で辿れる上位概念）を保存
CREATE TABLE dish_category_ancestors (
  dish_category_id TEXT NOT NULL REFERENCES dish_categories(id) ON DELETE CASCADE,
  ancestor_qid     TEXT NOT NULL,
  depth            INTEGER NOT NULL,
  PRIMARY KEY (dish_category_id, ancestor_qid)
);

CREATE INDEX idx_dish_category_ancestors_dish_depth
  ON dish_category_ancestors (dish_category_id, depth);

CREATE INDEX idx_dish_category_ancestors_ancestor
  ON dish_category_ancestors (ancestor_qid);

COMMENT ON TABLE dish_category_ancestors IS '料理カテゴリのWikidataにおける上位概念（P31/P279で辿れる）の関係を保存するテーブル';
COMMENT ON COLUMN dish_category_ancestors.dish_category_id IS 'dish_categories.id（Wikidata QID）への参照';
COMMENT ON COLUMN dish_category_ancestors.ancestor_qid IS '上位概念のWikidata QID';
COMMENT ON COLUMN dish_category_ancestors.depth IS 'BFSによる深さ（0=自身、1=直接の親、など）';

-- 3) macro_genre_whitelist テーブルを作成
-- プロダクト側で承認した macro_genre の QID を保存
CREATE TABLE macro_genre_whitelist (
  macro_genre_qid TEXT PRIMARY KEY,
  label_en        TEXT,
  label_ja        TEXT
);

COMMENT ON TABLE macro_genre_whitelist IS '料理カテゴリ分類のために承認されたマクロジャンル';
COMMENT ON COLUMN macro_genre_whitelist.macro_genre_qid IS 'マクロジャンルを表すWikidata QID（例: ヌードルスープの場合はQ4939235）';
COMMENT ON COLUMN macro_genre_whitelist.label_en IS '人間が読みやすいように付与された英語ラベル';
COMMENT ON COLUMN macro_genre_whitelist.label_ja IS '人間が読みやすいように付与された日本語ラベル';

-- =========================================
-- Down (rollback)
-- =========================================
-- 元に戻す場合は、以下のコマンドを実行する
-- ALTER TABLE dish_categories DROP COLUMN IF EXISTS macro_genre_qid;
-- DROP TABLE IF EXISTS dish_category_ancestors;
-- DROP TABLE IF EXISTS macro_genre_whitelist;
