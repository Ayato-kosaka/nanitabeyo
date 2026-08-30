# Release NoteとWhat’s Newの作成基準

## 目次

1. 情報源
2. Issue本文
3. Issue階層
4. 残タスクはIssue本文、コメントは最小限
5. Release Controlコメント
6. What’s New
7. 禁止事項

## 1. 情報源

次の順で事実を集める。

1. releaseへ含まれるmerge commitとPR
2. PRがcloseするissue、linked issue、issue/PRコメント
3. 実際のdiffとtest
4. user-facingな画面、文言、API挙動
5. 人間が明示した実績やマーケティング情報

commit subjectだけで内容を断定しない。release branchへ到達していないPRは含めない。基盤整備、test、refactor、監視はユーザー体験を直接変える場合だけ概要へ含める。

## 2. Issue本文

タイトルを`🚀 Release Note (vX.Y)`とする。既存issueがあれば新規作成せず更新する。

```markdown
## 🚀 Release Note (vX.Y)

### 📦 概要

アプリバージョン **vX.Y** のリリースチケットです。

<今回の価値を1〜2段落で説明>

### 🛠 変更内容

#### 1. 【機能追加|機能改善|UX改善|不具合修正】<見出し> ([#123](...))

- **事象:** ユーザーまたは運用上、何が不足・発生していたか。
- **原因:** なぜその状態だったか。事実として確認できる範囲だけを書く。
- **対応内容:** 実際にreleaseへ含まれる変更を箇条書きする。
```

複数issueを無理に1項目へまとめない。一方、同じユーザー価値のfrontend/API/shared変更は1項目に統合してよい。

## 3. Issue階層

前releaseの確定SHAから本releaseの確定SHAまでの差分commitを列挙し、各commit messageが参照する同一repositoryの実在Issueを確認する。単なる数字やPR番号をIssueと推測せず、GitHub上のobject種別を確認する。

参照Issueごとに現在の親Issueを取得し、次のように冪等に処理する。

- 親Issueがない: Release Note issueの子Issueとして追加する。
- Release Note issueが既に親: 何もしない。
- 別の親Issueがある: 既存階層を維持し、付け替えない。
- cross-repositoryなどGitHubの親子関係に追加できない: コメントだけで代用せず、未紐付けと理由をRelease Controlへ記録する。

リリース差分が変わった場合は再走査する。差分から外れたIssueを自動で子Issueから外さず、Release Controlへ差分を記録して人間へ報告する。

## 4. 残タスクはIssue本文、コメントは最小限

**残っている作業はIssue本文のチェックボックスで管理し、その場で更新する。** コメントで残タスクを再掲しない。読み手が「今どこまで終わって何が残っているか」を知るために本文だけを見れば済む状態を保つ。

Issue本文の末尾に次を置き、工程が進むたびに**同じ行を書き換える**。

```markdown
### ✅ 進捗

- [x] DB schema migration
- [x] API production deploy
- [x] Web production deploy / smoke
- [ ] Human: App Store 審査提出（build 29）
- [ ] Human: Google Play 審査提出・公開（versionCode 29）
- [ ] #514 画像リサイズの再 enqueue（API デプロイ後）
```

コメントを足してよいのは次の場合だけとする。**1リリースあたり数件に収める。**

- production工程を開始してよいかの確認（Go/No-Go）
- 人間の判断が要る分岐が出たとき
- 失敗して後続を止めたとき
- 自動作業が完了したとき（最終報告1件）

やらないこと。

- 工程ごとの実行報告コメントを積む（run URLはRelease Controlの1コメントへ集約する）
- 完了済みの内容をコメントで繰り返す
- 同じ残タスク一覧を本文とコメントの両方に置く

ユーザーへのチャット報告も同じ基準にする。**変わったこと、判断が要ること、確認できていないことだけ**を短く書き、証跡はIssueへのリンクで渡す。表や一覧を毎回展開しない。

## 5. Release Controlコメント

本文と運用ログを混ぜない。Issue本文、PR本文、コメント、Release Control、実行報告は、ユーザーから別言語の指定がない限り日本語で記載する。**Release Controlは1つのコメントを最後まで更新し続ける。** 進行のたびに新しいコメントを足さない。次を置き、進行に合わせて書き換える。

```markdown
## Release Control

State: `awaiting-go`
Release SHA: `<sha>`

### Delivery
- [ ] Native build / store upload
- [ ] Human: App Store review submission
- [ ] Human: Google Play review/release
- [ ] API production deploy
- [ ] DB schema migration
- [ ] Data migration / catalog投入
- [ ] Web production deploy / smoke
- [ ] EAS Update: release/X.Y

### Evidence
- Integration PR:
- Issue hierarchy:
- GitHub Actions:
- EAS build/submission:
- API revision:
- Web deploy:
- EAS updates:
```

不要な項目は削除せず`N/A — 根拠`と記録すると、未調査との区別がつく。

## 6. What’s New

ユーザーの利益を先に書き、通常2〜4段落にする。毎回次の3案を提示する。

1. `標準案`: 主な機能と利益を自然に説明する。
2. `短文案`: 最重要の変更だけを簡潔に伝える。
3. `マーケティング案`: 確認済みのランキング、受賞、利用実績がある場合だけ冒頭に使う。

推奨構造:

```text
<ユーザーにとっての一番大きな変化>

<何ができるようになったか>

<利用場面と得られるメリット>
```

技術表現をユーザー表現へ変換する。

| 技術的事実 | What’s New |
|---|---|
| 検索結果0件時にfallback URLを生成 | 候補が見つからないときもGoogle マップでお店探しを続けられます |
| scoring featureをAPIへ追加 | 気分や希望に近い料理を見つけやすくなりました |
| crash/error handling | 安定性を改善しました。ただし具体的な改善を説明できる場合はそちらを優先します |

ランキングなど時間で変化する情報は、リリース時点の根拠または人間の明示提供を記録する。未確認ならマーケティング案から外す。

日本語の採用案が確定したら、追加確認を挟まず、次の8 localeを同じ意味と情報量で翻訳する。ストア画面へそのままコピーできるよう、説明や文字数注記を混ぜず、次のタグ形式で出力する。

```text
<en-US>
...
</en-US>
<ar>
...
</ar>
<es-ES>
...
</es-ES>
<fr-FR>
...
</fr-FR>
<hi-IN>
...
</hi-IN>
<ja-JP>
...
</ja-JP>
<ko-KR>
...
</ko-KR>
<zh-CN>
...
</zh-CN>
```

翻訳時に一部localeだけが長く見えても、明示されたストア上限を実際に超えていない限り、全localeを一律に短縮しない。意味を縮める必要がある場合も日本語採用案は変更せず、該当localeだけ自然な表現へ調整する。

## 7. 禁止事項

- 未出荷、feature flagで無効、対象外platformの機能を書かない。
- API、DTO、DB table、quotaなど内部用語をそのまま出さない。
- 根拠なしに「大幅」「劇的」「完全」「高速化」を使わない。
- test追加やrefactorを新機能として扱わない。
- 改善率、件数、順位を創作しない。
- issue本文の技術詳細をWhat’s Newへそのまま貼らない。
