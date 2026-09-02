# 仕上げ run の手順書（e2e spec 追加 + エビデンス撮影 + PR 本文への埋め込み）

実装 PR が出来たあと、レビュー可能な状態にするための「仕上げ run」の手順。
リーダーは、この手順書を読ませるだけの短いプロンプトでワーカーを起動する。
（プロンプトを長くすると workflow_dispatch の inputs が JSON として弾かれることがある）

ワーカー側は、自分の作業ブランチに居ない場合があるので、この手順書は次のように読む。

```bash
git fetch origin claude/enterprise-app-quality-gap-gxhnri
git show origin/claude/enterprise-app-quality-gap-gxhnri:.claude/skills/parallel-development/EVIDENCE-AND-E2E.md
```

---

## 0. 絶対に守ること

- **Task ツール（サブエージェント）を使わない。** 「探索エージェントの完了を待ちます」と言って
  何もせず終わった run が実際にあった。自分で読み、自分で書く。
- **各段階で commit したら必ず push する。** commit だけして push せずに終わった run が
  実際にあり、80 ターン分の作業が丸ごと失われた。`git push -u origin <branch>` まで到達して
  初めて仕事が残る。
- **待たない。** 何かを起動したら、それに依存しない次の作業を続ける。
- **`.github/workflows/` は変更しない。** ワーカーの GitHub App には `workflows: write` が無く、
  1 ファイルでも触ると push 全体が拒否される。
- **DB マイグレーションを流さない。** 必要だと判断したら PR 本文に書いて報告するだけ。
- **ネイティブビルド（EAS Build）を流さない。**

## 1. e2e spec を web / mobile 両方に足す

このリポジトリは `e2e-web`(Playwright) と `e2e-mobile`(Detox) を同じ密度で維持する。
**重いのは「実行」であって「spec を書くこと」ではない。** 実行はしなくてよいが、
spec を書かないのは規約違反になる。過去に同じ抜けが起きている（#1131）。

- `e2e-web/tests/<領域>/<機能>.spec.ts` — Playwright。既存 spec の書き方（fixture・
  ヘルパー・待ち方）に合わせる。新しい流儀を持ち込まない。
- `e2e-mobile/tests/<領域>/<機能>.test.ts` — Detox。web spec と同じ観点をネイティブ側で。
  要素の特定は testID。`getAttributes()` の値で数値検証できるとよい。
- 検証は型検査まで通す。
  - `pnpm --filter e2e-web exec tsc --noEmit`
  - `pnpm --filter e2e-mobile run typecheck`
- **Detox / Playwright の実行はしない。** 実行していないことを PR 本文に正直に書く。
- API だけの変更で UI 経路が無い PR は、e2e の代わりに API の統合テストで代替してよい。
  その場合「なぜ e2e ではなく統合テストか」を PR 本文に書く。

## 2. エビデンスを撮る

`.claude/skills/evidence-video/SKILL.md` に従う。要点だけ再掲する。

- 出力先は **`/tmp/claude-artifacts/evidence`**。ここに置いたものだけが Artifact として
  回収され、公開される。リポジトリ内には絶対に置かない（`git status` をクリーンに保つ）。
- 再利用できる部品が `.claude/skills/evidence-video/scenarios/harness.mjs` にある。
  `record()`, `installMocks()`, `ok()`, `dismissTutorial()`, `writeNote()` を使う。
- **API のモックは必ず `{ success: true, data: ... }` の封筒で返す。** 素の配列を返すと
  アプリは `invalid_response` になり、エラー画面が映るだけの動画が出来る。実際に 1 周無駄にした。
- Chromium はバージョン不一致があるため `harness.mjs` の `resolveExecutablePath()` に任せる。
- 撮る内容は「変更が効いていることが目で分かる一連の操作」。変更前後を比較できるなら、
  before / after の 2 本を撮ると強い。
- **映らなかったものは映らなかったと書く。** 撮れなかった操作を撮れたことにしない。
  スクリプトの観測点が空振りしたときは、その理由も一緒に書く。
- 各動画・画像の隣に `<name>.md` を置き、「何を映しているか」を日本語 1〜3 行で書く。

### ⚠️ `e2e-mobile-test.yml` を続けて 2 本 dispatch しない

`concurrency.group: e2e-mobile-test` / `cancel-in-progress: false` なので、
「走っている run は守られる」が **待機できる run は 1 本だけ**である。
pending の run がある状態で次を dispatch すると、**先に待っていた方が cancelled になる**。
（実測 2026-08-23: tier1-2 の run を投げた 5 秒後に mutation の run を投げたところ、
tier1-2 が 7 秒で cancelled になり、走ったのは mutation だけだった。
「2 本撮ったつもりが 1 本しか無い」ことに、Artifact の中身を見るまで気づけなかった。）

**1 本ずつ投げ、`status: in_progress` で走り出したことを確認してから次を投げる。**
`scope` が違う撮影（tier1-2 と mutation は別スクリプト）は必ず別 run になるので、
ここを詰めると 1 本ぶん丸ごと落ちる。

### ⚠️ 実機 e2e は「dev API に何がデプロイされているか」に依存する

`api-deploy.yml` は **`workflow_dispatch` 専用**で、main への push では走らない。
つまり **API を変更した PR をマージしても、誰かが手で流すまで dev には反映されない**。

API 変更を含む機能の Detox spec は、デプロイ前に回すと**必ず落ちる**。しかも
落ち方が「画面は出るが期待した要素が無い」なので、アプリ側のバグに見える。
（実測 2026-08-23: GRP-04 投票完了通知 #1526 の spec が「お知らせはまだありません」で失敗。
アプリのバグではなく、dev API が #1526 マージ前の commit のままだった。）

**撮る前に、その機能の API コードが dev に載っているかを確認する。**
`api-deploy.yml` の最後の成功 run の `head_sha` と、対象 PR のマージ commit の
前後関係を見る。載っていなければ、撮影しても意味が無い。

## 3. push して、リーダーに引き渡す情報を出力する

commit・push まで終えたら、**run の最後に必ず次を標準出力へ書く**。
リーダーはこれを読んで `evidence-collect.yml` を dispatch する。

```
EVIDENCE_READY
  pr: <PR番号>
  branch: <ブランチ名>
  head_sha: <push した commit SHA>
  files: <evidence ディレクトリに置いたファイル名を全部>
```

Artifact 名は `claude-<task_key>-<run_id>-<run_attempt>` になる。リーダー側で組み立てるので
ワーカーは気にしなくてよい。

## 4. PR 本文にエビデンスを埋め込む（公開後の run）

公開が終わると、次の形の URL が確定する。

```
https://storage.googleapis.com/nanitabeyo-public/e2e-evidence/Ayato-kosaka/nanitabeyo/runs/<run_id>/<artifact_name>/
  index.html          … ギャラリー
  manifest.json       … ファイル一覧
  evidence/<file>     … 個々の画像・動画
```

PR 本文の末尾に `## エビデンス` 節を足し、次を入れる。

1. `[全エビデンスをブラウザで見る](.../index.html)`
2. 画像は `![<file>](<url>)` で **本文に直接埋める**。リンクだけにしない。
   オーナーは PR 本文をスクロールするだけで見られる状態を求めている。
3. 画像 1 枚ごとに、何を映しているかの 1 行説明を上に置く。
4. 動画（`.webm`）は GitHub が本文で再生できないのでリンクにする。
5. `sourceCommitSha: <SHA>` を書く。
6. 末尾に「認証・API・地図はモックしている」旨の注記を入れる。

**埋め込めたことを必ず検証する。** PR を取得して `body_html` の中の `<img` の数を数え、
埋めた画像の枚数と一致することを確かめる。一致しなければ本文の書き方を直して再投稿する。
（リーダーのローカル環境では画像 markdown が無効化されてしまうため、この作業は
ワーカー側でしか完了できない。）

---

## 5. DB スキーマ変更を伴う Issue の扱い

オーナーの指示は「マイグレーションは勝手に流さない。必要なら報告する」である。
**書くのは可、流すのは不可**。次のように扱う。

- `infra/supabase/migrations/<YYYYMMDDTHHMM>_<内容>.sql` を**書いて commit する**。
  既存ファイル（例: `20260807T0000_create_share_links.sql`）の書式に揃えること。
  先頭に「目的 / 背景 / 実装方針」を日本語コメントで書くのがこのリポジトリの流儀。
- `shared/prisma/schema.prisma` と `api/prisma/schema.prisma` を対応させる。
  2 つが食い違ったまま push しない。
- **`db-migrate.yml` を dispatch しない。dry run も含めて実行しない。**
- PR 本文の冒頭に次の見出しを必ず入れる。

```
## ⚠️ DB マイグレーションを含みます（未適用）

- 追加ファイル: infra/supabase/migrations/xxxx.sql
- 変更内容: <テーブル・カラム・索引を列挙>
- 後方互換性: <既存データ・既存クエリへの影響。既存行のバックフィルが要るかどうか>
- 適用順: <API のデプロイより先か後か>
- **オーナーの承認を得るまで適用していません。**
```

- マイグレーションが未適用のままでは e2e が通らない場合、その旨を PR 本文に書き、
  spec は書いたうえで「適用後に実行が必要」と明記する。**書かずに済ませない。**
