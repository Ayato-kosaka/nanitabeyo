# デプロイ元ブランチ

どの面（native / web / API / DB / OTA）を **どのブランチから本番へ出すか** の正本。
リリース担当（人間と [`gh-nanitabeyo-release`](../../.codex/skills/gh-nanitabeyo-release/SKILL.md) スキル）が、
production workflow を dispatch する直前に `--ref` を決めるために読む。

この表と実装がズレたら、**この表が正**である。ズレを見つけたらその場で直す。

## 面ごとのデプロイ元

| 面     | 本番の ref    | workflow                      | production input                               | ref をどう進めるか                            |
| ------ | ------------- | ----------------------------- | ---------------------------------------------- | --------------------------------------------- |
| native | `release/X.Y` | `eas-build-submit-prod.yml`   | `platform=all\|ios\|android`                   | main を PR で `release/X.Y` へ統合            |
| OTA    | `release/X.Y` | `eas-update.yml`              | `channel=production`                           | 配信対象の release へ PR で反映               |
| web    | **`web`**     | `firebase-hosting-deploy.yml` | `target=production`                            | main を PR で `web` へ統合                    |
| API    | **`main`**    | `api-deploy.yml`              | `target=production`                            | main へマージした時点でいつでも出せる（下記） |
| DB     | **`main`**    | `db-migrate.yml`              | `target_schema=public` + `confirm_public=true` | main へマージした migration が対象            |

⚠️ **`web` は `release/X.Y` ではない。** ここを取り違えると、native のリリース作業の流れで
そのまま web も release ブランチから出てしまう。実際に 2026-09-02 に起きた（後述）。

## なぜ面ごとに違うのか

```text
              ┌────────────────────────────────────────────────┐
              │  main … 開発の最新。ここが唯一の合流点            │
              └──┬──────────────────┬──────────────────┬───────┘
     PR で統合   │      PR で統合    │                  │ そのまま
                 ▼                  ▼                  ▼
      ┌────────────────────┐  ┌──────────┐   ┌──────────────────┐
      │ release/X.Y        │  │   web    │   │ main             │
      │ ストアに出した版を   │  │ web を   │   │ 出したら前の版は  │
      │ 固定する           │  │ main と  │   │ 消える。版の実体は │
      │ = 後から追える      │  │ 分ける   │   │ ref の外にある    │
      └──────┬──────┬──────┘  └────┬─────┘   └────┬────────┬────┘
             │      │              │              │        │
          native   OTA            web            API      DB
        （審査・  （既存端末     （Firebase    （Cloud Run （Supabase
          公開は    への後追い）   Hosting）      revision）  public）
          人間）
```

分かれ方は 2 つの問いで決まる。

**1. «ストアに出した版» に縛られるか**

native と OTA だけが縛られる。実配布済みの binary は差し替えられず、
OTA はその runtimeVersion と互換な JS しか流せない。だから版を固定する
`release/X.Y` が要る。

**2. 版の実体をどこが持っているか**

API と DB は ref ではなく**デプロイ先が持つ**。API は Cloud Run の revision
（image tag = commit SHA）、DB は実スキーマそのもの。git のブランチで二重管理する
意味が無いので `main` から出す。

**web だけは例外で、`main` そのものではなく `web` ブランチを使う。**
main には native の審査待ちで止めておきたい変更が入るので、それを web へ自動で
出さないための緩衝が要るため。緩衝が要らなくなったら `main` に寄せてよい。

## API を単独でリリースする（専用ブランチは作らない）

**結論: API に専用ブランチは作らない。`main` の任意の commit から、いつでも単独でリリースできる。**

「API だけ直したい」を **ブランチではなくデプロイの仕組みで**満たす設計である。
`api-deploy.yml` は既にその形になっている。

```text
  main の commit ─▶ image: api:<commit sha>   ← 版の実体はこれ（不変）
                       │
                       ▼
        --no-traffic --tag candidate          旧リビジョンが 100% 捌いたまま
                       │                       新リビジョンを «置くだけ»
                       ▼
                  🔥 Smoke test                candidate の URL を直接叩く
                       │
            ┌──────────┴──────────┐
       合格 │                      │ 不合格
            ▼                      ▼
   🚦 promote 100%          何もしない = 旧リビジョンのまま
  （ここで初めて本番が入れ替わる）  （本番は 1 秒も壊れない）
```

- **いま本番に何が居るか** = Cloud Run の revision と image tag（= commit SHA）。ブランチではない
- **切り戻し** = `gcloud run services update-traffic --to-revisions <前の revision>=100`。
  git を触らない。秒で戻る
- **失敗時** = promote されないので本番は無傷

### 専用ブランチを作らない理由

長命ブランチは「本番に何が居るか」を **二重管理**にするだけで、上の 3 つを何も足さない。
むしろ腐る。`web` が実際に 6 週間放置され、本番が別ブランチから出る事故になった。

### ブランチの代わりに守る規律

ブランチが無い代わりに、**これだけは必ず守る**。

> **API は «まだユーザーの手元にある一番古いアプリ» と後方互換でなければならない。**

アプリは強制更新できない。ストアの binary も OTA の runtime も何か月も生き残る。
main へ入れた API 変更は次の deploy で全ユーザーに当たるので、**互換性はブランチではなく
コードで守る**しかない。

この «一番古いアプリ» は Remote Config の `minimum_supported_version` で宣言してある。
API はこれ未満のアプリへ **HTTP 426 Upgrade Required** を返して切り離す
（`api/src/core/guards/maintenance.guard.ts`）。つまり:

- `minimum_supported_version` **以上**のすべてのアプリと互換なら、いつ deploy してもよい
- 互換にできない変更は expand-contract で段階的に出す
  （[deployment-matrix.md](../../.codex/skills/gh-nanitabeyo-release/references/deployment-matrix.md) §3）。
  «次のアプリリリースまで待つ» でごまかさない
- どうしても切れない古いアプリがあるなら、`minimum_supported_version` を上げる判断を先に行う。
  **これはユーザーを切る判断なのでオーナーが決める**

### 経緯（2026-09-02 決定）

それまでの実績では、本番 API は 3 回とも `release/X.Y` から、アプリのリリースと同時に出ていた
（`main` からの本番デプロイは 0 回）。

| 日時 (UTC)       | ref            | run                                                                                |
| ---------------- | -------------- | ---------------------------------------------------------------------------------- |
| 2026-08-31 23:46 | `release/1.14` | [33452061447](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/33452061447) |
| 2026-08-11 11:15 | `release/1.13` | [31485822055](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/31485822055) |
| 2026-08-01 15:40 | `release/1.12` | [30706445416](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/30706445416) |

この形は **「API だけ直したい」が構造的にできない**（release を切るか、次のリリースまで待つ）。
API の緊急修正がアプリの審査期間に縛られるのは受け入れられないので、`main` からの
単独デプロイへ切り替えた。

## デプロイ前に確認すること

**`web` が main から離れていないか。** 離れたまま deploy すると、
その面だけ古い版が本番へ出る。deploy の前に必ず見る。

```bash
git fetch --prune origin
# ⚠️ shallow clone だと下の数はすべて嘘になる（release-policy.md §フェーズ0）
git rev-parse --is-shallow-repository   # true なら先に git fetch --unshallow origin
git rev-list --count origin/web..origin/main   # 0 でなければ先に main を web へ統合する
```

離れていたら、deploy より先に main を `web` へ PR で統合する。
**放っておくほど統合が難しくなる**（2026-09-02 時点で 1522 コミット遅れ、
統合時の衝突 2 ファイル）。これが「`web` を使わず release から出す」を招いた。

## この表を変えるときは

1. **この文書を先に直す。**
2. [`scripts/dispatch-and-watch-release-workflow.sh`](../../.codex/skills/gh-nanitabeyo-release/scripts/dispatch-and-watch-release-workflow.sh)
   の `expected_ref_pattern()` を直す。ここが面ごとの ref を機械的に強制している唯一の場所である。
3. スキル側（[`references/deployment-matrix.md`](../../.codex/skills/gh-nanitabeyo-release/references/deployment-matrix.md)）は
   この文書へリンクしているだけなので、**表を書き写さない**。

## 付録: この文書ができた経緯

2026-09-02、web だけの修正（[#1783](https://github.com/Ayato-kosaka/nanitabeyo/issues/1783)）を
本番へ出そうとしたときに判明した。

- 直近の本番 web デプロイ（[run #164](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/33452572185)）は
  `release/1.14` から流れていた
- 一方 `web` ブランチは **2026-07-24 の [run #114](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/30111671929) を最後に更新が止まっていた**
  （それ以前は 33 回、`web` から正しく出ていた）
- 原因は `dispatch-and-watch-release-workflow.sh` が **native / API / web のすべてに対して
  `release/*` の ref を要求していた**こと。web を正しい ref から出そうとしても script が弾くので、
  リリース作業の流れでそのまま release ブランチから出るしかなかった
- 実測（full clone）: `web` は main から **1522 コミット遅れ / 40 コミット先行**、
  差分 1598 ファイル。main の統合は可能で、衝突は 2 ファイルだった

「リリースブランチ」という 1 つの言葉が面をまたいで使われていたのが根本で、
面ごとに ref が違うことを書いた文書が 1 つも無かった。この文書がその置き場である。
