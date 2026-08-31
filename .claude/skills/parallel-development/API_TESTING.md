# API Testing Orchestration

API変更を実環境で検証する場合は、`.github/workflows/api-deploy.yml` を使って対象PRのcommitを一時的にdevelopmentへデプロイし、APIテストとログ調査を行う。検証後は、成否にかかわらず必ず最新のmainをdevelopmentへ再デプロイして復旧する。

## 絶対条件

- `api-deploy.yml` の `target` は常に `development` とする。`production`を指定しない。
- productionのCloud Run、database schema、BigQuery datasetをAPI検証に使用しない。
- developmentへPR commitをデプロイした後は、main復旧runが成功するまでAPI検証を完了扱いにしない。
- APIテスト、ログ取得、要約、コメントのいずれかが失敗しても、復旧処理を省略しない。
- 他のdevelopment deployやAPI検証と競合しないことを確認してから開始する。

`api-deploy.yml`はdispatchしたrefをcheckoutし、そのSHAのimageを`api-development`へデプロイしてLATESTへ100%トラフィックを切り替える。したがって、検証対象SHAと復旧対象SHAを必ず記録する。

## 実行手順

1. 対象PRの最新HEAD SHAを取得する。
2. 開始時点のmain SHAを記録する。
3. `api-deploy.yml`をPR HEAD SHAでdispatchし、`target=development`を指定する。
4. dispatchしたrun IDを特定し、成功完了まで確認する。
5. development APIへ必要なAPIテストを実行する。
6. テスト時間帯のログを、BigQuery MCPまたは`.codex/bigquery/access.md`の規定コマンドで調査する。
7. HTTP status、主要レスポンス、エラー件数、severity、代表的なstack trace、対象endpoint、request/trace/correlation IDを整理する。
8. `finally`相当の後始末として、最新main SHAを再取得する。
9. `api-deploy.yml`を最新main SHAでdispatchし、`target=development`を指定する。
10. 復旧runの成功と、developmentの`API_COMMIT_ID`が復旧対象main SHAに一致することを確認する。
11. IssueまたはPRへ、検証deploy run、対象SHA、テスト結果、BigQueryログ要約、復旧run、復旧後SHAを報告する。

## Dispatch例

```bash
PR_HEAD_SHA="$(gh pr view <pr-number> --json headRefOid --jq .headRefOid)"
START_MAIN_SHA="$(gh api repos/{owner}/{repo}/commits/main --jq .sha)"

# PR commitをdevelopmentへ一時デプロイする。productionは禁止。
gh workflow run api-deploy.yml \
  --ref "$PR_HEAD_SHA" \
  -f target=development

# 対象runを特定し、必ず完了まで確認する。
gh run list --workflow api-deploy.yml --limit 10
gh run watch <deploy-run-id> --exit-status

# development APIテストとnanitabeyo_logs_devのログ調査を実行する。

# finally相当の必須復旧。途中処理が失敗しても必ず実行する。
RESTORE_SHA="$(gh api repos/{owner}/{repo}/commits/main --jq .sha)"
gh workflow run api-deploy.yml \
  --ref "$RESTORE_SHA" \
  -f target=development

gh run watch <restore-run-id> --exit-status
```

`gh workflow run`の成功はdispatch受付だけを意味する。該当runを特定し、`gh run watch <run-id> --exit-status`でdeploy完了を確認する。runの取り違えを防ぐため、作成時刻、event、head branch/SHA、input targetを照合する。

## BigQueryログ調査

ここで扱うのは development API の検証なので、dataset は `food-scroll.nanitabeyo_logs_dev` を使う。
**接続方法・dataset の使い分け・コスト規則の正は [`.codex/bigquery/`](../../../.codex/bigquery/)**（`access.md` / `safety-policy.md`）。ここへ書き写さないこと。

特に、時間範囲で絞るクエリを `*_event_logs` ビューへ投げないこと（パーティション枝刈りが効かず 18.4GB/日）。生テーブル `run_googleapis_com_stdout` を `timestamp` で絞る。

時間範囲は、検証deploy開始の少し前から復旧開始までに限定する。可能なら次で絞る。

- Cloud Run service: `api-development`
- 対象commit SHAまたは`API_COMMIT_ID`
- テスト対象endpoint
- request ID、trace ID、correlation ID
- severity、HTTP status、例外種別

### スキャン量のゲート（例外なし）

**すべてのqueryで、本実行の前に必ずdry runを行う。「大きそうなときだけ」ではない。** BigQueryは課金対象であり、スキャン量はクエリを見ただけでは判断できない。`WHERE created_at >= ...` を書いても、テーブルがその列でパーティションされていなければ枝刈りされず全走査になる。

手順は次のとおり。

1. **dry runでスキャン量を見積もる。** BigQuery MCPなら `dryRun: true`、CLIなら `bq query --dry_run`
2. **1 GB以上なら、実行せずユーザーへ確認する。** 見積り値と、そのクエリで何を知りたいのかを添えて聞く
3. 1 GB未満なら実行してよい

この規定の正は [`.codex/bigquery/safety-policy.md`](../../../.codex/bigquery/safety-policy.md)。**リーダーはBigQueryを触る前に読むこと。**

スキャン量を減らす手段を先に尽くすこと。

- `SELECT *` や `TO_JSON_STRING(payload)` を避ける。**payloadのような巨大なJSON列は、読むだけで数GBになる**
- 必要な列だけを選ぶ。集計で足りるなら生レコードを引かない
- 期間を絞る。90日ではなく7日で足りないかを先に考える
- 同じ結果を得られるなら、`stg_` などの小さいテーブルを使えないか確認する

**実測例（この規定を破った結果）**: `TO_JSON_STRING(payload)` を含むクエリ1本で **12.5 GB** をスキャンした。列を絞って集計に変えた同等のクエリは 970 MB だった。**13倍の差が「何を選ぶか」だけで生じる。**

ログ報告には、query条件、**dry runの見積りスキャン量**、対象時間帯、件数、代表例、テストとの因果関係、未確認事項を含める。

秘密値、token、cookie、authorization header、個人情報をIssue、PR、prompt、ログ要約、Artifactへ含めない。必要なログはマスクし、代表例は最小限だけ引用する。

## 報告内容

IssueまたはPRへの報告には、最低限次を含める。

- PR番号と検証対象commit SHA
- development deploy run URLと結果
- 実行したAPIテスト、期待結果、実結果
- BigQuery dataset、検索時間帯、主要filter
- エラー件数、severity、代表的な原因、未解決事項
- main復旧run URLと結果
- 復旧対象main SHA
- 復旧後の`API_COMMIT_ID`確認結果

## 完了条件

次の全てを満たした場合だけAPI検証完了とする。

- PR HEADのdevelopment deployが成功した。
- 必須APIテストを実行し、結果を記録した。
- `nanitabeyo_logs_dev`のログを確認し、エラーと未確認事項を整理した。
- productionへdeploy・queryしていない。
- 最新mainのdevelopment再デプロイが成功した。
- 復旧後のdevelopmentが期待するmain SHAを実行していることを確認した。
- 検証run、ログ要約、復旧run、対象SHAをIssueまたはPRへ報告した。
