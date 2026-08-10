# Triage — 1件を捌く手順と判断の型

## 手順

1. **一覧を取る。** `error-triage` ラベル / open。`<!-- fp:… -->` を持たない Issue（親 #1196 や設計 Issue）は対象外。
2. **束ねる。** CLUSTERING.md。1件ずつ調べない。
3. **束ごとに根本原因を確定させる。** FORENSICS.md。Issue 本文の要約だけで決めない。
4. **判断する。** 下の型に当てはめる。プロダクト固有の前提は DOMAIN.md を先に見る。
5. **記録して閉じる。** 判断の根拠（件数・影響ユーザー数・生ログの要点）を本文へ残す。
6. **修正が要るものを引き渡す。** parallel-development へ。
7. **振り返る。** SKILL.md「振り返り」。ここまでで1周（省略しない）。

## 判断の型

| 状況 | 操作 | 通知 | 再発時 |
|---|---|---|---|
| 直した | close（completed） | — | close + 24h 以降に 3 件以上で自動 reopen |
| 今は直さない（優先度が低いだけ） | **open のまま**。本文へ理由を書く | — | 毎日カウントが更新される |
| 恒久的に無視してよい | `err/skip` + close（not planned） | — | **二度と起票されない** |
| 重複（代表がある） | `err/skip` + close。本文へ代表 Issue 番号 | — | 代表側が追跡 |
| 旧ビルドにしか無いバグ | `err/skip` + close。本文へ commit id の根拠 | — | 現行ビルドに出たら別 fingerprint で立つ |
| severity が誤り | close せず、**アプリ側のログレベルを直す Issue** を別に立てる | — | 修正後は自然に消える |
| 調査が必要 | open のまま。調査結果を本文へ追記 | — | — |

**`err/skip` と close の使い分けを間違えない。**
`err/skip` は「永久に見なくてよい」。「今は直さない」は close でも open でもなく、
**open のまま理由を書く**のが正しい（close すると再発判定の対象になり、24h 後に勝手に reopen される）。

## severity が誤っているとき

「`error` ではなく `warn` が適切」と判断した場合、**Issue を消すのではなくアプリ側を直す**。

| 対処 | 効果 | 副作用 |
|---|---|---|
| アプリのログレベルを `warn` へ変更 | ✅ 根本解決。以後起票されない | 別PRが要る |
| SQL の除外ルールへ追加 | ログは `error` のまま、トリアージだけ除外 | 後から気づけない |
| `err/skip` | そのfingerprintだけ無視 | 類似の新fingerprintは起票され続ける |

判定材料は FORENSICS.md §4。**フロントが `api_call_error` を出しているなら `warn` へ落としてはいけない。**
呼び出しは失敗しており、ユーザーに見えている。
ただし「呼び出しが失敗した」と「ユーザーが詰んだ」は別で、退避導線のログまで見る（DOMAIN.md §2）。

## 反証された仮説の例

いずれも「ありそう」に見えたが、実データで否定された。**推測で分類しない**ことの実例として残す。
**ここに書いた結論自体が後で覆ることがある。覆ったら訂正を書き足す**（誤った結論を残さない）。

### 「原因が海外地点の話であればスキップで良い」（初回）

→ **真因は課金枯渇だった。**

```
Claude API request failed: 400
  "Your credit balance is too low to access the Anthropic API."
→ 1,456 件 / 208 人/日
```

`callClaudeAPI` / `fallbackToClaude` / `generateDishCategoryRecommendations` /
external の 400 は、すべてこれ1つが原因だった。スキップしていたら
**208人/日が影響を受け続ける課金切れを見逃していた**。

> **訂正（オーナー確認）**: このとき「地理は無関係だった」と結論したのは誤り。
> **原因（課金枯渇）と影響範囲（誰が影響を受けるか）を混同していた。**
> 日本の住所は gate whitelist（`region:country:JP`）にマッチするので、そもそも Claude 経路へ
> 行かないのが正しい。日本のユーザーがここに到達している時点で別のバグがある。
> 課金を戻しても、その問題は残る。→ DOMAIN.md §1

### 「フロントでフォールバックしてるはず。warn にすべきかな？」（初回）

→ **backend は 500 を返し、フロントは `api_call_error` を出していた。**

```
backend   searchRestaurants: Google Places 429
          "Quota exceeded for quota metric 'SearchTextRequest'
           and limit 'SearchTextRequest per day'"        682 件 / 125 人

frontend  /…/bulk-import: api_call_error (500)           340 件 / 125 人
                                              ↑ 影響ユーザー数が一致
```

`warn` へ落としていたら、**日次クォータ枯渇という実障害が毎日隠れる**ことになっていた。

> **訂正（オーナー確認）**: このとき「フォールバックしていなかった」と断定したのは誤り。
> 根拠にしたのは `api_call_error` の存在だけで、その後の UX ログを見ていなかった。
> 実際には 0 件確定後に Google Maps への退避導線が出ており、`api_call_error` 340件/125人 と
> `google_maps_fallback_dialog_shown` は完全一致、うち 115人（92%）が実際に Maps を開いていた。
> **`error` のままにする判断は変わらないが、理由が違う**（ユーザーが詰んでいるからではなく、
> 実障害を毎日可視化し続けるため）。→ DOMAIN.md §2

### 「1日に25人も Prisma 関連の障害うけてるってこと？」（初回）

→ **その通りだった。** しかも Issue 本文では原因が読めなかった。

```
Issue 本文:  `PrismaClientKnownRequestError:`      ← ここで切れている
生ログ:      Invalid `prisma.dish_media_views.create()` invocation:
             Foreign key constraint violated on the constraint:
             `dish_media_views_impression_id_fkey`
```

正規化の「1行目だけ残す」ルールが、Prisma のようにメッセージが2行目以降にある
エラーで診断情報を全部落としていた。**数字は信用してよいが、原因の記述は不完全**という
このスキルの前提はここから来ている。

## 記録の書き方

close / skip する Issue には、**後から辿れる根拠**を残す。最低限:

- 根本原因（生ログからの引用。1〜2行）
- 件数 / 影響ユーザー数 / 匿名件数
- 判断とその理由
- 重複なら代表 Issue 番号
- 旧ビルド残存なら commit id
- 修正が要るなら、引き渡した先の Issue / PR 番号

自動領域（`<!-- error-triage:auto:start -->` 〜 `end`）の**外**へ書く。
中に書くと次回 run で上書きされる。区切り線より下は自由記述で、スクリプトは触らない。
