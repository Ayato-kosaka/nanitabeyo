# Clustering — 「重複してそう」を正しく畳む

初回トリアージでは、人間の返信 18 件のうち **13 件が「重複してそう」「〜と同じ」**だった。
これは fingerprint の粒度が細かいことの表れで、捌く側は**まず束ねてから調査する**必要がある。

ただし「似ている」と「同じ根本原因」は違う。畳む前に FORENSICS.md で確かめる。

## 重複の5類型

### 1. ロケール差分

`path_name` にロケールが入っているため、同じ画面・同じエラーが言語ごとに割れる。

```
#1221  /ja-JP/search/result  .../v/dishes/bulk-import: api_call_error
#1226  /en-IE/search/result  .../v/dishes/bulk-import: api_call_error
#1229  /ja/search/result     .../v/dishes/bulk-import: api_call_error
#1236  /en-US/search/result  .../v/dishes/bulk-import: api_call_error
```

**判定**: ほぼ確実に同一。ロケール以外の差分が無ければ束ねてよい。
**注意**: 「特定ロケールでしか起きない」バグは実在する（通貨・日付・文字コード）。
束ねる前に、他ロケールでも出ているかを件数で確認する。1ロケールだけなら別物の可能性がある。

### 2. 呼び出し階層

同一の根本原因が、コールスタックの各層で別々にログを出す。

```
#1217  external  Claude API POST /v/messages → 400        ← 最下層（真の原因）
#1215  backend   callClaudeAPI: ClaudeAPICallError
#1216  backend   fallbackToClaude: ClaudeFallbackFailed
#1214  backend   generateDishCategoryRecommendations: ...Error   ← 最上層
```

**判定**: 束ねる。**最下層（external または最も内側の関数）を代表 Issue にする。**
上位層は「下位層の失敗を受けて失敗した」だけなので、直す対象は下位層。

**見分け方**: 件数が下層 ≧ 上層になっているか、影響ユーザー数が一致するか。
一致していれば同一の連鎖。

**ただし「最下層＝直すべき場所」とは限らない。** 上の例では、そもそも
`fallbackToClaude` へ到達していること自体がバグである可能性がある（→ DOMAIN.md §1）。

### 3. frontend / backend の対

backend が 500 を返し、frontend がそれを `api_call_error` として記録する。

```
backend   searchRestaurants: GoogleMapsAPICallError（Google Places 429）  125人
frontend  /…/search/result .../bulk-import: api_call_error (500)          125人
```

**判定**: 束ねる。代表は backend 側（原因がそこにある）。
frontend 側は「ユーザーに見えている」ことの証拠として本文へ引用する。

**影響ユーザー数が一致するかが決め手。** 一致しなければ別経路が混ざっている。

### 4. ビルド差分（旧ビルド残存）

**同じ事象なのに、ログの payload がビルドによって違うため fingerprint が割れる。**
native アプリはユーザーが更新するまで旧ビルドが動き続けるので、
「現行ビルドの形」と「旧ビルドの形」が同時に立つ。

実例は位置情報エラー。現行ビルドは `payload.kind` を積むので除外ルール E5 に落ちるが、
`kind` を積んでいなかった旧ビルドの行は E5 をすり抜けて起票された（→ FORENSICS.md §6）。

**判定**: 事象としては同一だが、**束ねずに旧ビルド側を `err/skip` + close する**。
代表へ寄せても意味がない（現行ビルドの側は最初から起票されていない）。
本文へ commit id を必ず残す。

**見分け方**: `created_commit_id` ごとに集計して、payload の形が commit で分かれているか。

### 5. 同じ失敗の二重記録（片方だけが起票される）

呼び出し階層（類型 2）と似ているが、**層をまたいでいない**。同じ 1 回の失敗を、
汎用の層と画面側の catch が **同時刻に 2 本**書く。そして**片方だけが除外ルールをすり抜ける。**

実例（#1476 / 2026-08-20T12:33:08Z、同一ミリ秒）:

```
api_call_error          payload.status = 403               ← トップレベル → E4 が除外（起票されない）
tools_categories_error  payload.error.status = 403         ← 入れ子     → E4 に見えず起票される
```

E4 は 403 を除外対象に含んでいるのに、**ペイロードの形だけで結果が分かれた。**
除外条件は `JSON_VALUE(payload, '$.status')` を見るので（`sql-generator.js`）、
ステータスを `error` の下へ入れ子にした瞬間、その event は除外ルールから見えなくなる。

**判定**: 束ねない（そもそも 1 件しか立たない）。**直すのは起票された側のログレベル**で、
汎用側（`api_call_error`）は触らない。

**見分け方**: 起票された Issue の `firstSeen` と同じ時刻・同じ user_id に、
別の event 名のログが無いか。あれば payload を並べて、どちらに `status` がトップレベルで
載っているかを見る。

**⚠️ この形は「除外ルールが効いている」という思い込みを壊す。** 「403 は E4 で除外されるから
起票されないはず」は、**payload がその形をしているときだけ**成り立つ。

## 束ねてはいけないもの — 連鎖（因果）

見た目が似ていても、**AがBを引き起こしている**場合は別 Issue として残す。
直す順序が決まるので、束ねると情報が失われる。

初回の実例:

```
#1223  prisma.dish_media_impressions.create()
       → FK 制約違反 dish_media_impressions_dish_media_id_fkey    63件 / 24人

#1222  prisma.dish_media_views.create()
       → FK 制約違反 dish_media_views_impression_id_fkey          61件 / 25人
```

impression の作成が失敗する → その impression を参照する view も失敗する、という**因果**。
「同じ？」と聞かれたら「**同じではなく連鎖。#1223 が原因側**」が正しい答え。
なぜ impression 側が落ちるのかは DOMAIN.md §4（bulk-import の「ID 先返し」）。

**見分け方**: 制約名・テーブル名・関数名が違い、かつ一方の失敗がもう一方の前提を壊しているか。
生ログまで降りないと判定できない。

## 束ね方の手順

1. Issue 一覧をタイトルで眺め、上の4類型で仮のクラスタを作る
2. 各クラスタで **1件だけ** FORENSICS.md の手順を踏み、根本原因を確定させる
3. 影響ユーザー数が揃うかを確認する（揃わなければクラスタが間違っている）
4. **代表 Issue を1つ決める**（最下層 / backend 側 / 原因側）
5. 代表へ調査結果を書き、他は代表を参照して close

## 重複を close するときの状態選択

| 選択肢 | 挙動 | 使いどころ |
|---|---|---|
| `close`（completed）のみ | 次回 run で**再び起票される**（fingerprint が別のため） | ❌ 使わない。毎日復活する |
| `err/skip` + close | 以後**完全に無視**される | ⚠️ 根本原因が直っても気づけなくなる |
| 代表を残し、重複側に `err/skip` | 代表だけが再発を追跡する | ✅ **推奨** |

重複側へ `err/skip` を付けるときは、**本文へ代表 Issue 番号を必ず書く**。
`err/skip` は恒久無視なので、後から「なぜ無視したのか」を辿れる必要がある。

> **未解決の設計課題**: fingerprint の定義を変えて最初から束ねる（ロケールを剥がす、
> 階層を代表へ寄せる）ことも可能だが、`FP_ALGO_VERSION` を上げると
> **既存 Issue との突合が全部外れて全件が新規起票される**。移行方針を決めてから行う。
