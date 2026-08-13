# リリース運用ポリシー

## 目次

1. 責任範囲
2. 状態モデル
3. Git運用
4. 承認と権限
5. 再開と冪等性
6. 失敗とロールバック
7. 完了条件

## 1. 責任範囲

リリース担当は、範囲確定、branch/PR準備、Release Note、影響調査、実行計画、承認後の自動配信、監視、証跡、引き継ぎを担当する。App Store ConnectとGoogle Play Console上の審査提出、段階公開、公開日時の最終操作は人間が担当する。

binaryのstore uploadは審査提出ではない。EASのsubmission成功、ストア処理完了、審査提出、審査通過、公開を別々の状態として記録する。

## 2. 状態モデル

リリースを次の状態で管理する。

1. `discovered`: source、前release、version、既存artifactを確認済み
2. `prepared`: release branch、統合PR、checksが完了
3. `audited`: 配信マトリクス、OTA分類、順序、復旧策が確定
4. `awaiting-go`: exact SHAを提示してproduction承認待ち
5. `executing`: 承認済み工程を逐次実行中
6. `awaiting-review`: 自動工程完了、人間の審査提出・公開待ち
7. `complete`: 自動工程と依頼された公開確認が完了
8. `failed`: いずれかの工程が失敗し、後続停止

Release Note issueのRelease Controlコメントへ現在状態、最終確認時刻、証拠URLを残す。

## 3. Git運用

- 新releaseは、前releaseの記録済み完全SHAから作る。
- 新release refの初回作成後、main統合とすべての修正はPR経由にする。
- merge commitで履歴と出典を残す。
- release branchへforce pushしない。
- unsafeな旧release向けバックポートは`cherry-pick -x`を使う。
- version競合以外の競合は停止して再判断する。
- PR merge前にremote base/head SHA、最終tree、checksを再確認する。

## 4. 承認と権限

明確なフルリリース依頼は次を許可する。

- remote状態の読み取り
- 新release refの作成
- Release Note issueの作成・更新
- release差分commitが参照する親なしIssueをRelease Note issueの子Issueに追加
- 統合用branch、PR、checks、merge commit
- auditとGo/No-Go資料作成

次はexact SHA、対象、順序を示したGo/No-Go承認後だけ許可する。依存関係が許す場合、承認は`native`、`API/Web`、`OTA`などの工程範囲ごとに分割できる。承認は提示した範囲だけに有効で、未承認のproduction工程へ拡張しない。

- native production buildとstore upload
- production DB migration/data operation
- production API/Web deploy
- production EAS Update

migrationに破壊的操作、対象省略、復旧不能、未確認の外部副作用がある場合は、包括承認に含めず個別確認する。

工程範囲ごとのSHA、入力、順序、依存関係が変わらなければ、別範囲の準備や承認によって既存承認を無効にしない。先行範囲の実行中にも未承認範囲の監査、PR、文面作成は進めてよいが、production workflowは実行しない。

## 5. 再開と冪等性

再開時は作成やdispatchより先に実状態を照合する。

- branch: remote refとSHA
- issue/PR: open/closed/mergedとhead/base SHA
- GitHub Actions: workflow、event、branch、head SHA、input、conclusion
- EAS: build ID、platform、app version、runtime、gitCommitHash、status
- store submission: platform、build、status
- Cloud Run: image SHA、revision、traffic、health
- Firebase: release/version、URL、smoke result
- EAS Update: update ID、runtime、platform、channel、git commit

checkboxだけを根拠に再実行しない。同じSHAと同じ目的の成功artifactがあれば再利用し、不整合は`unknown`として報告する。

## 6. 失敗とロールバック

失敗時は最初に後続を止め、観測された事実を保存する。自動retryはしない。

- native: build/submissionのどちらが失敗したか分ける。新build番号が必要か確認する。
- API:以前のCloud Run revisionへ戻せるかを提示するが、自動でtrafficを戻さない。
- Web: Firebaseの以前のreleaseへ戻す案を提示するが、自動rollbackしない。
- OTA: runtime、update ID、affected platformを記録し、自動republish/rollbackしない。
- DB: rollback SQLを推測しない。backup、down migration、forward fixのうち承認済み手段だけを使う。

DB migration成功後に後続が失敗した場合、「全体が元に戻った」と表現しない。各systemの現在状態を一覧にする。

## 7. 完了条件

工程ごとの成功条件を満たし、証拠URLまたはIDを記録する。GitHub Actionsのgreenだけでは、外部systemの非同期処理完了を意味しない。

人間の審査が残る場合はreleaseを`awaiting-review`とする。人間から公開完了が報告されるか、読み取り可能なstore状態で確認できた場合だけ該当checkboxを完了にする。
