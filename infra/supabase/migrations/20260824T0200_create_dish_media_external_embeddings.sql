-- NOTE: 旧 20260819T0200_create_dish_media_external_embeddings.sql からのリネーム（#1469 ブランチが dev へ旧名で先行適用済み。SQL 本体は同一で、全体が冪等なので再適用は無害）。
-- リネーム理由: main の 20260823T0000 より後ろに並べ、「ファイル名順 = 適用順」を守るため。
-- ==============================================================================
-- 20260819T0200_create_dish_media_external_embeddings.sql
-- #1395（親 #1375 / #1273 §14・§39 準拠）/ #1399（自然キーへ dish_id を追加・
-- thumbnail_url を追加）
--
-- ⚠️ このテーブルは **まだ public（本番）へ適用していない**。
--    public の最終適用は 20260807T0100 で、20260819T0000 以降は 1 本も当たっていない。
--    したがって列の追加は「新しい migration を積む」のではなく **このファイルを直接直す**。
--    理由は infra/supabase/migrations/README.md を読むこと。
-- ==============================================================================
-- 【目的】
--   render_type='external_embed' の dish_media が指す「SNS 側の投稿」を保持する。
--   dish_media と 1:1（dish_media_analysis_results と同じく PK = 参照先 ID）。
--
-- 【このテーブルの位置づけ（混同しやすいので明示する）】
--   目的の違う制約が 2 つ同居している。片方でもう片方を説明しないこと。
--
--     1. dish_media_id が PRIMARY KEY 兼 FK
--        → 「どの dish_media にぶら下がるか」。dish_media 1 行につき埋め込みは最大 1 行（1:1）。
--          行を持つのは render_type='external_embed' の dish_media だけで、
--          従来の 'stored' の行は 1 行も持たない。**dish_media 側は何も変わらない。**
--
--     2. UNIQUE (provider, external_content_id, dish_id)
--        → 「同じ SNS 投稿を二重に取り込まない」ため。1 とは無関係の別目的。
--
--   dish_media に列を足さずテーブルを分けたのは、canonical_url / embed_status /
--   last_verified_at が external_embed でしか使われず、dish_media へ足すと
--   既存の大多数（stored）の行で全部 NULL になるためである。
--
-- 【設計上の判断】
--   - oEmbed が返す HTML の列は置かない（#1375 設計の正本 §2 / #1273 §14）。
--     HTML を永続的な SoT にすると provider 側の仕様変更に追随できなくなるため、
--     canonical_url から provider 別コンポーネントが都度描画する。
--   - embed_status / last_verified_at は #1273 §39 の「埋め込み死活監視」バッチが
--     「古い順に再検証」するために使う。
--   - thumbnail_url は **URL を持つだけで複製はしない**（列コメント参照）。
--
-- 【自然キーに dish_id を含める理由（#1399）】
--   (provider, external_content_id) だけでは «同じ投稿を別のユーザーが別の料理として
--   分類する» 取り込みが構造的に失敗する。dishes は (restaurant_id, category_id) で
--   一意なので、同じ動画でも分類が違えば別 dish になり、それぞれに dish_media が要る。
--   自然キーを (provider, external_content_id, dish_id) へ広げることで、
--   «同じ投稿 × 別の料理» は通し、«同じ投稿 × 同じ料理» の二重取り込みは弾く。
--
--   dish_id は dish_media_id から一意に決まる冗長列なので、
--   (dish_media_id, dish_id) → dish_media (id, dish_id) の複合 FK でズレを構造的に禁じる
--   （参照先要件のため dish_media に UNIQUE (id, dish_id) を 1 本張る）。
--   この複合 FK が単一列 FK を包含するので、dish_media_id 単独の FK は張らない。
--
-- 【provider の値域: DB は 4 種・アプリ仕様は 3 種（オーナー判断 2026-08-21）】
--   ⚠️ **DB の CHECK と「アプリとして取り込む対象」は意図的にズラしてある。**
--     - DB の CHECK … instagram / tiktok / youtube / **x** の 4 種を許可する。
--       CHECK は「あり得ない値を弾くガードレール」であり、広めに取る方が
--       将来の拡張と、restaurant_recommendation 系ブランチ（provider に x を含む）
--       との整合の両方にとって都合がよい。
--     - アプリの仕様 … 取り込み対象は **TikTok / YouTube Shorts / Instagram の 3 つ**。
--       X は対象外（#1395 仕様追補）。これは shared/utils/snsUrl.ts の
--       SnsProvider（3 種）が構造的に担保しており、X の URL は parseSnsUrl() が
--       null を返すのでそもそもこのテーブルへ到達しない。
--   つまり「DB で弾く」のではなく「アプリで受け付けない」形にしてある。
--   仕様を変えるときに migration を伴わせないための線引きである。
--
-- 【ロールバック】
--   DROP TABLE IF EXISTS dish_media_external_embeddings;
--   DROP INDEX IF EXISTS uq_dish_media_id_dish_id;
-- ==============================================================================

-- 依存拡張（gen_random_uuid は使わないが、近隣ファイルと同じく明示しておく）
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------
-- 複合 FK の参照先要件
--
-- FOREIGN KEY (dish_media_id, dish_id) → dish_media (id, dish_id) を張るには、
-- 参照先の列組に UNIQUE か PK が要る。id は既に PK なので (id, dish_id) は
-- 常に一意だが、Postgres は「宣言された一意制約」しか参照先に採れない。
-- **CREATE TABLE より前に置くこと**（下の複合 FK が参照する）。
-- ------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_dish_media_id_dish_id
  ON dish_media (id, dish_id);
COMMENT ON INDEX uq_dish_media_id_dish_id IS 'dish_media_external_embeddings の複合 FK (dish_media_id, dish_id) の参照先。#1399';

CREATE TABLE IF NOT EXISTS dish_media_external_embeddings (
  -- dish_media と 1:1。dish_media_analysis_results（20251025T0201）と同じく PK = 参照先 ID
  dish_media_id       uuid NOT NULL,

  -- dish_media.dish_id と必ず一致する冗長列。自然キーに含めるために持つ
  dish_id             uuid NOT NULL,

  provider            text NOT NULL,
  external_content_id text NOT NULL,
  canonical_url       text NOT NULL,
  embed_status        text NOT NULL DEFAULT 'unknown',
  last_verified_at    timestamptz(6) NULL,

  -- #1641 **埋め込みの «枠» の中で再生できるか。** embed_status とは直交する。
  --
  --   embed_status     … 投稿そのものが生きているか（削除・非公開）
  --   playback_status  … 生きている投稿が、埋め込みで再生できるか
  --
  -- 混ぜてはいけない。権利ブロックされた投稿がその後削除されることは普通に起こるし、
  -- 死活監視（#1273 §39）は «生きている» と分かったら embed_status へ 'available' を書くので、
  -- 同居させると**権利ブロックの記録がその瞬間に消える**。
  --
  -- ⚠️ 'not_playable' でも投稿は生きている。サムネイル・キャプション・店舗照合・
  --    provider のアプリへのリンク遷移はすべて有効である（'unavailable' とは扱いが違う）。
  playback_status     text NOT NULL DEFAULT 'unknown',
  -- 'not_playable' のときだけ理由が入る。トリアージ用であって分岐には使わない
  playback_reason     text NULL,
  -- 最後に playback_status を判定した日時。NULL は未判定
  playback_checked_at timestamptz(6) NULL,

  -- #1399 provider 側のサムネイル URL。**自ストレージへ複製した実体ではない**。
  -- 権利調査の結論により、サムネイルは複製せず参照する:
  --   Instagram … 画像の persisting が利用規約で明示的に禁止
  --   TikTok    … og:image は参照できるが、CDN の署名 URL は約 48h で失効する
  --   YouTube   … i.ytimg.com は無署名・安定で直接参照できる
  -- provider ごとに扱いが違うので「全部複製」も「全部直接参照」も成立しない。
  -- ここは «参照先» を持つだけで、取れない provider では NULL になる
  -- （表示は料理カテゴリ画像へ落ちる）。dish_media.thumbnail_path（自ストレージのパス）とは別物。
  thumbnail_url       text NULL,

  -- 監査
  created_at          timestamptz(6) NOT NULL DEFAULT now(),
  updated_at          timestamptz(6) NOT NULL DEFAULT now(),

  CONSTRAINT dish_media_external_embeddings_pkey PRIMARY KEY (dish_media_id),

  -- dish_id のズレを構造的に禁じる。単一列 FK はこれに包含されるので張らない
  CONSTRAINT dmee_dish_media_dish_fk
    FOREIGN KEY (dish_media_id, dish_id)
    REFERENCES dish_media (id, dish_id)
    ON DELETE CASCADE,

  -- ⚠️ これらの CHECK / UNIQUE は CREATE TABLE IF NOT EXISTS のインライン制約なので、
  --    既にテーブルがある環境には**反映されない**。ファイル末尾の
  --    「既存テーブルを現行仕様へ揃え直す」ブロックが実体を保証する。
  CONSTRAINT dmee_provider_check
    CHECK (provider IN ('instagram','tiktok','youtube','x')),
  CONSTRAINT dmee_embed_status_check
    CHECK (embed_status IN ('unknown','available','unavailable')),
  CONSTRAINT dmee_playback_status_check
    CHECK (playback_status IN ('unknown','playable','not_playable')),
  -- 理由は «再生できない» ときにしか意味を持たない。
  -- ⚠️ 'playable' / 'unknown' を書くときは、同じ UPDATE で playback_reason = NULL を必ず入れる。
  --    入れないと «権利ブロックが解けた投稿の再取り込み» でここに引っ掛かり、
  --    取り込み API がトランザクションごと落ちる（#1675 独立レビュー 重 3）。
  CONSTRAINT dmee_playback_reason_check
    CHECK (
      playback_reason IS NULL
      OR (playback_status = 'not_playable'
          AND playback_reason IN ('copyright_blocked','embedding_disabled','no_video_in_embed'))
    ),
  -- 同じ投稿 × 同じ料理の二重取り込みを弾く自然キー
  CONSTRAINT dmee_provider_content_dish_uq UNIQUE (provider, external_content_id, dish_id),

  -- PK が dish_media_id なので論理的には冗長。**Prisma のために張っている。**
  -- 複合 FK (dish_media_id, dish_id) で 1:1 を表現するには «参照元側にも複合ユニークが
  -- 宣言されていること» を Prisma が要求する（無いと 1:1 ではなく 1:N として
  -- introspect され、API 側の型が配列になってしまう）。
  CONSTRAINT dmee_media_dish_uq UNIQUE (dish_media_id, dish_id)
);

-- 埋め込み死活監視（#1273 §39）のバッチが「古い順に再検証」するための索引
CREATE INDEX IF NOT EXISTS idx_dmee_status_verified
  ON dish_media_external_embeddings (embed_status, last_verified_at);

-- ⚠️ #1641 **playback_* を使う索引とコメントは、この位置に置けない。**
--    このファイルは «新規作成» と «既存テーブルの揃え直し» を兼ねている。既にテーブルが
--    在る環境（dev）では上の CREATE TABLE IF NOT EXISTS が丸ごと no-op になるので、
--    列はまだ存在しない。ここへ書くと
--        ERROR: column "playback_status" does not exist
--    で**ファイル全体が落ちる**（ローカル PostgreSQL 16 で再現・実証済み）。
--    ADD COLUMN する «揃え直し» ブロックの**後ろ**へ置くこと（ファイル末尾）。

-- コメント（テーブル）
COMMENT ON TABLE dish_media_external_embeddings IS 'SNS の公式埋め込みで描画する dish_media の外部投稿情報。dish_media と 1:1（render_type=''external_embed'' の行のみが持つ）。oEmbed が返す HTML は保持しない。#1395 / #1273';

-- コメント（カラム）
COMMENT ON COLUMN dish_media_external_embeddings.dish_media_id IS 'dish_media の主キーを参照（削除時 CASCADE）。この列が PK なので dish_media と 1:1';
COMMENT ON COLUMN dish_media_external_embeddings.dish_id IS 'この埋め込みが紐づく料理（dish_media.dish_id と必ず一致する。複合 FK dmee_dish_media_dish_fk で保証）。自然キーに含めることで «同じ投稿 × 別の料理» の取り込みを許し、«同じ投稿 × 同じ料理» の二重取り込みは弾く。#1399';
COMMENT ON COLUMN dish_media_external_embeddings.provider IS '埋め込み元 SNS。DB の CHECK は instagram / tiktok / youtube / x の 4 種を許可するが、**アプリの取り込み対象は 3 種**（X は #1395 仕様追補で対象外。shared/utils/snsUrl.ts が構造的に弾く）';
COMMENT ON COLUMN dish_media_external_embeddings.external_content_id IS 'provider 側の投稿ID（動画IDなど）。(provider, external_content_id, dish_id) で一意（#1399 で dish_id を追加）。同じ投稿を別の料理として分類する取り込みは通し、同じ料理への二重取り込みは弾く';
COMMENT ON COLUMN dish_media_external_embeddings.canonical_url IS 'provider 上の正規URL。埋め込み描画とリンク遷移の SoT';
COMMENT ON COLUMN dish_media_external_embeddings.embed_status IS '埋め込みの死活（unknown=未検証 / available=表示可 / unavailable=削除・非公開等で表示不可）';
COMMENT ON COLUMN dish_media_external_embeddings.last_verified_at IS '最後に死活検証した日時。NULL は未検証。idx_dmee_status_verified で古い順に再検証する';
COMMENT ON COLUMN dish_media_external_embeddings.thumbnail_url IS 'provider 側のサムネイル URL（参照であって複製ではない）。取得できなければ NULL。複製の可否は provider ごとに異なる（Instagram は禁止 / TikTok の署名 URL は約48hで失効 / YouTube の i.ytimg.com は無署名で安定）ため、ここでは URL のみを保持する。#1399';
COMMENT ON COLUMN dish_media_external_embeddings.created_at IS 'レコード作成日時';
COMMENT ON COLUMN dish_media_external_embeddings.updated_at IS 'レコード更新日時（トリガで自動更新）';

-- updated_at 自動更新トリガ（20251025T0201:49-62 の作法）
-- DEFAULT now() は INSERT にしか効かないため、死活監視バッチの UPDATE では
-- このトリガが無いと updated_at が古いまま残る
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS set_updated_at_on_dmee ON dish_media_external_embeddings;
CREATE TRIGGER set_updated_at_on_dmee
BEFORE UPDATE ON dish_media_external_embeddings
FOR EACH ROW
EXECUTE FUNCTION trg_set_updated_at();

-- RLS 有効化
--
-- ⚠️ ポリシーは意図的に 1 つも定義しない = 全てのクライアントロールからのアクセスを拒否する。
--    このテーブルを読み書きするのは API サーバ（Prisma 接続ロール = テーブル所有者）と
--    埋め込み死活監視バッチだけであり、どちらも RLS をバイパスする。
--    dish_media_analysis_results（20251025T0201）も同じ扱いである。
--    クライアント（supabase-js の anon / authenticated）から直接読む必要が出た場合に限り、
--    そのとき必要な範囲のポリシーを追加すること。
ALTER TABLE dish_media_external_embeddings ENABLE ROW LEVEL SECURITY;

-- ==================================================================
-- 既存テーブルを現行仕様へ揃え直す
--
-- ⚠️ **上の CREATE TABLE は IF NOT EXISTS なので、既にテーブルがある環境では
--    丸ごとスキップされ、インライン制約の変更は一切反映されない。**
--    scripts/apply-migration.sh は from_file 以降を毎回全部流すため、
--    「テーブルが既にある環境」は普通に起こりうる。
--    よって制約の実体はここで DROP → ADD で張り直す
--    （ADD CONSTRAINT に IF NOT EXISTS は無いので DROP CONSTRAINT IF EXISTS を必ず前に置く）。
--    NOT VALID で即時に張ってから VALIDATE する（VALIDATE は弱いロックで済む）。
--
--    何度流しても同じ結果になる（冪等）ように書いてある。
-- ==================================================================

-- --- dish_id 列（旧版のテーブルには無い） -------------------------
ALTER TABLE dish_media_external_embeddings
  ADD COLUMN IF NOT EXISTS dish_id uuid;

-- 旧版から移行する場合だけ意味を持つ。新規作成の環境では 0 行に当たる
UPDATE dish_media_external_embeddings dmee
   SET dish_id = dm.dish_id
  FROM dish_media dm
 WHERE dm.id = dmee.dish_media_id
   AND dmee.dish_id IS DISTINCT FROM dm.dish_id;

ALTER TABLE dish_media_external_embeddings
  ALTER COLUMN dish_id SET NOT NULL;

-- --- thumbnail_url（#1399。上の CREATE TABLE に含めた分の追いつき） ---
-- 既にテーブルがある環境（dev）では CREATE TABLE がスキップされるので、ここで足す。
-- NULLABLE でデフォルト値を持たないため、既存行は 1 行も書き換わらない
ALTER TABLE dish_media_external_embeddings
  ADD COLUMN IF NOT EXISTS thumbnail_url text;

-- --- published_at を落とす（#1399・#1483 オーナー判断） -------------
-- 一度 dev にだけ足したが、**どのコードも書き込まなかった**（oEmbed は TikTok / YouTube の
-- どちらも投稿日時を返さない）。「何も書かない列は置かない」という判断で削除する。
-- public にはこのテーブル自体がまだ無いので、本番へは最初から存在しない列になる。
-- この DROP は **dev を追いつかせるためだけ**にある。public 適用後は消してよい
ALTER TABLE dish_media_external_embeddings
  DROP COLUMN IF EXISTS published_at;

-- --- 複合 FK ------------------------------------------------------
-- 旧版が張っていた単一列 FK は複合 FK に包含されるので落とす
ALTER TABLE dish_media_external_embeddings
  DROP CONSTRAINT IF EXISTS dish_media_external_embeddings_dish_media_id_fkey;

ALTER TABLE dish_media_external_embeddings
  DROP CONSTRAINT IF EXISTS dmee_dish_media_dish_fk;
ALTER TABLE dish_media_external_embeddings
  ADD CONSTRAINT dmee_dish_media_dish_fk
  FOREIGN KEY (dish_media_id, dish_id)
  REFERENCES dish_media (id, dish_id)
  ON DELETE CASCADE
  NOT VALID;
ALTER TABLE dish_media_external_embeddings
  VALIDATE CONSTRAINT dmee_dish_media_dish_fk;

-- --- 自然キー -----------------------------------------------------
-- 旧版の 2 列 UNIQUE を落として 3 列へ張り替える
ALTER TABLE dish_media_external_embeddings
  DROP CONSTRAINT IF EXISTS dmee_provider_content_uq;
ALTER TABLE dish_media_external_embeddings
  DROP CONSTRAINT IF EXISTS dmee_provider_content_dish_uq;
ALTER TABLE dish_media_external_embeddings
  ADD CONSTRAINT dmee_provider_content_dish_uq
  UNIQUE (provider, external_content_id, dish_id);

-- --- Prisma が 1:1 を表現するために要求する複合ユニーク ------------
ALTER TABLE dish_media_external_embeddings
  DROP CONSTRAINT IF EXISTS dmee_media_dish_uq;
ALTER TABLE dish_media_external_embeddings
  ADD CONSTRAINT dmee_media_dish_uq UNIQUE (dish_media_id, dish_id);

-- --- provider の値域（DB は 4 種。アプリ仕様は 3 種）---------------
ALTER TABLE dish_media_external_embeddings
  DROP CONSTRAINT IF EXISTS dmee_provider_check;
ALTER TABLE dish_media_external_embeddings
  ADD CONSTRAINT dmee_provider_check
  CHECK (provider IN ('instagram','tiktok','youtube','x')) NOT VALID;
ALTER TABLE dish_media_external_embeddings VALIDATE CONSTRAINT dmee_provider_check;

-- --- #1641 再生可否（playback_*） ---------------------------------
-- embed_status とは直交する情報。既存行は 'unknown' から始まり、
-- 取り込み時の判定と 1 回きりのバックフィルで埋まる
ALTER TABLE dish_media_external_embeddings
  ADD COLUMN IF NOT EXISTS playback_status     text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS playback_reason     text NULL,
  ADD COLUMN IF NOT EXISTS playback_checked_at timestamptz(6) NULL;

ALTER TABLE dish_media_external_embeddings
  DROP CONSTRAINT IF EXISTS dmee_playback_status_check;
ALTER TABLE dish_media_external_embeddings
  ADD CONSTRAINT dmee_playback_status_check
  CHECK (playback_status IN ('unknown','playable','not_playable')) NOT VALID;
ALTER TABLE dish_media_external_embeddings
  VALIDATE CONSTRAINT dmee_playback_status_check;

ALTER TABLE dish_media_external_embeddings
  DROP CONSTRAINT IF EXISTS dmee_playback_reason_check;
ALTER TABLE dish_media_external_embeddings
  ADD CONSTRAINT dmee_playback_reason_check
  CHECK (
    playback_reason IS NULL
    OR (playback_status = 'not_playable'
        AND playback_reason IN ('copyright_blocked','embedding_disabled','no_video_in_embed'))
  ) NOT VALID;
ALTER TABLE dish_media_external_embeddings
  VALIDATE CONSTRAINT dmee_playback_reason_check;

-- --- #1641 playback_* に依存する索引とコメント -----------------------
-- ⚠️ **ここより前には置けない。** 理由はファイル中ほどの ⚠️ を参照
--    （既存テーブルのある環境では、揃え直しブロックまで列が存在しない）。

-- 検索・お店提案から «再生できない投稿» を外すための部分索引。
-- 全体の少数しか該当しないので、部分索引にして小さく保つ
CREATE INDEX IF NOT EXISTS idx_dmee_not_playable
  ON dish_media_external_embeddings (dish_media_id)
  WHERE playback_status = 'not_playable';

COMMENT ON COLUMN dish_media_external_embeddings.playback_status IS '#1641 埋め込みの枠の中で再生できるか（unknown=未判定 / playable=再生できる / not_playable=再生できない）。embed_status（投稿が生きているか）とは直交する。not_playable でも投稿は生きているので、サムネイル・キャプション・リンク遷移は有効';
COMMENT ON COLUMN dish_media_external_embeddings.playback_reason IS '#1641 not_playable の理由（copyright_blocked=権利ブロック / embedding_disabled=投稿者が埋め込みを許可していない / no_video_in_embed=埋め込みに映像が無い）。トリアージ用で、分岐には使わない';
COMMENT ON COLUMN dish_media_external_embeddings.playback_checked_at IS '#1641 最後に playback_status を判定した日時。NULL は未判定。端末からの «再生できなかった» 報告を受けた再検証の間引きにも使う';
