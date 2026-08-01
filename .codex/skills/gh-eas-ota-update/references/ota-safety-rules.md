# OTA安全性の判定基準

## 目次

1. 安全性モデル
2. 根拠の優先順位
3. ネイティブに影響する入力
4. 分類基準
5. version復元
6. マージとバックポート
7. GitHub Actions
8. nanitabeyoの既知ベースライン

## 1. 安全性モデル

EAS Updateが置き換えるのは、JavaScriptとOTA管理対象のアセットである。インストール済みiOS・Androidバイナリへコンパイル済みコードや設定を追加・変更することはできない。

次の4点を独立して判定する。

1. **配信先:** EASが意図したバイナリへupdateを配信するか。
2. **ネイティブ互換性:** 配信されたJavaScriptが、そのバイナリのネイティブABIとコンパイル済み設定で動作するか。
3. **統合:** ソース変更を、対象の無関係な挙動を壊さずマージできるか。
4. **配信内容:** 監査したSHAとproductionへ実行するSHAが完全に一致するか。

`runtimeVersion`の一致が答えるのは配信先だけである。このリポジトリではアプリversionのmajor/minorからruntimeVersionを作るため、versionを戻すと旧バイナリへ配信できるが、ネイティブ互換になるとは限らない。

## 2. 根拠の優先順位

次の順で根拠を優先する。

1. 実際に配布されたEAS buildコミットのネイティブ入力と依存関係解決結果
2. インストール済みapp version・runtime・platformに対応するEAS build metadata
3. GitHub build workflow runと不変のbuild commit
4. 配布済みbuildとネイティブ入力が同一だと証明できた場合だけ、対象releaseブランチの先端
5. ブランチ名やversion規約だけでは根拠にしない

iOSとAndroidを別々に確認する。片方だけsafeな場合がある。現在のworkflowは`--platform all`で配信するため、両platformがsafeでなければ全体をunsafeとする。

fingerprintは補助根拠として使えるが、判断を置き換えない。このプロジェクトはfingerprint policyではなく手動のruntimeVersionを使っている。secretが解決される可能性があるため、fingerprintやExpo configのdebug・詳細JSON出力を表示しない。

## 3. ネイティブに影響する入力

以下をすべて確認する。

### 依存関係と生成されるネイティブABI

- アプリpackage manifestのdependenciesとoptionalDependencies
- `pnpm-lock.yaml`の解決version
- `ios`、`android`、podspec、Gradle、codegen、JSI、TurboModule、native viewを持つExpo・React Native package
- packageの追加、削除、upgrade、downgrade、patch、peer解決の変更
- ソースツリーで新しく参照されるネイティブpackageのimport
- React Native、Expo SDK、Hermes、New Architecture、Reanimated、native codegenのversion

devDependencyだから自動的にsafeとは判断しない。production config/prebuildでautolinkまたは使用されないことを確認する。

### Expoとplatform設定

- `app.config.*`、`app.json`、`eas.json`
- config pluginとlocal plugin
- bundle/package identifierとscheme
- entitlement、associated domain、permission、intent filter、URL type
- Info.plistとAndroidManifest
- build properties、deployment target、framework、Gradle、CocoaPods
- `newArchEnabled`、Hermes、architecture flag
- 環境変数で条件分岐するplugin
- Google・Firebase service fileとnative SDK設定
- icon、splash、font、notification assetなどbuild時に埋め込まれるresource

entitlement不足はクラッシュではなく機能劣化になる場合がある。それでもソース側ネイティブbuildと同等ではない。マージ後コードがその機能を必要とする場合はunsafeとする。

### ネイティブprojectとpatch

- `ios/**`、`android/**`
- Podfile、Gradle、ネイティブソース
- `patches/**`
- ネイティブprojectを変更するbuild hookとscript
- install、prebuild、production build時に実行されるpackage script

### OTA-onlyになり得る変更

新しいネイティブ要件を導入しない場合、次は通常OTA-safeになり得る。

- TypeScript・JavaScriptの挙動
- styleと文言
- API呼び出しとstate logic
- bundleから読み込む画像、JSON、翻訳
- testとdocument
- Web専用コードとWeb専用asset

platform suffixと条件付きimportも確認する。Metroのnative bundleが不足moduleを読み込まないことを確認する。

## 4. 分類基準

### `ota-safe-direct`

次をすべて満たす場合だけ使う。

- 全体マージ後が配布済み対象バイナリと同じネイティブ機能だけを使う。
- 対象version/runtimeが処置なしで維持される。
- 重要な不確実性が残っていない。

### `ota-safe-with-version-restore`

次をすべて満たす場合だけ使う。

- ネイティブ互換性は`ota-safe-direct`と同等である。
- マージによって対象のapp version/runtimeが置き換わる。
- 対象の正確な既存versionを戻すことだけが必要である。

version復元が変更するのは配信先metadataであり、ネイティブ非互換は修復しない。

### `full-merge-ota-unsafe`

マージ後ソースのどこかが、対象バイナリに存在しない、または異なるネイティブ挙動を必要とする場合に使う。例:

- 新しいネイティブpackageをimportする。
- ネイティブpackage versionやcodegen出力が異なる。
- config pluginやpermissionが必要である。
- entitlementやURL schemeへ依存する。
- native build settingやarchitectureが変わる。
- コードが期待するnative assetが埋め込まれていない。

### `unknown`

次の場合に使う。

- 配布済みネイティブbuildのcommitを特定できない。
- production環境変数に依存するconfigを比較できない。
- platformごとの根拠が矛盾する。
- fingerprint・hashが異なる理由を安全に切り分けられない。

unknownは相談・バックポート経路へ進める。楽観的にsafeとしない。

## 5. version復元

マージ前に対象の正確なversionを記録する。patch versionが異なる可能性があるため、`release/X.Y`だけから推測しない。

version復元が必要な場合:

1. ソースの履歴を保ったままマージする。
2. app manifestのトップレベルversionだけを変更する。
3. ソース側のdependency、script、設定変更を維持する。
4. secretを表示しない方法でconfigを解決し、runtimeVersionが対象runtimeと一致することを確認する。
5. iOS・Androidのnative build numberを変更していないことを確認する。

対象側の古いpackage manifest全体を復元してはならない。ソース側dependencyを消し、監査ツリーとPRツリーが異なる危険がある。

## 6. マージとバックポート

- 監査では常に不変SHAを使う。
- `--no-ff`とmerge commitでソース履歴を維持する。
- 自動解決するのは想定済みのapp version差だけとする。
- その他の競合は新しい判断として停止する。
- PR headの正確なツリーでcheckを実行する。
- マージ直前にbase/head SHAを再確認する。
- `gh pr merge --merge`を使い、squash/rebaseは禁止する。

全体マージがunsafeな場合:

- 一貫して動作する最小修正を選ぶ。
- `cherry-pick -x`で出典を残す。
- 必須testと関連コミットを含める。
- 対象ネイティブバイナリが既に機能を持つ場合を除き、dependencyやconfig変更を含めない。
- 変更前に正確なコミット範囲についてユーザーの承認を得る。

## 7. GitHub Actions

production workflow:

- file: `.github/workflows/eas-update.yml`
- input: `channel=production`
- ref: 対象releaseブランチ
- platform: 現在のworkflowはall platformを配信

実行前:

- 対象ref上にworkflowが存在することを確認する。
- 確認済みSHAとremote対象SHAが一致することを確認する。
- app versionとruntimeを最終確認する。
- 正確なSHAを示した後でproduction実行の明示確認を得る。

workflowが共有の`EXPO_PUBLIC_COMMIT_ID`を更新するため逐次実行する。各runを完了まで監視し、最初の失敗で後続を停止する。

## 8. nanitabeyoの既知ベースライン

このスキル作成のきっかけとなった監査時点では、次の状態だった。

- `release/1.8`〜`release/1.10`は既に`release/1.11`をマージ済みで、復元したapp versionだけが異なっていた。
- `release/1.5`〜`release/1.7`は`release/1.11`とネイティブ互換だったが、全体マージ後にversion復元が必要だった。
- `release/1.4`には`lottie-react-native`がなく、後続ソースの共通LoadingIndicatorはそれをimportしていた。
- それ以前のreleaseにはさらにネイティブ機能差があった。

これは過去の根拠であり、恒久的なallowlistではない。ブランチとproduction buildは変化するため、現在の不変SHAと実際の配布済みbuildから毎回再判定する。
