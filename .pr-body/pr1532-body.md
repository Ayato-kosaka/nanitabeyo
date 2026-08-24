## ⚠️ DB マイグレーションを含みます（未適用）

- 追加ファイル: `infra/supabase/migrations/20260823T0100_add_idempotency_key_to_dish_category_group_vote_sessions.sql`
- 変更内容:
  - テーブル `dish_category_group_vote_sessions` に列 `idempotency_key text`（NULL 許容・DEFAULT なし）を追加
  - 索引 `dcgvs_host_user_id_idempotency_key_uq` を `(host_user_id, idempotency_key)` の UNIQUE INDEX として追加
- 後方互換性:
  - **既存行のバックフィルは不要**。NULL 許容・DEFAULT なしの列追加はテーブル書き換えを伴わないメタデータ変更で、既存行は全て `idempotency_key = NULL` のまま
  - PostgreSQL の UNIQUE は NULL 同士を衝突と見なさないため、キーを送らない（= 旧クライアントの）行は何件でも入る。既存クエリへの影響なし
  - unique index の作成は全行 NULL の小規模テーブルなので一瞬。`CONCURRENTLY` 不要（トランザクション内で流せる）
- 適用順: **API のデプロイより先**。列が無い状態で `idempotencyKey` 付きのリクエストを受けると作成が失敗する。Issue のリーダー確定事項どおり「DB → API → クライアント」の順
- **オーナーの承認を得るまで適用していません。** `db-migrate.yml` は dry run も含めて dispatch していません。

---

Closes #1507

## 何を直したか

`POST /v1/dish-category-group-votes` の再送で、**別々の `shareToken` を持つ投票セッションが 2 件作られる**事故をサーバー側で防ぐ。

これまでの防御はフロントの `useRef` 同期ガード（#1205）だけで、守れるのは「同一 JS タスク内の連打」に限られていた（その限界は `useCreateDishCategoryGroupVote.ts` のコメントに元々書かれている）。通信のリトライ、オフライン復帰後の再送、コンポーネント再マウントでは二重に POST が届き、片方のリンクを配った参加者とホストが別の投票を見ることになる。共有リンクで完結する機能なので、集計が合わなくなって初めて気付く。

## 設計（Issue のリーダー確定事項どおり）

| 論点 | 採用 |
| --- | --- |
| UNIQUE のスコープ | `(host_user_id, idempotency_key)` の複合 |
| キーの受け渡し | クエリでもヘッダでもなく **body の `idempotencyKey`** |
| キー形式の検証 | `@IsUUID(4)` |
| 再送時のレスポンス | **201 のまま**・初回と同じ `{ id, shareToken }` |
| 進める順 | DB → API → クライアント |

複合 UNIQUE にしているのは、キーが**クライアント生成**だからである。単独 UNIQUE だと (a) 別ユーザーが偶然同じキーを送っただけで 2 人目の作成が失敗し、(b) 同一キー再送で他人のセッション（`shareToken` 込み）を返す漏洩経路ができる。複合にすることで「既存行を返す」経路が本人の行しか返さないことを制約レベルで保証している。

## 変更点

**DB**
- `infra/supabase/migrations/20260823T0100_...sql`（未適用）
- `shared/prisma/schema.prisma` / `api/prisma/schema.prisma` の双方に `idempotency_key String?` と `@@unique([host_user_id, idempotency_key])` を追加し、`prisma generate` で `shared/prisma` の client を再生成
- `shared/supabase/database.types.ts` と `shared/converters/convert_dish_category_group_vote_sessions.ts` を対応させた

**API**
- DTO に `@IsOptional() @IsUUID(4) idempotencyKey?: string`
- `service.create` は notifications と同じ三段構え（事前 `findUnique` → `create` → `P2002` で再 `findUnique`）。事前チェックは fast path で、正しさは 3 段目の unique 違反経路だけで成立する
  - 並行 2 リクエストで後着がここへ来た時点で、先着は必ず commit 済み（PostgreSQL の unique index が先着の commit / abort までブロックするため）
  - 元のトランザクションは abort しているので、**読み直しは必ずトランザクション外**の `this.prisma.prisma` で行う
- `repository.isUniqueViolationOn(error, column)` を追加。既存の `isUniqueViolation` は `P2002` かどうかしか見ないため、そのままでは `share_token` の偶発衝突（→ 409 のまま）と `idempotency_key` 衝突（→ 既存行を返す）を区別できない。`meta.target` が列名の配列でもインデックス名の文字列でも判定できるようにしてある

**クライアント**
- 「作成意図」につき 1 回だけ UUID v4 を生成して ref に保持する
  - 失敗しても捨てない → ユーザーの再タップや自動再送が同じキーで飛ぶ
  - 成功したら捨てる → 次は別の作成意図として新しいセッションを作れる
  - **入力（候補・検索条件）が変わったら作り直す** → 失敗後に候補を変えて再試行したとき、古い内容の既存セッションを返させない
- 既存の `isCreatingRef` ガードは Issue の方針どおり残している（サーバー往復を 1 つ減らせる）

## テスト

Issue の完了条件を API テストで固定した。Service と Repository は**本物**を使い、差し替えたのは Prisma executor だけ（複合 UNIQUE を再現する in-memory fake）。この機能の冪等性は最終的に DB の制約が担保するものなので、`isUniqueViolationOn` の切り分けや `findUnique` の複合キー名まで本物の実装が通る。

- ✅ 同一キー 2 回 → セッション 1 件・同じ `shareToken`（候補も二重に積まれないこと込み）
- ✅ `Promise.all` の並行 2 発 → 1 件（**unique 違反経路を通ったこと**をログで確認。ここを見ないと fast path だけで緑になる）
- ✅ キー無し 2 回 → 従来どおり 2 件（後方互換）
- ✅ 別ユーザーが同一キー → 各自 1 件ずつ
- ✅ `share_token` の偶発衝突は冪等キーがあっても 409 のまま
- ✅ DTO: 省略可 / UUID v4 のみ受理 / v1 は拒否
- ✅ クライアント: 失敗後の再試行は同じキー・成功後と入力変更後は新しいキー

```
pnpm --filter api exec jest src/v1/dish-category-group-votes
  Test Suites: 2 passed, 2 total
  Tests:       12 passed, 12 total
```

**同じキーで 2 回叩いても 1 件しか作られないことの確認（テスト出力）**

```
PASS src/v1/dish-category-group-votes/dish-category-group-votes.idempotency.spec.ts
  DishCategoryGroupVotesService.create の冪等化 (#1507)
    ✓ 同じ冪等キーで 2 回叩いてもセッションは 1 件しか作られず、同じ shareToken を返す
    ✓ 並行して届いた同一キーの 2 リクエストでもセッションは 1 件しか作られない
    ✓ 冪等キーを送らない旧クライアントは従来どおり毎回新しいセッションを作る
    ✓ 別ユーザーが偶然同じキーを送っても、互いに 1 件ずつ独立して作られる
    ✓ share_token の偶発衝突は冪等キーがあっても従来どおり 409 のまま
    ✓ unique 違反の meta.target がインデックス名の文字列でも冪等キー衝突と判定する
```

同じテストを、service の冪等化だけ一時的に無効化した状態でも走らせて、**事故を実際に検知できること**を確認した（この一時パッチは commit していない）。

```
  ● 同じ冪等キーで 2 回叩いてもセッションは 1 件しか作られず、同じ shareToken を返す

    expect(received).toHaveLength(expected)
    Expected length: 1
    Received length: 2
    Received array:  [{"id": "session-1", "idempotency_key": null, "share_token": "1e1aca29…"},
                      {"id": "session-2", "idempotency_key": null, "share_token": "f8e4fb97…"}]
```

### e2e spec（追加済み・**実行はしていない**）

- `e2e-web/tests/dish-category-group-votes/create-idempotency.spec.ts`
  - ①失敗後の再試行が**同じ `idempotencyKey`** で飛ぶこと（作成 API はスタブなので dev DB を汚さない。migration 適用前でも実行できる）
  - ②`route.fetch()` で本物のサーバーへ通してから `route.abort()` し、「サーバーには届いたが応答だけが失われた」状況を作る。押し直したときの `shareToken` が 1 発目と一致すること（= セッションが 1 件しか無い）。`@mutation` かつ **migration 適用後でないと通らない**
- `e2e-mobile/tests/mutation/group-vote-create-idempotency.test.ts`
  - Detox にはネットワーク傍受 API が無く、キーの一致も「応答だけが失われた」状況の再現もできない（`setURLBlacklist` はリクエスト自体を止めるのでサーバーに届かない）。そこはこの PR でも web 側に委ね、ネイティブは「通信に失敗したあと押し直すと結果画面がちょうど 1 枚だけ開く」というユーザーから見える事実を見る。`@mutation` かつ **migration 適用後でないと通らない**

型検査は両方通してある（`pnpm --filter e2e-web exec tsc --noEmit` / `pnpm --filter e2e-mobile run typecheck`）。**Playwright / Detox の実行はしていない。**

## 補足（レビュー時に見てほしい差分）

`prisma generate` により `shared/prisma/schema.prisma`（generator の出力先にコピーされる生成物）が `api/prisma/schema.prisma`（唯一のソース）と一致し、`share_links` ↔ `users` のリレーション 2 行が**この PR の変更とは無関係に**復活している。生成済み client（`shared/prisma/index.d.ts`）は元から api 側の schema で生成されていたため、型・挙動の差分は無い（生成物側だけが手編集で古かった）。気になる場合は指摘してほしい。

---

_Generated by [Claude Code](https://claude.ai/code)_

---

## エビデンス（2026-08-24 追記）

### なぜスクリーンショットが無いのか

**この PR に UI の変更が 1 行もありません。** 変更は API 側の冪等化と、クライアントが冪等キーを送るようにするところまでで、画面の見た目・文言・遷移はどれも変わりません。「同じキーで 2 回叩いてもセッションが 1 件しかできない」という性質は、**画面を見ても分からない**（成功したときの画面は 1 回目も 2 回目も同じ）ので、絵にしても嘘になります。

代わりに、その性質そのものを直接検査している API のテストを回した結果を貼ります。

### `dish-category-group-votes.idempotency.spec.ts`（2026-08-24 実行）

```
✓ 同じ冪等キーで 2 回叩いてもセッションは 1 件しか作られず、同じ shareToken を返す (17 ms)
✓ 並行して届いた同一キーの 2 リクエストでもセッションは 1 件しか作られない (4 ms)
✓ 冪等キーを送らない旧クライアントは従来どおり毎回新しいセッションを作る (3 ms)
✓ 別ユーザーが偶然同じキーを送っても、互いに 1 件ずつ独立して作られる (3 ms)
✓ share_token の偶発衝突は冪等キーがあっても従来どおり 409 のまま (15 ms)
✓ unique 違反の meta.target がインデックス名の文字列でも冪等キー衝突と判定する (2 ms)

Tests: 6 passed, 6 total
```

この 6 件が「二重作成が起きない」「旧クライアントを壊さない」「他人のキーと混ざらない」を直接固定しています。

### まだ流していないもの（正直に）

- `e2e-web/tests/dish-category-group-votes/create-idempotency.spec.ts`
- `e2e-mobile/tests/mutation/group-vote-create-idempotency.test.ts`

どちらもこの PR で追加したものですが、**実行はしていません**。実行には migration 適用済みの dev API が要ります（`20260825T0100` は適用済みですが、この PR のコードを載せた API はまだ dev へデプロイしていません）。型検査だけ通しています。

---
_Generated by [Claude Code](https://claude.ai/code)_
