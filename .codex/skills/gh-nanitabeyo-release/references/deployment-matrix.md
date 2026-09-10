# nanitabeyo配信マトリクス

## 目次

1. 現行workflow
2. 影響分類
3. 実行順
4. DBとデータ作業
5. 成功条件

## 1. 現行workflow

**どのブランチから出すかは面ごとに違う。正本は [docs/specs/deploy-branches.md](../../../../docs/specs/deploy-branches.md)。**
この表に ref を書き写さない（2 箇所に書くと必ず片方が腐る）。dispatch 直前に必ずそちらを開き、
`scripts/dispatch-and-watch-release-workflow.sh` へ渡す `--ref` を決める。

⚠️ **web は release ブランチではない。** 「リリースブランチ」という言葉が面をまたいで
使われていたため、native のリリース作業の流れでそのまま本番 web を `release/X.Y` から
出す事故が起きた（2026-09-02）。script 側でも面ごとに ref を強制してあるので、
違う面の ref を渡すと dispatch 前に停止する。

| 対象 | Workflow | production input | 注意 |
|---|---|---|---|
| Native build/store upload | `.github/workflows/eas-build-submit-prod.yml` | `platform=all|ios|android` | EAS commandは`--no-wait --auto-submit`。Actions完了後もEAS build/submissionを監視する |
| API | `.github/workflows/api-deploy.yml` | `target=production` | Cloud Runへlatest traffic 100%。DB migrationは含まない |
| DB migration | `.github/workflows/db-migrate.yml` | `target_schema=public` | **`public`が本番。** 本番と開発は同じDBの別スキーマ。`from_file`は「そのファイル**以降**を辞書順に全部」適用する |
| Web | `.github/workflows/firebase-hosting-deploy.yml` | `target=production` | deploy後にPlaywright smokeを実行する。`eas-cli env:update`で共有の`EXPO_PUBLIC_COMMIT_ID`を書き換えるため、EAS系と逐次実行する |
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

新releaseのnative buildと同一JSを即時再配信する必要は通常ない。旧runtimeは実配布済みnative buildとの互換性をreleaseごと、platformごとに判定する。

### build/submit後にJS修正が入った場合は、buildを流し直す

**新runtimeへのOTAで代替しない。** ストアのbinaryが埋め込むbundleは、そのbuildを作った時点で確定する。OTAは既にインストール済みの端末を後から更新する仕組みなので、

- ストア審査でレビュアーが触るのは**修正前のbundle**である。
- リリース後に**新規インストールしたユーザーの初回起動も修正前のbundle**で動く。更新が当たるのは早くても次回起動である。

ネイティブ入力に差が無くても、`app-expo/**`のJSが1行でも動いたなら`eas-build-submit-prod.yml`を流し直す。**新規インストール時に正しいmoduleが渡ることを優先する運用**であり、OTAで済ませる判断はしない。

流し直した後は、新buildと同一bundleになるため**新runtimeへのOTAは`N/A`**へ戻る。Release Controlには「buildを流し直したのでN/A」と根拠を書き、旧runtimeへのOTAは新しいbuild SHAを起点に再監査する。

`eas.json`のversionSourceがremoteなら、流し直しでbuild number / versionCodeが自動で1つ上がる。ストア側には前回のbinaryが残るので、**どちらを審査へ出すかを人間が選べる状態**になることも記録する。

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

productionでは`db-migrate.yml`を使う。ローカルから直接流さない。dispatchのログに「いつ・どのファイルまで当たったか」が残るためである。

- `from_file`は開始位置であり、**そのファイル以降が辞書順にすべて適用される**。「1ファイルだけ」の指定はできない。dry runの`適用対象を決める`ステップが出す一覧を読み、承認表に書いたファイルと**完全一致**することを確認してから`dry_run=false`にする。
- `public`への実適用には`confirm_public=true`が要る。`dry_run=true`では不要。
- workflowは適用の前後で対象外スキーマ（`public`適用時は`dev`）のオブジェクト一覧ハッシュを比較し、差分があれば失敗する。この検算を「対象を取り違えていない」根拠として記録する。
- `regenerate_prisma`は`dev`適用時にしか働かない。`public`で`true`にしても何も起きない。
- 必ず`dry_run=true`で1回、`dry_run=false`で1回の**2回dispatch**する。1回目の出力を承認表へ引用する。

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
