# nanitabeyo配信マトリクス

## 目次

1. 現行workflow
2. 影響分類
3. 実行順
4. DBとデータ作業
5. 成功条件

## 1. 現行workflow

| 対象 | Workflow | production input | 注意 |
|---|---|---|---|
| Native build/store upload | `.github/workflows/eas-build-submit-prod.yml` | `platform=all|ios|android` | EAS commandは`--no-wait --auto-submit`。Actions完了後もEAS build/submissionを監視する |
| API | `.github/workflows/api-deploy.yml` | `target=production` | Cloud Runへlatest traffic 100%。DB migrationは含まない |
| Web | `.github/workflows/firebase-hosting-deploy.yml` | `target=production` | deploy後にPlaywright smokeを実行する |
| OTA | `.github/workflows/eas-update.yml` | `channel=production` | platform all。共有EAS envを更新するため逐次実行する |

workflow定義は変更され得る。毎回対象SHA上のYAMLを読み、input、非同期処理、concurrency、post-deploy checkを再確認する。

## 2. 影響分類

各surfaceを独立して分類する。

### Native

`app-expo/package.json`のnative dependency、lockfile、`app.config.*`、`eas.json`、plugins、native asset、permission、entitlement、iOS/Android project、Expo/RN versionに変更があればbuild要否を調べる。app version/runtime更新を伴う通常の新minor releaseはnative buildをrequiredとする。

### API

API source/shared API contract/container inputの変更を列挙し、実行時に到達するか確認する。次へ分類する。

- `required-before-client`
- `required-before-web`
- `backward-compatible-anytime`
- `breaking-coordination-required`
- `not-required`
- `unknown`

### DBとデータ

次を別々に調べる。

- `infra/supabase/migrations/**`
- `shared/prisma/schema.prisma`
- migration shell/script
- backfill、catalog、seed、同期script
- issue/PR/runbookに記載された手動SQLや投入順

### Web

Web route、`.web.*`、shared UI/API contract、Firebase config、sitemap、static asset、rewriteの変更を確認する。nativeと同じExpo sourceでも、Web配信要否は別判定する。

### OTA

新releaseのnative buildと同一JSを即時再配信する必要は通常ない。build後に修正が入った場合、新runtime OTAを検討する。旧runtimeは実配布済みnative buildとの互換性をreleaseごと、platformごとに判定する。

## 3. 実行順

固定順ではなく依存グラフから決める。

### 後方互換APIの典型

```text
expand migration
→ backward-compatible API
→ data backfill
→ Web/native build and upload
→ human review/publication
→ cleanupは別release
```

### client先行可能な典型

```text
native build/store upload
→ human review中にAPI/Web準備
→ feature flagまたはAPIを有効化
→ publication
```

### breaking変更

feature flag、versioned endpoint、dual read/writeなどの移行設計がなければNo-Goとする。審査期間が不定なnative appと、即時切替のAPI/DBを同時刻前提で結合しない。

WebとAPIのどちらを先にするかはcontract互換性で決める。OTAは各対象branchへのPRと検証が完了した後、古い順・新しい順の慣習ではなく、承認表に明記した順で逐次実行する。

## 4. DBとデータ作業

`scripts/apply-migration.sh`は引数省略時に全SQLを適用し、指定ファイルが見つからない場合も全SQLへfallbackする。この挙動のままproductionで曖昧な対象を指定しない。

production前に必ず次を確定する。

- 正確なファイル/command
- 対象schema/environment
- 既適用判定
- transaction可否とlock時間
- backupまたは復旧方法
- API/clientとの前後関係
- 実行後verification query。ただしsecretや個人情報を出力しない

破壊的migrationは個別承認を求める。data scriptは冪等性、再実行時の重複、外部API費用、件数、所要時間を確認する。

## 5. 成功条件

| 対象 | 成功条件 |
|---|---|
| Native | platformごとのEAS buildがfinished、submissionがaccepted/finished相当。Actions greenだけでは不足 |
| API | workflow success、期待SHAのCloud Run revision、traffic、health確認 |
| DB | command success、期待schema、verification成功、適用記録 |
| Data | 対象job成功、期待件数/整合性、再実行状態を記録 |
| Web | workflow success、production URLへのpost-deploy smoke成功 |
| OTA | workflow successに加え、期待runtime/platform/channel/SHAのEAS update記録 |

外部状態を確認できなければ`unknown`とし、「完了」ではなく「workflow完了、外部確認待ち」と報告する。
