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

| provider | ネイティブ（WebView） | web（iframe） | 突破の可否 |
| --- | --- | --- | --- |
| Instagram | ✅ 再生する | ⚠️ 1 タップ要る | web は**構造的に不可**（下記 4） |
| TikTok | ✅ 再生する | ⚠️ 1 タップ要る | 同上 |
| YouTube | ✅ 再生する（**包みが要る**） | ✅ 自動再生する | — |

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
