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

### `ota-safe-with-native-neutralization`

全体マージを起点にし、対象バイナリに存在しないネイティブ機能だけを明示的に除外、revert、または無効化した最終ツリーが、実配布済みbuildと互換になる場合に使う。必要なら対象versionも復元する。

- neutralization対象をpackage、config plugin、native asset、source import、実行時hookの単位で列挙する。
- ネイティブ機能を外したことで残るJS経路、fallback、関連testも確認する。
- 最終的なproduction dependencyとlockfile解決結果を、対象の実配布済みbuildと比較する。
- 監査した最終ツリーの完全SHAをPRとGo/No-Go表へ記録する。
- 過去releaseで使った除外セットを恒久的なallowlistにせず、sourceと対象buildごとに再検証する。

これはcommit単位のcherry-pickが変更の依存関係を分断する場合に選べる。単にnative関連ファイルを削除しただけではsafeとせず、bundleが不足moduleや設定を参照しないことまで確認する。

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

全体マージがそのままunsafeな場合、次のどちらかを選ぶ。

### 全体マージとnative neutralization

- ソース全体を`--no-ff`でマージし、出典と機能間の依存関係を維持する。
- 対象バイナリにないネイティブ機能だけを、承認された一覧に従って除外、revert、または無効化する。
- 必要ならトップレベルversionだけを対象releaseへ戻す。
- 最終ツリーに対してinstall、typecheck、関連test、bundle解決、production dependencyとlockfileの比較を行う。
- neutralization対象、検証結果、最終SHAをPRへ記録する。

#### 優先手段: ネイティブ差分を持ち込んだmerge commitのrevert

このリポジトリでは、ネイティブ差分が **`main`のfirst-parent線上の1つのmerge commit**に集約されていることが多い。その場合、ファイル単位で除外リストを組むより、**そのmerge commitを`git revert -m 1`する**方が確実で、監査も再現もしやすい。

```bash
git checkout -B ota/<target>-release-<source> origin/release/<target>
git merge --no-ff <承認済みsource SHA>
git revert -m 1 <ネイティブ差分を持ち込んだmerge commitのSHA>
```

対象commitの特定は、first-parent側の前後でネイティブ入力が変わった点を探す。

```bash
# 例: expo のversionが変わったmergeを探す
for c in $(git log --format=%H --merges --first-parent <base>..origin/main); do
  a=$(git show "$c:app-expo/package.json"    | grep -E '"expo":')
  b=$(git show "$c^1:app-expo/package.json"  | grep -E '"expo":')
  [ "$a" != "$b" ] && echo "$c $(git log -1 --format=%s "$c")"
done
```

**⚠️ merge commitにはネイティブ以外の変更も混ざる。** revertはそれも一緒に落とす。実測例では、SDK upgradeのmergeに含まれていた`testID`の2行が消え、後続で追加されたテスト7件が「ボタンが見つかりません」で失敗した。プロダクションコードの回帰ではなかったが、**revertが落とした非ネイティブ変更を必ず列挙し、戻すもの／落とすものを承認前に決める**。

```bash
git show <merge SHA> --stat -m --first-parent
```

**version復元は不要な場合がある。** version bump commitがrevert対象のmergeに含まれていれば、revertだけでトップレベルversionが対象releaseの値へ戻る。復元操作を機械的に足さず、revert後に実際の値とruntimeVersionを確認する。

revert後に残ったネイティブ入力の差分（`app-expo/package.json`、`app.config.*`、`pnpm-lock.yaml`、`plugins/**`、`assets`）を対象releaseと突き合わせ、**dependenciesに差が無いこと**まで確認する。scriptsやコメントだけの差、対象バイナリが読まないbuild時assetは無害として記録する。

### カスケード方式（複数の旧releaseへ展開する場合）

各releaseを独立にneutralizeしない。**新しい順に1本ずつ、直前のneutralize済みブランチをマージする。**

```text
release/1.13 → release/1.12（ここでnative neutralization）
             → release/1.11（1.12の結果をmerge）
             → release/1.10（1.11の結果をmerge）
             → release/1.9 （1.10の結果をmerge）
             → release/1.8 （1.9の結果をmerge）
```

各段でPRを作り、`--no-ff`のmerge commitで統合する。古いreleaseほど、さらに前のreleaseで既に除外済みのネイティブ機能（過去のneutralization commit）がブランチ側に残っているため、modify/delete conflictが出る。**その競合はdelete側（＝過去に除外した判断）を維持する**のが既定で、sourceがそのファイルを実質的に変更している場合だけ再判断する。

各段のマージ後に、version、runtimeVersion、ネイティブ入力差分を**毎回**取り直す。1本前がsafeでも次がsafeとは限らない。次を毎段の確認項目にする。

- app versionとruntimeVersionが対象releaseの値のままか
- `app-expo/package.json`の**dependenciesに差が無い**か（scriptsだけの差は無害として記録する）
- 過去のneutralizationで除外したファイルが復活していないか（例: `app-expo/hooks/useScreenTrace*`、`app-expo/lib/e2e/`）
- `app.config.*`に、対象バイナリへ入っていないconfig plugin（例: `@react-native-firebase/*`）が戻っていないか

#### テストが「除外した機能」を掴んでいることがある

新しいreleaseから流れてきたテストが、neutralizationで除外したmoduleを`jest.mock`していて、suiteごと`Could not locate module`で落ちる。

**まずproductionコードが同じmoduleを参照していないかをgrepで確定させる。**

- productionが参照している → **bundleが壊れる**。neutralizationの範囲が誤っているので、除外セットから見直す。
- 参照が`jest.mock`の行だけ → bundleは安全。**mock行だけを外し、テスト本体は残す**。除外した機能とは無関係な回帰テスト（レイアウトや並び順など）まで消さない。

どちらの結論でも、判断の根拠にしたgrep結果をPRへ書く。

### 最小バックポート

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

### v1.12リリース時（2026-08-01）の実績

カスケード方式の実例。`release/1.11`で1回だけneutralizeし、以降は結果を順に流している。

| 対象 | PR | neutralization |
|---|---|---|
| `release/1.11` | #1144 | `26487998 chore(ota): make 1.12 changes compatible with runtime 1.11`。Firebase Performance（`useScreenTrace`）、`GoogleService-Info.plist`、`withDetoxProtobufFix.js`、E2E hook一式と`metro.config.js`を除外し、versionを復元 |
| `release/1.10` | #1145 | `release/1.11`の結果をmerge |
| `release/1.9` | #1146 | `release/1.10`の結果をmerge |
| `release/1.8` | #1147 | `release/1.9`の結果をmerge |

この結果、`release/1.8`〜`release/1.11`のツリーは互いに同一（versionを除く）になっている。次回のOTAでも、この4本は同じ性質を持つ前提で監査を始めてよいが、確認は省略しない。

### v1.13リリース時の監査結果（2026-08-11、`release/1.12`を対象に実測）

`origin/release/1.12`へ`88cb7af5`（release/1.13統合ツリー）をmergeし、`git revert -m 1 aa5bdb0c`（PR #1171 = #1156 のExpo SDK 53→54 / RN 0.81マージ）を実行した。

- 競合は4件のみ。`.github/workflows/{app-expo-check,pr-check}.yml`のmodify/delete（OTA bundleに載らないCIファイルなのでHEAD側を採用）と、`SavedRestaurantsSheet.tsx` / `TutorialBottomSheet.tsx`のcontent（SDK 54追従の当該箇所そのものなのでrevert側を採用）。
- app versionは`1.12.0`へ自動的に戻った（version bumpがrevert対象に含まれていたため）。
- revert後に残ったネイティブ入力差分は、`app.config.ts`のコメント4行、`app-expo/package.json`の`scripts`のみ（**dependenciesの差分なし**）、`pnpm-lock.yaml`の新workspace devDependency 6行、`adaptive-icon.png`（build時asset）だけだった。
- `typecheck` exit 0。`test`は55 suites pass / 1 suite fail。失敗は上記「非ネイティブ変更の巻き添え」（`testID`の2行）であり、プロダクションコードの回帰ではない。
