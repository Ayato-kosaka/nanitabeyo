---
name: error-triage
description: error-triage が自動起票した Issue（`error-triage` ラベル / `<!-- fp:… -->` マーカー付き）を捌くときに使用する。Issue 本文の要約だけで判断せず BigQuery の生ログまで降りて根本原因を確定し、対応 / スキップ / 重複 / severity 誤りへ振り分け、修正が要るものは parallel-development へ引き渡すまでを扱う。「このエラーは何？」「重複してる？」「直すべき？」に答えるとき、日次トリアージを回すとき、起票された Issue をクローズするときに使う。
---

# Error Triage

#1196 の仕組みが自動起票した Issue を人間の判断へ橋渡しするためのスキル。

このスキルを使うときは、次を順に読み、すべて適用する。

1. [`TRIAGE.md`](./TRIAGE.md) — 1件を捌く手順と判断の型
2. [`FORENSICS.md`](./FORENSICS.md) — 根本原因を確定させる BigQuery の掘り方と、既知の落とし穴
3. [`CLUSTERING.md`](./CLUSTERING.md) — 「重複してそう」を正しく畳む方法

修正が必要と判断した Issue の実装は、このスキルでは扱わない。`.claude/skills/parallel-development` へ引き渡す。

## 最初に頭へ入れること

**Issue 本文の `messagePattern` は正規化で情報が落ちている。** 特に「1行目だけ残す」ルールは、メッセージが2行目以降にあるエラー（Prisma が典型）で診断情報を丸ごと捨てる。実例として、25人が踏んでいた障害が Issue 上では

```
| **何が** | `PrismaClientKnownRequestError:` |
```

としか出ておらず、これだけでは「どのPrismaエラーか」が判断できなかった。BigQuery を引いて初めて

```
Invalid `prisma.dish_media_views.create()` invocation:
Foreign key constraint violated on the constraint: `dish_media_views_impression_id_fkey`
```

と分かった。

**したがって、Issue 本文だけで close / skip を決めてはいけない。** 数字（件数・影響ユーザー数）は信用してよいが、原因の記述は不完全である前提で FORENSICS.md の手順を踏む。

## 原則

- **推測で分類しない。** 「たぶん海外だけ」「たぶんフォールバックしてる」は、実データで確かめるまで仮説として扱う。初回トリアージでは、この種の仮説が2件とも実データで覆った（→ TRIAGE.md「反証された仮説の例」）。
- **`err/skip` は恒久無視。** 一度付けると以後そのfingerprintは二度と起票されない。「今は直さない」と「永久に見なくてよい」は違う。前者は close だけで足りる（close 後に再発すれば自動 reopen される）。
- **重複を畳む前に、本当に同一根本原因かを確認する。** 連鎖（Aの失敗がBを引き起こす）は別Issueとして残す価値がある。
- **severity が間違っているだけのものは、Issue を消すのではなくアプリ側のログレベルを直す。** SQL の除外ルールへ足すのは最後の手段（除外は「見えなくする」ので、後から気づけない）。
- **影響ユーザー数は 25h 窓の値**で、run をまたいで合算されない。「1日あたり何人」として読む。
- **未認証ユーザーは `affectedUsers` に入らない。** `anonymousOccurrences` が別枠にある。サインアップ・ログイン経路の障害はここを見ないと過小評価する。

## 1日の流れ

```
schedule（09:00 JST）で自動起票
   ↓
新規Issueを一覧（error-triage ラベル / open）
   ↓
クラスタリング（CLUSTERING.md）── 同一根本原因ごとに束ねる
   ↓
束ごとに調査（FORENSICS.md）── BigQuery で根本原因を確定
   ↓
判断（TRIAGE.md）── 対応 / スキップ / 重複 / severity誤り
   ↓
修正が要るもの → parallel-development へ
```

**束ねてから調査する。** 1件ずつ調べると、同じ根本原因を何度も掘ることになる。初回は 20 件のうち 7 件が単一の根本原因（Google Places の日次クォータ枯渇）だった。
