# SNS 取り込み投稿の制限一覧（Instagram / TikTok / YouTube）

取り込んだ SNS 投稿（`dish_media.render_type = 'external_embed'`）で
**どの provider の、どの場合に、何ができないか**を 1 枚で引くための表。

「なぜ音が出ないのか」「なぜ切れるのか」「なぜ店が入らないのか」を聞かれたときは、まずここを見る。
突破を試して駄目だったものは **駄目だった理由と実測**を残してある。同じ検討を繰り返さないこと。

- 実装: [`app-expo/features/dishMedia/`](../../app-expo/features/dishMedia/)（再生・レイアウト） /
  [`api/src/v1/dish-media-imports/`](../../api/src/v1/dish-media-imports/)（キャプション・店舗解決）
- 経緯と判断: [#1375](https://github.com/Ayato-kosaka/nanitabeyo/issues/1375) /
  [#1641](https://github.com/Ayato-kosaka/nanitabeyo/issues/1641)

## 大前提: 埋め込みでしか再生しない

**動画ファイル（CDN の MP4）を取り出して自前プレイヤーで流すことはしない。**
各 provider の規約が禁じており、[#1375 でオーナー判断として «やらない» に決めている](https://github.com/Ayato-kosaka/nanitabeyo/issues/1375)。
以下の制限は**すべて「公式の埋め込みを使う」という前提の上での制限**である。

## 1. アプリ内で再生できるか

**ネイティブを 1 列にまとめない。** Android（Chromium WebView）と iOS（WKWebView）で
**結果が違う provider が実在する**（下の TikTok）。Android だけ回していては気づけない。

| provider | Android | iOS | web（iframe） | 突破の可否 |
| --- | --- | --- | --- | --- |
| Instagram | ✅ 再生する | ✅ 再生する | ⚠️ 1 タップ要る | web は**構造的に不可**（下記 4） |
| TikTok | ✅ 再生する | ⏳ **実機検証中**（原因は特定済み。**document-start での注入**が要る。下記） | ⚠️ 1 タップ要る | — |
| YouTube | ✅ 再生する（**包みが要る**） | ✅ 再生する（同上） | ✅ 自動再生する | — |

### TikTok × iOS — 原因は «注入のタイミング» だった（2026-08-29 実測）

**TikTok の埋め込みページは、iOS の WKWebView では組み上がるのが遅い。**
iOS の `injectedJavaScript` は WKUserScript の **DocumentEnd** なので、そこへ届く前に
«読み込み中» のまま長く留まるページでは、自動再生スクリプトが 1 度も走らない
（`onLoadEnd` の撃ち直しも来ない）。**Android の Chromium WebView は同じページで先に到達する。**
これがプラットフォーム差の正体である。

WebKit（＝ WKWebView と同じエンジン）でローカル実測した数字:

| 時刻 | 状態 |
| --- | --- |
| 3.6s | `<video>` が現れる（`readyState` はまだ `loading`） |
| 10.3s | `interactive` ＝ **DocumentEnd の注入はここまで来ない** |
| 14.3s | `complete` |

**`<video>` は `loading` のうちに出ている。** つまり **DocumentEnd を待っていては間に合わない**。
document-start から撃つと **4.7 秒で再生した**。

**Android では再生する。** [run 33268418817](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/33268418817)
の `feed-04` に TikTok が全面で再生されたコマがある（映像・TikTok ロゴ・`@moto_gurume`・字幕）。
`boot` から再生まで **約 5 秒**。

⚠️ この run の spec は赤かったが、**アプリではなく spec のレースだった**。
記録の周回と «このセルは結論を出したか» の周回が別の時刻に印を読んでおり、
その隙（1 周は数秒かかる）に再生が始まると «結論は出たが記録されていない» になる。
`322e35a` で結論の周回でも記録するようにした。
**コマと BigQuery の両方を見なければ «再生できない» と誤読していた。**

⚠️ **実機（iOS シミュレータ）はローカルの WebKit と挙動が違う。**
document-start から走らせても、iOS では TikTok だけが再生しなかった
（[run 33265424032](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/33265424032)）。
BigQuery の `frontend_event_logs` に残った実測:

```
17:53:44  external_embed_agent_boot   tiktok    phase=boot  readyState=loading
17:54:01  external_embed_unplayable   tiktok    kind=timeout detail=still_loading   ← 17 秒後
17:54:25  external_embed_agent_boot   instagram phase=boot  readyState=loading
17:54:25  external_embed_agent_boot   instagram phase=dom   readyState=interactive  ← 同じ秒
17:54:25  external_embed_autoplay_started instagram audio=audible
```

**`dom` が 1 度も来ない。** Instagram は同じ秒のうちに `interactive` へ達している。
ローカルの WebKit では TikTok も 2 秒で `interactive` になり、**User-Agent を
WKWebView / iOS Safari のものへ変えても再現しない**（3 通り実測）。
つまり原因は «TikTok のページ» でも «UA» でもなく、**実機側の環境**にある。

いま観測を足して切り分けている（`stall` 報告 = 止まっている間の DOM の育ち方 /
`external_embed_nav_decision` = iOS がサブフレームごとに JS の返事を待つ回数）。
**iOS の `onShouldStartLoadWithRequest` は返事が来るまで WebKit 側を待たせる**
（`RNCWebViewImpl.m` の `decidePolicyForNavigationAction`。締め切りは無い）のに対し、
Android は間に合わなければ fail-open で先へ進む。これがプラットフォーム差の候補である。

そこで `injectedJavaScriptBeforeContentLoaded` にも同じエージェントを渡している
（`AUTOPLAY_SCRIPT` は先頭の `kick` ガードで二重起動を吸収するので、両方へ渡して安全）。

⚠️ **一度これを «効果ゼロ・害あり» と判断して撤回した（`78836f2`）。根拠は 2 つとも誤りだった。**

| 撤回時の根拠 | 実際 |
| --- | --- |
| 「document-start 注入のせいで Android が落ちる」 | ❌ 撤回後も同じ失敗が再現した。logcat は `lowmemorykiller` と 5 プロセスの signal 9 ＝ **エミュレータ全体の OOM** |
| 「ページが組み上がらないので `<video>` が現れない」 | ❌ 上の実測のとおり `<video>` は 3.6 秒で現れる |

**document-start から走らせるときの注意点（どちらも実測で踏んだ）:**

- **読み込み中は `fillPoster()`（全 `<img>` を舐める）を間引く。** 4 tick に 1 回にしてある。
  ⚠️ 止めてはいけない。1 コマ目を全面へ出すのがこの関数の仕事で、止めると
  «映像が出るまでの数秒が真っ黒» が戻る
- **地色は毎 tick 塗り直す。** 初回の tick には `<body>` がまだ無い。«一度塗ったら終わり» に
  すると、後から現れた `<body>`（埋め込みページ自身の白）を塗れず、**白が挟まる**
  （実測: 1.0s に `rgb(255,255,255)` / 3.5s に `isolate()` が消すまで残る）

**YouTube だけ包みの HTML が要る。** 埋め込み URL を WebView へ直接渡すと
トップレベル文書として開かれ、**必ずエラー 153** になる（誰でも埋め込める `dQw4w9WgXcQ` でも同じ）。
実在の https オリジンを持つページの中に iframe として置くと再生する。
→ [`embedUrl.ts` の `buildEmbedIframeHtml`](../../app-expo/features/dishMedia/embedUrl.ts)

## 2. 音が出るか

| provider | 音 | 理由 |
| --- | --- | --- |
| Instagram | ✅ 音あり | 埋め込みの `<video>` が最初からミュートでない |
| TikTok | ✅ 音あり（**こちらでミュートを外す**） | 向こうが `muted` で置いてくる。外さないと永久に無音だった |
| YouTube | ネイティブ ⚠️ 自動は無音・**タップで音あり** / web ✅ 音あり | 下記 |

**«音が出ない» は provider の制限ではなかった。** 同じ WebView で Instagram だけ音が出ていたことが
手がかりだった（実測: BigQuery `nanitabeyo_logs_dev.frontend_event_logs` /
`external_embed_autoplay_started` の `audio`）。

⚠️ **自動再生ポリシー（`NotAllowedError`）で蹴られたときだけ無音へ落とす。**
落とさないと再生そのものが止まり、«無音でも動く» すら失う。
→ [`ExternalEmbedPlayer.tsx` の `tryUnmute`](../../app-expo/features/dishMedia/components/ExternalEmbedPlayer.tsx)

### YouTube は «自動では» 音を出せない（試したことと結果）

**IFrame Player は、ユーザー操作なしの `unMute` を受け付けない。** 自動で撃つ 3 通りは、
いずれも実機で `audio=muted` のままだった。**ユーザーのタップを挟めば通る。**

| 試したこと | 結果 |
| --- | --- |
| `onReady` で `mute` → `playVideo` の順をやめ、`unMute` を先に撃つ | 無音（run 33167111834） |
| 埋め込み URL から `mute=1` を外す | 無音（run 33168644022） |
| 再生が始まってからも `unMute` を 0.3 秒おきに撃ち直す | 無音（run 33170443855） |

Instagram / TikTok で音が出るのは、あちらが**同一オリジンの `<video>` 要素**で、
`muted` プロパティを直接触れるからである。YouTube は別オリジンの iframe なので
**公式 API 越しにしか頼めず、その API が断る**。

**タップなら通る（実装済み・実機で確認）。** 無音で再生中のセルにだけ «音を出す» を出し、
押すと包みの HTML の `__nbEmbedUnmute` が `unMute` / `setVolume` / `playVideo` を撃ち直す。

    external_embed_autoplay_started  youtube  audio=muted
    external_embed_unmute_tapped     youtube  audio=audible   ← 出た（run 33210343724 で 2/2）

⚠️ **効いたかどうかは報告で判定する。** 押した結果を `unmute_result` として返し、
   `external_embed_unmute_tapped` としてログへ落としている。音が出たらボタンは消える
   （押しても何も起きないボタンを残さない）。
⚠️ web 版にはこのボタンを付けていない（あちらは元から音が出ている）。

## 3. 権利分岐（同じ provider でも投稿によって変わる）

| 状態 | 起きること | アプリの見え方 | 突破 |
| --- | --- | --- | --- |
| 通常 | 埋め込みに実体の `<video>` がある | セル全面で再生 | — |
| **権利ブロック**（Instagram / ライセンス楽曲） | 埋め込みページに `<video>` が**1 つも作られない** | 1 コマ目の写真を全面に出し、«Instagram で見る» の帯 | **不可**。何をしても再生できない |
| **YouTube が再生を断る** | `playerState` が -1 → 3 のまま進まない / YouTube 自身の bot 確認ページが出る | 地色で覆い «YouTube で見る» の帯 | ⚠️ **投稿者の設定とは限らない**（下記） |
| 削除・非公開 | `embedStatus = 'unavailable'` | 「この投稿は利用できません」 | — |

### 再生可否は取り込み時に判定して DB へ持つ（2026-08-28 / オーナー承認 [#1678](https://github.com/Ayato-kosaka/nanitabeyo/issues/1678)）

`dish_media_external_embeddings` に `playback_status` / `playback_reason` / `playback_checked_at`
を足した。**`embed_status`（投稿が生きているか）とは直交する** — 生きていても再生できない投稿がある。

| provider | 判定材料（**追加リクエストはゼロ**） | 結果 |
| --- | --- | --- |
| Instagram | 埋め込み SSR HTML の `video_url`（キャプション取得で既に引いている） | 在れば `playable` / 無ければ `not_playable(no_video_in_embed)` |
| YouTube | oEmbed の HTTP ステータス（既に引いている） | 200 → `playable` / **401 → `not_playable(embedding_disabled)`** |
| TikTok | 無し | `unknown`（触らない） |

これで効くこと:

- **検索フィードの候補から外れる**（`dish-media.repository.ts` の `base_candidates`。
  «1 dish につき代表 1 本» を選ぶ `ROW_NUMBER` より**前**で外す）
- **アプリが WebView をマウントしない。** 従来はどのセルもいったんページを読み、
  ページ内エージェントの報告を待って畳んでいた
- 取り込んだ**後で**壊れた投稿は、実際に踏んだ端末が
  `POST /v1/dish-media/imports/:id/playback-report` で知らせ、**サーバが判定し直す**
  （端末の判定は保存しない。6 時間の間引きあり）
- 既存行は [`scripts/db-backfill/backfill_embed_playback.py`](../../scripts/db-backfill/backfill_embed_playback.py) が 1 回きりで埋める

⚠️ **`unknown` を `not_playable` に寄せない。** TikTok は常に `unknown` で、
«playable 以外を弾く» と書いた瞬間に TikTok が 1 本も出なくなる。
provider の仕様変更で判定できなくなった日に取り込み済みの投稿が一斉に消えるのも同じ理屈である。

### ⚠️ 再生をやめると «絵» も消える（2026-08-29 に踏んだ）

高速パスを入れた実機のコマで、そのセルが**真っ黒**になった（run 33223480840 の `feed-05`）。
それまで見えていた料理の写真は**アプリが持っていたものではなく、Instagram の埋め込みページが
描いていた 1 コマ目**で、読み込みをやめた瞬間に消えていた。

そこでサムネイルの解決順を «必ず何かが出る» 形にしてある（`dish-media.assembler.ts`）。

| # | 出どころ | 失効するか |
| --- | --- | --- |
| 1 | `dish_media.thumbnail_path`（自ストレージへ複製したもの） | しない |
| 2 | `dish_media_external_embeddings.thumbnail_url`（provider の CDN） | **する**（Instagram の署名 URL は 4〜5 日） |
| 3 | 料理カテゴリの絵 | しない |

3 を当てるのは **`render_type='external_embed'` の行だけ**である。自撮り投稿で
サムネイルが無いのは «加工がまだ終わっていない» という別の状態で、そちらはスケルトンが正しい。

2 しか持たない行（取り込み当時に複製へ失敗した古い行）は、
[`scripts/db-backfill/backfill_embed_playback.py`](../../scripts/db-backfill/backfill_embed_playback.py) を
流し直すたびに URL が入れ替わる。

### ⚠️ «YouTube が埋め込み不可» という判断は誤りだった（2026-08-28 訂正）

オーナーの Short（`8KJDwppL0qg`）を «投稿者が埋め込みを許していない» と結論していたが、**誤り**。

    curl 'https://www.youtube.com/oembed?url=...v=8KJDwppL0qg&format=json'
      → 200 /【月島】1度食べたら戻れない！人生で1番飲める焼鳥！

**埋め込みできない動画は oEmbed が 401 を返す。** 200 が返る＝埋め込み可能である。
実際 web のプレビューでは普通に再生できている（オーナー実測）。

ネイティブで再生できなかった原因は**環境側**の疑いが濃い。CI のエミュレータでは
YouTube 自身の「ログインして bot ではないことを確認してください」が出ていた
（データセンター IP + WebView の UA は bot 判定に当たりやすい）。
**実機で同じことが起きるかは未確認**（EAS Build が要るため確かめられていない）。

## 4. web が自動再生できない理由（Instagram / TikTok）

**同一オリジンでない `<iframe>` の中へスクリプトを注入できない。** これはブラウザのセキュリティ境界で、
`allow="autoplay"` を渡しても変わらない。**埋め込みページ自身が `play()` を呼ばない**以上、
外から撃つしかなく、web にはその手段が無い。

ネイティブが再生できるのは、WebView が埋め込みをトップレベル文書として開くため
**同一オリジンになり、注入できる**からである。この非対称は埋め込みを使う限り解消しない。

YouTube だけ web でも自動再生するのは、YouTube の埋め込みが URL の `autoplay=1` を
**自分で解釈する**からで、こちらが注入しているわけではない。
⚠️ ブラウザの自動再生ポリシーは «無音でなければ蹴る» が既定なので、**web では無音で始まりうる**
（ネイティブは `mediaPlaybackRequiresUserAction={false}` なのでこの制限を受けない）。

<details>
<summary>検討して採らなかった突破案</summary>

- **埋め込みページを自ドメインからプロキシして同一オリジンにする** — 技術的には注入できるようになるが、
  第三者のページを自ドメインで配信することになり規約上の問題が大きい。**採らない。**
- **CDN の MP4 を取り出す** — 規約違反。[#1375 でオーナー判断として «やらない»](https://github.com/Ayato-kosaka/nanitabeyo/issues/1375)。

</details>

## 5. レイアウト（切り取らない）

**「全画面」は «切り取ってでも埋める» ではない**（オーナー判断 2026-08-27）。
`cover` は左右が約 18% 切れ、`fill` は縦横比が壊れる。どちらも投稿された映像を勝手に変える。

| | やり方 |
| --- | --- |
| ネイティブ | 注入したスクリプトが `<video>` 自身をセル全面へ広げる（`object-fit: contain`）。祖先の `transform` / `filter` を解除し、兄弟を隠して provider の UI を消す |
| web | 中に触れないので**外から位置と大きさで合わせる**。⚠️ この計算は **Instagram の埋め込みを実測した値**（ヘッダ 54px / メディア枠 4:5）で、**他の provider は形が違う**ため切らずに全面で描く |

→ [`embedCrop.ts`](../../app-expo/features/dishMedia/embedCrop.ts)（web 専用。数値の実測値もここ）

## 5.5 受け付ける URL の形

**YouTube は Shorts だけを対象にする設計**（#1399 リーダー確定）。ただし `watch?v=` も
いったん受け付け、`shortsUnconfirmed` を立てて «呼び出し側が HEAD で確定させる» ことになっている。

⚠️ **その確定処理はどこにも実装されていない**（`shortsUnconfirmed` の参照が 0 箇所）。
そのため **横長の通常動画も取り込めてしまい**、セルでは上下に黒帯が出る。
検証用に取り込んだ `dQw4w9WgXcQ` がまさにこれで、**本来は仕様の対象外**である。

## 6. キャプション（＝ 店舗が入るか）

店舗はキャプションの住所から解決する。**キャプションが取れない provider では店を手で選ぶことになる。**

| provider | キャプションの取り方 | 落とし穴 |
| --- | --- | --- |
| Instagram | 埋め込みの SSR HTML から取る（oEmbed は返さない） | — |
| TikTok | **公式 oEmbed の `title`**。短縮 URL（`vt.tiktok.com/...`）をそのまま渡せる | Cloud Run から `vt.tiktok.com` へ**接続できない**（応答なし）。リダイレクト追跡は当てにしない |
| YouTube | 視聴ページの HTML から**説明文**を取る（oEmbed は題名だけ。店名・住所は説明文にある） | **置き場所が環境で違う**。`descriptionBodyText.runs` → `videoDetails.shortDescription` → `attributedDescription.content` の順に試す。ページ全体から `"text":"…"` を拾うとプレイヤーの UI 文言が混ざる |

→ [`sns-oembed.service.ts`](../../api/src/v1/dish-media-imports/sns-oembed.service.ts)

⚠️ **料理カテゴリの候補は TikTok / YouTube では 0 件**（Instagram は 5 件）。
店は入るがカテゴリは手で選ぶことになる。#1641 の変更前からの挙動で、まだ直していない。

## 7. まだ塞げていないもの

| | 状況 |
| --- | --- |
| メモリ（アプリ側） | 埋め込みを送りながら 3 run 実測して **積み上がっていない**（例 run 33170443855: totalPss 226 → 188 → 179 → 220 → 211 → 212 → 207 → 201 → 199 MB、native 40〜49 MB で横ばい）。前面のセルだけが WebView を持つ設計が効いており、**«並べる本数を減らす» は対策にならない**。計測は [`e2e-mobile/utils/memoryProbe.ts`](../../e2e-mobile/utils/memoryProbe.ts) が毎 run 残す |
| プロセス消滅 | run 33172115088 で捕まえた。**アプリだけでなく 6 プロセスが 1.5 秒の間に signal 9 でまとめて殺されている**（Detox の instrumentation 込み。`logcat-crash.log` は 0 バイト＝クラッシュ記録なし）。アプリのリークではなく **エミュレータ全体のメモリ逼迫**。CI 環境の問題であって、実機で同じことが起きるかは**分からない** |
| 観測 | クラッシュレポート SDK も JS のグローバルエラーハンドラも無い。**実ユーザーが踏んでも誰も気づけない。** 上のプロセス消滅が実機で起きているかどうかも、この穴があるかぎり答えられない。塞ぐにはネイティブモジュールが要る（＝ EAS Build が要る） |
| web の 1 タップ | 上記 4 と同根。ただし «1 タップ目が操作モードへ入るのに消費される» 点は改善余地がある |
