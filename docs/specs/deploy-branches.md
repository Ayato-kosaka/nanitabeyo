# デプロイ元ブランチ

どの面（native / web / API / DB / OTA）を **どのブランチから本番へ出すか** の正本。
リリース担当（人間と [`gh-nanitabeyo-release`](../../.codex/skills/gh-nanitabeyo-release/SKILL.md) スキル）が、
production workflow を dispatch する直前に `--ref` を決めるために読む。

この表と実装がズレたら、**この表が正**である。ズレを見つけたらその場で直す。

## 面ごとのデプロイ元

| 面     | 本番の ref    | workflow                      | production input                               | ref をどう進めるか                         |
| ------ | ------------- | ----------------------------- | ---------------------------------------------- | ------------------------------------------ |
| native | `release/X.Y` | `eas-build-submit-prod.yml`   | `platform=all\|ios\|android`                   | main を PR で `release/X.Y` へ統合         |
| OTA    | `release/X.Y` | `eas-update.yml`              | `channel=production`                           | 配信対象の release へ PR で反映            |
| web    | **`web`**     | `firebase-hosting-deploy.yml` | `target=production`                            | main を PR で `web` へ統合                 |
| API    | `release/X.Y` | `api-deploy.yml`              | `target=production`                            | native と同じ release へ相乗り（下記参照） |
| DB     | **`main`**    | `db-migrate.yml`              | `target_schema=public` + `confirm_public=true` | main へマージした migration が対象         |

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
      │ アプリの «版» を固定 │  │ web の   │   │                  │
      │ = 審査に出した物を   │  │ 出し先を │   │ migration は版を  │
      │   後から追える      │  │ 別に持つ │   │ 持たず前へ進むだけ │
      └──┬──────┬──────┬───┘  └────┬─────┘   └────────┬─────────┘
         │      │      │           │                  │
      native   OTA    API         web                DB
   （審査・  （既存端末 （アプリと （Firebase      （Supabase
     公開は    への後追い）契約を   Hosting）        public schema）
     人間）              揃える）
```

分かれ方は 2 つの問いで決まる。

**1. «どの版を出したか» を後から追う必要があるか**

native・OTA・API は必要。ストアに出した binary は差し替えられないので、
その版と互換な JS（OTA）と API 契約を、後から特定できないといけない。
だから 3 つとも `release/X.Y` に載る。

**2. アプリの版と無関係に出せるか**

web と DB は出した瞬間に前の版が消え、アプリの版に縛られない。

- DB は migration が前へ進むだけなので `main` でよい。
- web は `main` そのものではなく専用の `web` ブランチを持つ。
  **main には native の審査待ちで止めておきたい変更が入る**ので、
  それを web へ自動で出さないための緩衝である。

「いま本番に何が動いているか」は、web と DB では ref から分からない。
Firebase Hosting のリリース履歴と、実スキーマで確認する。

## API に専用ブランチを切るか（未決）

**いまの API は「切れていない」のではなく、native の `release/X.Y` に相乗りしている。**
本番 API デプロイは実測で 3 回しかなく、3 回とも release ブランチから、アプリのリリースと同時に出ている。

| 日時 (UTC)       | ref            | run                                                                                |
| ---------------- | -------------- | ---------------------------------------------------------------------------------- |
| 2026-08-31 23:46 | `release/1.14` | [33452061447](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/33452061447) |
| 2026-08-11 11:15 | `release/1.13` | [31485822055](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/31485822055) |
| 2026-08-01 15:40 | `release/1.12` | [30706445416](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/30706445416) |

`main` から本番 API を出した記録は無い（`main` の run はすべて `target=development`）。

つまり今は **「API はアプリのリリース単位でしか本番へ出ない」** という運用になっている。
専用ブランチ（例 `api/production`）を切る意味は「本番にブランチが要るか」ではなく、
**API をアプリのリリース周期から切り離すか**である。

|                    | 切る（`api/production`）                    | 切らない（現状: release 相乗り）                     |
| ------------------ | ------------------------------------------- | ---------------------------------------------------- |
| API 単独の hotfix  | すぐ出せる                                  | **出せない**。release へ入れるか、release を切り直す |
| アプリとの契約ずれ | 自分で守る必要がある                        | release 単位なので自動的に揃う                       |
| 運用コスト         | ブランチ 1 本ぶん同期が増える               | 増えない                                             |
| 腐るリスク         | **ある**（`web` は実際に 6 週間放置された） | 無い                                                 |

**推奨は「いまは切らない」。** API 単独で緊急修正を出したい場面が実際に発生していない
（3 回とも release と同時）のに、腐る実績のある長命ブランチを増やす理由が無い。
API hotfix を release を待たずに出したくなった時点で切ればよく、その時に切っても遅くない。

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
