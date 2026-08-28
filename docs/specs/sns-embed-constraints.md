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
| YouTube | ✅ 音あり（**URL の `mute=1` を外す**） | 埋め込み URL に `mute=1` を付けていた。**無音で始まったプレイヤーは後から `unMute` を撃っても戻らない**（実測 run 33167111834）。あわせて `unMute` → `playVideo` の順で撃つ |

**«音が出ない» は provider の制限ではなかった。** 同じ WebView で Instagram だけ音が出ていたことが
手がかりだった（実測: BigQuery `nanitabeyo_logs_dev.frontend_event_logs` /
`external_embed_autoplay_started` の `audio`）。

⚠️ **自動再生ポリシー（`NotAllowedError`）で蹴られたときだけ無音へ落とす。**
落とさないと再生そのものが止まり、«無音でも動く» すら失う。
→ [`ExternalEmbedPlayer.tsx` の `tryUnmute`](../../app-expo/features/dishMedia/components/ExternalEmbedPlayer.tsx)

## 3. 権利分岐（同じ provider でも投稿によって変わる）

| 状態 | 起きること | アプリの見え方 | 突破 |
| --- | --- | --- | --- |
| 通常 | 埋め込みに実体の `<video>` がある | セル全面で再生 | — |
| **権利ブロック**（Instagram / ライセンス楽曲） | 埋め込みページに `<video>` が**1 つも作られない** | 1 コマ目の写真を全面に出し、«Instagram で見る» の帯 | **不可**。何をしても再生できない |
| **埋め込み不可**（YouTube 側の設定） | `playerState` が -1 → 3 のまま進まない | 同上（«YouTube で見る»） | **不可**。投稿者の設定 |
| 削除・非公開 | `embedStatus = 'unavailable'` | 「この投稿は利用できません」 | — |

**権利ブロックは取り込み時点で判る。** 埋め込みの SSR HTML に `video_url` があるかどうかが
«再生できる» を 9/9 で言い当てた。追加リクエストはゼロ。

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
| メモリ | 埋め込み 6 本を送りながら実測したところ **積み上がっていない**（run 33167111834 / Android: totalPss 237 → 209 → 198 → 195 → 211 → 218 → 210 MB、native 48〜54 MB で横ばい）。前面のセルだけが WebView を持つ設計が効いている。**«本数を減らす» は対策にならない。** 以前アプリが `lowmemorykiller` に殺された件（run 33133043261）は別の原因で、まだ特定できていない。計測は [`e2e-mobile/utils/memoryProbe.ts`](../../e2e-mobile/utils/memoryProbe.ts) が毎 run 残す |
| 観測 | クラッシュレポート SDK も JS のグローバルエラーハンドラも無い。**実ユーザーが踏んでも誰も気づけない** |
| web の 1 タップ | 上記 4 と同根。ただし «1 タップ目が操作モードへ入るのに消費される» 点は改善余地がある |
