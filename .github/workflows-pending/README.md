# workflows-pending （一時ディレクトリ。取り込み後に削除してください）

## これは何か

Issue #1112（案 C）の成果物です。**本来の置き場所は `.github/workflows/pr-check.yml`** ですが、
Claude Worker からは `.github/workflows/` 配下へ push できないため、やむを得ずここへ置いています。

## なぜ直接置けなかったか

`claude-worker.yml` の write モードが Claude GitHub App へ要求している権限は
`contents: write` / `pull_requests: write` / `issues: write` / `actions: read` の 4 つで、
**`workflows: write` が含まれていません**。GitHub は GitHub App による
`.github/workflows/` 配下の作成・更新を、この権限が無い場合サーバ側で拒否します。

実際のエラー（git push / REST Contents API の両方で再現）:

```
! [remote rejected] agent/1112-pr-ci-workflow-v2 -> agent/1112-pr-ci-workflow-v2
  (refusing to allow a GitHub App to create or update workflow
   `.github/workflows/e2e-web-test.yml` without `workflows` permission)
```

```
PUT /repos/Ayato-kosaka/nanitabeyo/contents/.github/workflows/pr-check.yml
→ 403 Resource not accessible by integration
```

同一ブランチへの ref 作成と、`.github/workflows/` 以外への push は成功するので、
`contents: write` は効いています。ブロックされているのは workflow ファイルだけです。

## 取り込み方

このリポジトリの権限を持つ人が、ローカルで以下を実行してください。

```bash
git switch agent/1112-pr-ci-workflow-v2
git apply .github/workflows-pending/1112-pr-check.patch
git rm -r --cached .github/workflows-pending && rm -rf .github/workflows-pending
git commit -m '#1112 ci: PRでtypecheck・jest・Remote Config検査を回す'
git push
```

`1112-pr-check.patch` には以下 2 つの変更が入っています。

1. `.github/workflows/pr-check.yml` の新規追加（このディレクトリの `pr-check.yml` と同一内容）
2. `.github/workflows/e2e-web-test.yml` の Nit-4 コメント修正（#1116 後の実態へ更新）

## 恒久対応（任意）

今後も Claude Worker から workflow を編集させたい場合は、次の 2 つが両方必要です。

1. Claude GitHub App のインストール設定で **Workflows** 権限を write にする
2. `claude-worker.yml` の write モードの `additional_permissions:` へ `workflows: write` を追加する

ただし「エージェントが CI 定義そのものを書き換えられる」ことになるため、
権限を広げるかどうかはリポジトリオーナーの判断に委ねます。
