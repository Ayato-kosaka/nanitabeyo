---
name: gh-eas-ota-update
description: nanitabeyoのreleaseブランチ間で、gitとghを使ってEAS OTA Updateの互換性調査、マージ、production配信を安全に実施する。mainやrelease/1.11などのブランチを1つ以上のreleaseブランチへマージしたい場合、全体マージがOTA-safeか判定する場合、OTA-unsafeな修正を選択的にバックポートする場合、merge commitのPRを自動作成・マージする場合、productionのEAS Update GitHub Actionsを実行・監視する場合に使用する。
---

# GitHub EAS OTA Update

ソースブランチの変更をnanitabeyoのreleaseブランチへ安全に展開し、productionのEAS Updateを配信する。ネイティブ互換性、Git上の統合、production配信を、それぞれ独立したゲートとして扱う。

## 必須リソース

- 対象を判定する前に、[references/ota-safety-rules.md](references/ota-safety-rules.md)を最後まで読む。
- すべてのソース・対象ブランチの組み合わせについて、`scripts/audit-ota-inputs.sh <source> <target>`を実行する。
- production配信の必須確認が完了するまで、`scripts/dispatch-and-watch-update.sh`を実行しない。

## 絶対に守ること

- ユーザーの変更を保護する。ユーザーのworktreeに未コミット変更がある場合、そのworktreeではrelease作業を行わず、一時worktreeまたは専用のクリーンなブランチを使う。
- `git fetch --prune origin`後、ブランチを不変のSHAへ解決する。push、PRマージ、workflow実行の直前にもSHAを再確認する。
- PRとmerge commitを使う。squash、rebase merge、releaseブランチへの直接pushは禁止する。
- OTA-safeなら、監査後にPR作成、検証、merge commitによるマージまで自動で行う。version以外の競合やチェック失敗があれば停止する。
- `runtimeVersion`や`package.json`の`version`だけからネイティブ互換性を判断しない。
- 解決済みExpo config、fingerprintのdebug出力、環境ファイル、トークン、secretを表示しない。
- production workflowを並列実行しない。workflowは共有の`EXPO_PUBLIC_COMMIT_ID`を更新するため、対象ごとに完了を待って逐次実行する。
- 最初のproduction workflowを実行する直前で必ず停止し、ユーザーへ明示的な確認を求める。最初の依頼で配信まで指示されていても省略しない。
- production失敗後に、自動で再実行、rollback、republish、別SHAの配信を行わない。

## フェーズ1: 対象と状態を確定する

1. ソースブランチ、対象releaseブランチ、展開したい修正内容を特定する。
2. ソース、対象、修正範囲を安全に特定できない場合だけ質問する。
3. リポジトリ内の指示とworktreeの状態を確認する。
4. `git`、`gh`、`python3`、プロジェクトのパッケージツールが利用可能か確認する。
5. 次を実行する。

   ```bash
   git fetch --prune origin
   gh auth status
   ```

6. 次を記録する。
   - ソースrefとSHA
   - 各対象refとSHA
   - merge-baseとahead/behind
   - 対象のアプリversionとruntimeVersion
   - 対象runtimeで現在配布されているproductionネイティブビルドの根拠

EASのbuild記録またはproduction build workflowのrun情報から、対象runtimeで実際に配布されたバイナリを特定する。現在の対象ブランチ先端と、端末へ配布されたネイティブビルドが同じだと仮定しない。productionネイティブビルドを十分な確度で特定できなければ`unknown`とし、OTA-unsafeと同じ相談フローへ進む。

## フェーズ2: 対象ごとに監査する

次を実行する。

```bash
.codex/skills/gh-eas-ota-update/scripts/audit-ota-inputs.sh \
  "origin/<source>" "origin/<target>"
```

続いて、対象ツリーからソースツリーまでの完全な差分と、依頼された修正を実装するコミットを確認する。現在の対象ブランチ先端だけでなく、実際に配布された対象バイナリのネイティブ入力と、マージ後の予定ツリーを比較する。

対象を必ず次のいずれか1つに分類する。

1. `ota-safe-direct`
   - 全体マージ後もネイティブ互換である。
   - version/runtimeへの処置が不要である。
2. `ota-safe-with-version-restore`
   - 全体マージ後もネイティブ互換である。
   - 既存runtimeへ届けるため、マージ前の対象versionだけを復元する必要がある。
3. `full-merge-ota-unsafe`
   - ソース全体が、対象バイナリに存在しないネイティブモジュール、plugin、entitlement、permission、ネイティブアセット・設定、ネイティブコードを必要とする。
4. `unknown`
   - 根拠が不足または曖昧である。`full-merge-ota-unsafe`と同様に扱う。

変更を加える前に、分類と簡潔な根拠を報告する。ユーザーがマージと配信を依頼している場合、`ota-safe-direct`と`ota-safe-with-version-restore`は自動PRフローの実行権限を含む。unsafeまたはunknownの場合、Codexがバックポート対象を独断で選んではならない。

## フェーズ3A: OTA-safeな全体マージ

対象ごとに次を行う。

1. 記録済みの対象SHAから一時ブランチを作る。
2. 履歴を維持するため、記録済みソースSHAを`--no-ff --no-commit`でマージする。
3. 想定されたトップレベルのアプリversion競合以外は、自動解決せず停止する。
4. `ota-safe-with-version-restore`の場合、マージ前に記録した対象の`version`値だけを復元する。ソース側の依存関係やscriptsの変更は維持する。計算後のruntimeVersionが対象runtimeと一致することを確認する。
5. 親が記録済みの2つのSHAである単一のmerge commitを作る。
6. マージ予定ツリーに対してネイティブ監査を再実行し、想定外のネイティブ入力変更がないことを確認する。
7. lockfile固定でinstallし、リポジトリに適したformat、typecheck、test、build/exportを実行する。最低でも変更対象アプリと、直接影響を受けるshared packageを検証する。
8. 一時ブランチをpushし、`gh pr create`でPRを作る。
9. PR本文に次を含める。
   - ソースと対象のSHA
   - 依頼された修正
   - OTA分類と根拠
   - マージ前後の対象version/runtime
   - 実行したテスト
   - productionは未実行であること
10. `gh pr checks --watch`で必須チェックを監視する。
11. マージ直前にソース・対象のremote SHAが移動していないことを確認し、最終PR差分を確認する。
12. `gh pr merge --merge`でmerge commitとして自動マージする。squashとrebaseは禁止する。
13. 対象ブランチに作成されたmerge SHAを記録する。

refの移動、チェック失敗、マージ結果の変化、version以外の競合があれば停止して報告する。forceで進めず、再監査する。

## フェーズ3B: OTA-unsafeまたはunknownのバックポート

ソースブランチ全体をマージしない。

1. 依頼された修正を実装する最小限のコミットとfile hunkを特定する。
2. 修正、refactor、format、生成ファイル、依存関係変更、無関係な挙動を分離する。
3. 各候補コミットが対象バイナリ内のネイティブ機能だけで動作するか判定する。
4. 次を提示する。
   - 候補コミットのSHAとsubject
   - 必要な関連コミット
   - 除外するコミットと理由
   - 想定される競合・適応
   - 必要なテスト
   - 残るリスク
5. cherry-pick・バックポートする正確な範囲についてユーザーの承認を得る。Codexが独断で決めない。
6. 承認後、記録済み対象SHAから一時ブランチを作り、承認済みコミットを`-x`付きでcherry-pickする。
7. 古いブランチへ必要な最小限の適応だけを行う。承認範囲が実質的に変わる場合は再度停止して相談する。
8. 完成予定ツリーに対してOTA監査を再実行する。OTA-safeでなければ配信しない。
9. safe経路と同じPR、チェック、自動merge commitのフローを使う。

cherry-pick案の承認はproduction配信の確認ではない。次のproductionゲートは必ず別途実施する。

## フェーズ4: 必須のproductionゲート

予定したPRがすべてマージされた後、workflowを1つも実行していない状態で、次を含む最終表を提示する。

- 対象releaseブランチ
- マージ後の対象SHA
- アプリversion
- runtimeVersion
- OTA分類
- checkとtest結果
- 実行するworkflowとchannel（`eas-update.yml`、`production`）
- 実行順

一覧のSHAをproductionへ配信してよいか明示的に確認し、そのターンを終了して待つ。最初の依頼に含まれる「配信して」などの指示だけでは、このゲートを通過したことにしない。

この最終表に対する明確な肯定だけを、一覧に記載したSHAの実行権限として扱う。確認後にSHAが移動したら承認を無効にし、新しいSHAを示して再確認する。

## フェーズ5: 実行と監視

確認された順序で対象を逐次実行する。

```bash
.codex/skills/gh-eas-ota-update/scripts/dispatch-and-watch-update.sh \
  --ref "<release-branch>" \
  --expected-sha "<確認済みの完全SHA>" \
  --confirm-production CONFIRM_PRODUCTION
```

対象ごとに次を行う。

1. remoteブランチが確認済みSHAと一致することを確認する。
2. `.github/workflows/eas-update.yml`を`channel=production`で実行する。
3. GitHub Actionsのrun IDとURLを記録する。
4. terminal状態になるまで監視する。
5. 成功を確認してから次の対象へ進む。
6. 失敗したら後続の実行をすべて停止し、失敗stepとlog URLを報告する。

## 最終報告

次を報告する。

- ソースSHA
- 各対象の変更前・変更後SHA
- PR URLとmerge commit
- アプリversionとruntimeVersion
- OTA分類
- test/check結果
- Actions run ID、URL、conclusion
- 実行しなかった対象と理由

GitHub Actionsが成功しただけで端末への反映完了とは表現しない。EASのupdate記録を別途確認できた場合を除き、「production update workflowが完了した」と報告する。
