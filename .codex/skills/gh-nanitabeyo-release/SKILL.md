---
name: gh-nanitabeyo-release
description: nanitabeyoのリリース担当者として、mainから新しいrelease/X.Yを準備し、Release Note issueとWhat’s New案を作成し、API・DB migration・データ投入・Web・native build・store upload・旧runtimeへのEAS OTA Updateの要否と依存順を監査し、Go/No-Go承認後にGitHub Actionsを逐次実行・監視して完了報告する。新バージョンの本番リリース、releaseブランチ作成、リリース影響調査、ストア文面作成、既存releaseへのOTAバックポート、途中で止まったリリースの再開に使用する。
---

# nanitabeyo Release Manager

リリースを、準備、証拠に基づく判定、承認済みproduction実行、検証、引き継ぎから成る再開可能な状態機械として運用する。Release Note issueを作業台帳とし、ブランチ名やworkflowの成功だけで完了を推測しない。

## 必須リソース

- フルリリースでは最初に[references/release-policy.md](references/release-policy.md)、[references/deployment-matrix.md](references/deployment-matrix.md)、[references/release-note-style.md](references/release-note-style.md)を最後まで読む。
- `gh`が無い、cloneがshallowなど実行環境が標準と異なる場合は[references/execution-environments.md](references/execution-environments.md)を読む。
- OTA判定または旧releaseへの展開では[references/ota-safety-rules.md](references/ota-safety-rules.md)を最後まで読み、すべてのsource/target組で`scripts/audit-ota-inputs.sh`を実行する。
- production workflowの実行前に、対象SHAを含むGo/No-Go表を提示して明示承認を得る。

## 不変ルール

- ユーザーのworktreeを保護する。未コミット変更があれば専用の一時worktreeを使い、既存変更をstash、破棄、上書きしない。
- `git fetch --prune origin`後にrefを完全SHAへ固定し、push、PR merge、workflow dispatchの直前にもremote SHAを再確認する。
- releaseへの統合はPRとmerge commitを使う。既存releaseへの直接push、squash、rebase mergeを行わない。新しいrelease refの初回作成だけを例外とする。
- secret、環境ファイル、解決済みExpo config、fingerprint詳細、credentialを表示しない。
- 同じproduction系workflowを並列実行しない。EAS系workflowは共有の`EXPO_PUBLIC_COMMIT_ID`を更新するため、必ず逐次実行する。
- GitHub Actions成功をEAS build、store upload、端末反映、ストア審査、公開の成功と言い換えない。各システムのterminal stateを確認する。
- production失敗後に自動retry、rollback、republish、別SHAの配信を行わない。後続を止めて報告する。
- ストアへのbinary uploadと、人間が行う審査提出・公開操作を区別する。審査提出は行わない。
- Release Note、PR、workflow、branchの既存状態を先に検索し、二重作成・二重dispatchを防ぐ。
- Issue、PR、Release Control、実行報告などの運用文面は、ユーザーから別言語の指定がない限り日本語で記載する。
- **残タスクはRelease Note issue本文のチェックボックスで管理し、その場で書き換える。** 工程ごとの実行報告コメントを積まない。コメントはGo/No-Go、人間の判断が要る分岐、失敗、完了報告に限り、1リリースあたり数件へ収める。Release Controlは1つのコメントを更新し続ける。詳細は[references/release-note-style.md](references/release-note-style.md) §4。
- ユーザーへのチャット報告も同じ基準にする。変わったこと、判断が要ること、確認できていないことだけを短く書き、証跡はIssueへのリンクで渡す。同じ表や一覧を毎回展開しない。

## モードを選ぶ

依頼を次のいずれかに分類する。

1. `full-release`: mainから新しい`release/X.Y`を作り、native/API/Web/OTAを統括する。
2. `ota-only`: 承認済み修正を1つ以上の既存releaseへ反映してEAS Updateする。
3. `resume`: Release Note issueとremote状態から、中断済みリリースの未完了作業だけを再開する。
4. `audit-only`: 変更を加えず、リリース要否、順序、OTA対象、リスクだけを報告する。

対象と意図を安全に特定できない場合だけ質問する。明確な「vX.Yをリリースしたい」は、production前までのbranch/issue/PR準備を許可するが、production実行の承認とは扱わない。

## フェーズ0: 現在地を確定する

1. リポジトリ指示、worktree、`git`、`gh`、`python3`、`pnpm`、必要ならEAS CLIの可用性を確認する。`gh`が無い実行環境がある。その場合の代替は[references/execution-environments.md](references/execution-environments.md)に従う。
2. `git fetch --prune origin`と`gh auth status`を実行する。**cloneがshallowなら先に`git fetch --unshallow --prune origin`を実行する。** shallow cloneでは`merge-base`、`rev-list --left-right --count`、`log <base>..<head>`がすべて誤った値を返し、リリース差分そのものを取り違える。
3. source、前release、新release、各remote SHA、merge-base、ahead/behind、app version、runtimeVersionを記録する。
4. Release Note issue、統合PR、同一SHAのworkflow run、EAS build/updateが既に存在するか確認する。
5. `full-release`では次を実行して監査材料を得る。

   ```bash
   .codex/skills/gh-nanitabeyo-release/scripts/audit-release-inputs.sh \
     "origin/main" "origin/release/<previous>"
   ```

`resume`ではissueのcheckboxを信用し切らず、GitHub、EAS、Cloud Run、Firebaseなど確認可能な実状態と照合する。

## フェーズ1: releaseを準備する

`full-release`では次を行う。

1. 新releaseがなければ、記録済みの前release SHAと完全一致する`release/X.Y` refを作成する。既にあれば起点と履歴を検証して再利用する。
2. 記録済みmain SHAを新releaseへ`--no-ff --no-commit`で統合する一時ブランチを作る。
3. versionが依頼された`X.Y.z`であることを確認する。version以外の競合を独断で解決しない。
4. lockfile固定でinstallし、影響範囲に応じたtypecheck、test、build/export、必要なnative exportを行う。実行する具体的なコマンドは[references/execution-environments.md](references/execution-environments.md) §4に従い、`pr-check.yml`と同じ集合へ揃える。CPU・メモリ負荷の高い検証は並列実行せず、1件ずつ逐次実行する。`build:e2e-check-native`は標準ローカルゲートから除外し、ユーザーが明示的に求めた場合だけ実行する。format checkはCIゲートに入っていないため、統合PRのブロッカーにせず差分の有無だけ報告する。
5. PRを作成し、source/base SHA、version/runtime、差分分類、test、未実行のproduction作業を本文へ記載する。
6. checksを監視し、remote SHAと最終差分を再確認して`gh pr merge --merge`で統合する。

競合、check失敗、ref移動、想定外のversion/runtime、リリース範囲の変化があれば停止する。

## フェーズ2: Release Dossierを作る

[references/release-note-style.md](references/release-note-style.md)に従い、既存issueがなければ`🚀 Release Note (vX.Y)`を作る。含有PR、linked issue、そのコメント、実際のdiffを読み、ユーザー向け変更と運用変更を分離する。

- issue本文: `📦 概要`と`🛠 変更内容`
- issueコメント: Release Control checklist、対象SHA、配信マトリクス、実行履歴
- issue階層: 本リリース差分のcommitが参照するIssueのうち親Issueがないものを、Release Note issueの子Issueにする
- What’s New: 標準案、短文案、マーケティング案。日本語案の採用後は8言語のコピペ用翻訳を自動作成する

Issue階層は[references/release-note-style.md](references/release-note-style.md)の基準で冪等に更新し、既存の別親を付け替えない。事実確認できない機能、数値、ランキング、改善率を記載しない。リリース範囲が変われば本文、Issue階層、案を更新し、変更理由をコメントへ残す。

## フェーズ3: 配信影響を判定する

[references/deployment-matrix.md](references/deployment-matrix.md)に従い、次を独立して`required`、`not-required`、`unknown`へ分類する。

- native buildとstore upload
- API production deploy
- DB schema migration
- data migration、backfill、catalog/seed投入
- Web production deploy
- Remote Configや外部設定
- 新runtimeおよび旧releaseへのOTA

API/clientの後方互換性から実行順を決める。破壊的DB変更はexpand-contractまたは具体的な復旧策がなければNo-Goとする。migration fileがないことを「DB作業なし」の唯一の根拠にせず、データ投入scriptとrunbookも確認する。

旧releaseごとにOTAを`ota-safe-direct`、`ota-safe-with-version-restore`、`ota-safe-with-native-neutralization`、`full-merge-ota-unsafe`、`unknown`へ分類する。全体マージがそのままunsafeでも、ネイティブ差分を明示的に除外・revert・無効化した最終ツリーが実配布済みbuildと互換なら、commit単位のcherry-pickを強制しない。unsafe/unknownでは候補commit/hunkまたはneutralization対象と除外理由を提示して承認を得る。

## フェーズ4: 承認範囲ごとのGo/No-Goで必ず停止する

最初のproduction工程を実行する前に、次を含む全体表を提示する。依存関係が許す場合、承認範囲を`native`、`API/Web`、`OTA`などの工程単位に分割してよい。未承認範囲の実行順が来たら、その範囲の最新状態を提示して必ず停止する。先行工程の承認待ちや実行中にも、未承認工程の監査、PR、文面作成は進めるが、そのproduction workflowは実行しない。

- release issueと統合PR
- 対象ごとの完全SHA、version、runtimeVersion
- native/API/DB/data/Web/OTAの要否と根拠
- migrationの正確なファイル、data operation、前提、復旧策
- check/test結果
- workflow、input、実行順、各工程の成功判定
- OTA対象、分類、反映方法、順序
- 人間が行う審査・公開作業
- 既知リスク、No-Go条件、失敗時の停止位置

一覧のSHA、順序、今回承認を求める工程範囲を明示し、その範囲のproduction作業を開始してよいか確認してターンを終了する。承認は提示した範囲だけに有効であり、未提示の工程へ拡張しない。以前の包括的な「リリースして」はこのゲートを通過させない。承認済み範囲のSHA、migration、対象、順序が変われば、その範囲の承認を無効にして再提示する。他の承認済み範囲は、依存関係と入力が変わらない限り再承認を求めない。

## フェーズ5: productionを逐次実行する

承認済みの依存順で1工程ずつ実行し、各工程のterminal stateとpost-deploy checkを確認してから次へ進む。

- GitHub workflowは`scripts/dispatch-and-watch-release-workflow.sh`を使う。
- EAS Updateは対象ごとに`scripts/dispatch-and-watch-update.sh`を使う。
- migrationとdata operationは承認された正確な対象だけを実行する。対象を省略して「全部」を暗黙適用しない。
- native workflowは`--no-wait`のため、Actions完了後もEAS buildとsubmissionを個別に追跡する。
- APIはCloud Run revision/trafficとhealth、WebはFirebase deployとsmoke test、OTAはEAS update記録を確認する。

失敗したら後続をすべて停止し、失敗した境界、run URL、確認できた状態、再開条件を報告する。

## フェーズ6: OTA反映

承認されたbranchと、commit/hunkまたはnative neutralization方針だけをPR経由で反映する。既定はnative neutralizationであり、その優先手段は**ネイティブ差分を持ち込んだmerge commitの`git revert -m 1`**、複数releaseへ展開する場合は**新しい順のカスケード**である。手順と過去の実績は[references/ota-safety-rules.md](references/ota-safety-rules.md) §6・§8に置いてある。各merge後にremote SHA、version/runtime、OTA分類を再確認する。次を順番に実行し、1件の成功後だけ次へ進む。

```bash
.codex/skills/gh-nanitabeyo-release/scripts/dispatch-and-watch-update.sh \
  --ref "release/<version>" \
  --expected-sha "<承認済み完全SHA>" \
  --confirm-production CONFIRM_PRODUCTION
```

新native buildと同一bundleしかない新runtimeへ、理由なく即時OTAを重複配信しない。

**build/submit後にJS修正が入った場合は、新runtimeへのOTAで済ませず、native build/submitを流し直す。** ストアのbinaryに入るbundleは、そのbuildを作った時点のものである。OTAで補うと**新規インストール直後の初回起動だけ古いbundleで動く**ため、審査もインストール直後のユーザーも修正前の挙動を踏む。この運用ではストアへ出すbinaryが常に正しいmoduleを持つことを優先する。詳しくは[references/deployment-matrix.md](references/deployment-matrix.md) §2のOTA節を読む。

## 完了と引き継ぎ

証跡は**Release Controlコメント1件**へ集約して更新する。branch、変更前後SHA、PR URL、merge commit、native build IDとsubmission状態、migration/data operationの結果、API revision、Web deployとpost-deploy check、各OTAのupdate ID・runtime・branch・Actions URL、未実行/失敗/unknownの項目と理由をここへ置く。

**残タスクはRelease Note issue本文のチェックボックスへ置き、完了のたびに書き換える。** 人間が行う審査提出・公開確認もここに入れる。同じ一覧をコメントへ複製しない。

最終報告（コメント1件とチャット）は簡潔にする。次だけを書き、それ以外はRelease Controlと本文へのリンクで渡す。

- 完了した工程と、Release SHA
- 人間へ渡す残タスクがどこにあるか（本文のチェックボックス）
- 確認できていない項目（`unknown`）と、その理由

すべての自動担当項目が検証済みになるまで「リリース完了」と表現しない。人間の審査が残る場合は「自動リリース作業完了、審査提出待ち」と報告する。
