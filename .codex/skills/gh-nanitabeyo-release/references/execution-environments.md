# 実行環境ごとの差異と代替手段

## 目次

1. shallow clone
2. `gh` が無い環境
3. GitHub MCP の応答サイズ
4. ローカル検証ゲートの実態

## 1. shallow clone

Claude Code on the web などのリモート実行環境は、リポジトリを **shallow clone** で用意する。この状態では次がすべて誤った値を返す。

- `git merge-base A B`
- `git rev-list --left-right --count A...B`
- `git log <base>..<head>`
- `git diff <base> <head>`（存在しないobjectをまたぐ場合）

実測例では、`release/1.12...main` の ahead/behind が shallow では `2581 / 120`、`--unshallow` 後は `25 / 244` だった。**リリース差分の commit 数と内容そのものを取り違える。**

したがってフェーズ0の最初に必ず確認する。

```bash
git rev-parse --is-shallow-repository   # true なら次を実行
git fetch --unshallow --prune origin
```

`scripts/audit-release-inputs.sh` と `scripts/audit-ota-inputs.sh` は shallow を検出しない。呼び出す前に解消しておく。

## 2. `gh` が無い環境

`scripts/dispatch-and-watch-release-workflow.sh` と `scripts/dispatch-and-watch-update.sh` は `gh` に依存する。`gh` が無い環境では、GitHub MCP ツールで同じ工程を組み立てる。

| 目的 | `gh` | GitHub MCP |
|---|---|---|
| Issue取得 | `gh issue view` | `issue_read`（`method=get` / `get_comments` / `get_sub_issues` / `get_parent`） |
| Issue更新 | `gh issue edit` | `issue_write`（`method=update`） |
| コメント追加 | `gh issue comment` | `add_issue_comment` |
| PR作成 | `gh pr create` | `create_pull_request` |
| PR checks | `gh pr checks` | `pull_request_read`（`method=get_check_runs`） |
| PR merge | `gh pr merge --merge` | `merge_pull_request`（`merge_method=merge`。squash/rebaseを選ばない） |
| workflow一覧・run一覧 | `gh run list` | `actions_list`（`method=list_workflow_runs`） |
| workflow dispatch | `gh workflow run` | `actions_run_trigger` |
| run監視 | `gh run watch` | `actions_get`（`method=get_workflow_run`）を間隔をあけて再取得 |

`gh run watch` に相当する自動追従が無いため、production workflowは **dispatch → 一定間隔で `get_workflow_run` を再取得 → terminal state を確認 → 次工程** を明示的に回す。`sleep` でのビジーウェイトはせず、確認のたびに状態と run URL を記録する。

MCPを使う場合も、スキル本体の不変ルール（並列実行しない、失敗時は後続停止、Actions greenを外部systemの成功と言い換えない）はそのまま適用する。

### ⚠️ MCPでmergeしたcommitはlocalに存在しない

`merge_pull_request`はGitHub側でmerge commitを作るだけで、**localのrefは一切動かない**。カスケードのように「前段のmerge commitを次段でmergeする」流れでは、次のmergeの前に必ず`git fetch --prune origin`を実行する。

忘れると`git merge <SHA>`が次で落ちる。

```text
merge: <SHA> - not something we can merge
```

**このエラーを握り潰さない。** `git merge ... >/dev/null 2>&1`のように出力を捨てると、mergeが起きていないのにHEADが動いていないだけの状態で先へ進み、**「差分ゼロだから安全」という誤った監査結果**になる。実際に1段分がno-opのまま「競合なし・ネイティブ差分なし」と読み違えた。

各段のmerge後は、HEADが対象releaseのSHAから**動いていること**を必ず確認する。

```bash
git fetch --prune origin
git merge --no-ff --no-edit "$SOURCE_SHA"     # 出力を捨てない
[ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/release/$TARGET")" ] || {
  echo "mergeが起きていない"; exit 1;
}
```

## 3. GitHub MCP の応答サイズ

次の呼び出しは応答が巨大になり、そのままでは読めずファイルへ退避される。

- `actions_list`（`list_workflow_runs`）— `per_page=5` でも 30 万文字を超えることがある
- `issue_read`（`get_sub_issues`）— sub-issue が数十件あると 20 万文字を超える
- `issue_read`（`get`）— 本文の長いPR/Issue

退避されたファイルは行が極端に長く `Read` の offset/limit で切れないため、**`python3` で読んで必要な項目だけを出す**。

```bash
python3 -c "
import json
d=json.load(open('<退避されたファイルパス>'))
for r in d['workflow_runs']:
    print(r['id'], r['head_branch'], r['head_sha'][:8], r['conclusion'], r['created_at'])
"
```

`list_pull_requests` など `fields` パラメータを持つツールでは、`body` を外すだけで大幅に小さくなる。

## 4. ローカル検証ゲートの実態

`pr-check.yml` が実際に回しているのは次だけである。統合PRのゲートはこれに揃える。

1. `pnpm install --frozen-lockfile`
2. `pnpm --filter app-expo assert:remote-config-defaults`
3. `pnpm --filter error-triage test`
4. `pnpm --filter shared build`
5. `pnpm --filter app-expo typecheck`
6. `pnpm --filter app-expo test`

これに加えてローカルでは `pnpm --filter api typecheck`、`npx tsc --noEmit -p e2e-web/tsconfig.json`、`npx tsc --noEmit -p e2e-mobile/tsconfig.json` を回す。

**`npx prettier --check .` を統合PRのブロッカーにしない。** `main` の時点で 70 ファイル超が warn を出しており、CIゲートにも入っていない。統合PRで整形すると、`main` と完全一致していたツリーをわざわざずらすことになる。差分の有無だけを報告する。

`assert:remote-config-defaults` はローカルでは環境変数が無いため「キー集合の一致」までしか検証しない。埋め込み既定値の照合は CI 側で `eas-cli env:pull` の後に行われる。ローカルの exit 0 を「Remote Config 検証済み」と言い換えない。
