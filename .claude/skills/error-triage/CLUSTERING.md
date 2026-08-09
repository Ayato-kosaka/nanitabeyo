# Clustering — 「重複してそう」を正しく畳む

初回トリアージでは、人間の返信 18 件のうち **13 件が「重複してそう」「〜と同じ」**だった。
これは fingerprint の粒度が細かいことの表れで、捌く側は**まず束ねてから調査する**必要がある。

ただし「似ている」と「同じ根本原因」は違う。畳む前に FORENSICS.md で確かめる。

## 重複の3類型

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

### 3. frontend / backend の対

backend が 500 を返し、frontend がそれを `api_call_error` として記録する。

```
backend   searchRestaurants: GoogleMapsAPICallError（Google Places 429）  125人
frontend  /…/search/result .../bulk-import: api_call_error (500)          125人
```

**判定**: 束ねる。代表は backend 側（原因がそこにある）。
frontend 側は「ユーザーに見えている」ことの証拠として本文へ引用する。

**影響ユーザー数が一致するかが決め手。** 一致しなければ別経路が混ざっている。

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

**見分け方**: 制約名・テーブル名・関数名が違い、かつ一方の失敗がもう一方の前提を壊しているか。
生ログまで降りないと判定できない。

## 束ね方の手順

1. Issue 一覧をタイトルで眺め、上の3類型で仮のクラスタを作る
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
