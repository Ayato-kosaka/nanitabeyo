
---

## 削除したあとに残る «墓標»（追加分）

論理削除は「どこからも出さない」だけでは足りなかった。**いいねした事実・通知が届いた事実・食べた記録は、写真を消しても消えない**。そこだけ行を消すと、利用者からは «取りこぼし» と区別が付かない。

オーナー確定の切り分け:

- **墓標を出す（行は残す）**: いいね一覧 / 保存一覧 / 通知 / レビューのサムネイル / my-dishes
- **黙って除外**: 検索結果 / 店舗フィード / 投票候補

### 経路ごとの扱い（`fetchDishMediaEntryItems` の全呼び出し）

| # | 呼び出し元 | 経路 | 扱い | 状態 |
|---|---|---|---|---|
| 1 | `users.service.ts:124` | `GET /v1/users/:id/dish-reviews`（レビューのサムネイル） | 墓標 | `includeDeleted: true` ✅ / **app-expo に呼び出し元がまだ無い**（UI 未実装） |
| 2 | `users.service.ts:208` | `GET /v1/users/me/liked-dish-media`（いいね一覧） | 墓標 | ✅ API + UI |
| 3 | `users.service.ts:322` | `GET /v1/users/me/saved-dish-media`（保存一覧） | 墓標 | ✅ API / **app-expo に呼び出し元がまだ無い**（UI 未実装） |
| 4 | `notifications.service.ts:104` | `GET /v1/notifications`（通知） | 墓標 | ✅ API + UI |
| 5 | `users.service.ts:448` | my-dishes（一覧 / カレンダー / 地図） | 墓標 | ✅ `isOwnMediaDeleted` + `dishMedia: null` の別経路で実装済み |
| 6 | `restaurants.service.ts:488` | 店舗フィード | 黙って除外 | ✅ 既定のまま |
| 7 | `dish-media.service.ts:69` | `findByCriteria`（検索結果） | 黙って除外 | ✅ 既定のまま |
| 8 | `dish-media.service.ts:89` | `GET /v1/dish-media?ids=`（全画面フィード） | 黙って除外 | ✅ 既定のまま |
| 9 | `dishes.service.ts:242` | bulk-import の再利用判定（内部） | 黙って除外 | ✅ 既定のまま |

`getDishMediaEntriesByIds` は既定で `deleted_at IS NULL`。**墓標を出す 4 経路だけ `includeDeleted: true` で明示的に opt-in する**形にした。逆（既定で返して除外側が外す）にすると、新しい経路を足した人が黙って削除済みを見せてしまう。

削除済みが返るときは assembler が `mediaUrl` / `thumbnailImageUrl` を **null** にする。署名 URL を作らないので、実体が残っていても取り出せない。

> ⚠️ 判定は `deleted_at != null` で書くこと。`!== null` にすると、この列を持たない入力（テストのフィクスチャ・古いキャッシュ）が `undefined` になり **生きている投稿まで削除済み扱いになる**。API 側で実際に 7 テストが落ちた。UI 側にも同じ番人を置いてある。

### 押せなくする

墓標の行はタップ先が無い（フィードには実体が無い）。`ImageCard` は `onPress` を渡さなければ `disabled` になり、通知の行は `TouchableOpacity` を `disabled` にしている。**これは絵に写らない**ので、`router.push` が呼ばれないことをテストで固定した。

### コントラスト

墓標は写真の代わりに出るので、読めなければ意味が無い。アイコンだけの variant（カレンダーのセル / 地図のピン / 通知のサムネイル枠）では、そのアイコンが «削除された» を伝える唯一の手掛かりになる。

| | ライト | ダーク | 必要 |
|---|---|---|---|
| 文字 `textSecondaryAlt` | 6.87:1 | 8.44:1 | 4.5:1（AA・10pt = 小さい文字） |
| アイコン `textSecondary` | 4.39:1 | 6.20:1 | 3:1（WCAG 1.4.11 非文字） |

初期実装（文字 `textSecondary` / アイコン `textTertiary`）は**ライトで 4.39:1 / 2.31:1** と割っていた。エビデンスを撮って実測して気づいたので直した。`Palettes` から計算して数値を固定するテストを足してある（`DeletedMediaTombstone.contrast.test.ts`）。

## エビデンス

ライト / ダークの 2 セット。**削除済みと生存を混ぜて撮っている**（全部墓標だと「全滅しているだけ」と区別が付かない）。

いいね一覧 — 1・3 枚目が墓標、2・4 枚目は写真:

<img width="360" src="https://storage.googleapis.com/nanitabeyo-public/e2e-evidence/Ayato-kosaka/nanitabeyo/runs/32707026228/claude-issue-1513-tombstone-evidence-32707026228-1/evidence/tombstone-1513-light-01-liked.png"> <img width="360" src="https://storage.googleapis.com/nanitabeyo-public/e2e-evidence/Ayato-kosaka/nanitabeyo/runs/32707026228/claude-issue-1513-tombstone-evidence-32707026228-1/evidence/tombstone-1513-dark-01-liked.png">

通知一覧 — 1・3 行目のサムネイル位置が墓標、2 行目は写真:

<img width="360" src="https://storage.googleapis.com/nanitabeyo-public/e2e-evidence/Ayato-kosaka/nanitabeyo/runs/32707026228/claude-issue-1513-tombstone-evidence-32707026228-1/evidence/tombstone-1513-light-02-notifications.png"> <img width="360" src="https://storage.googleapis.com/nanitabeyo-public/e2e-evidence/Ayato-kosaka/nanitabeyo/runs/32707026228/claude-issue-1513-tombstone-evidence-32707026228-1/evidence/tombstone-1513-dark-02-notifications.png">

- 動画: [light](https://storage.googleapis.com/nanitabeyo-public/e2e-evidence/Ayato-kosaka/nanitabeyo/runs/32707026228/claude-issue-1513-tombstone-evidence-32707026228-1/evidence/tombstone-1513-light.webm) / [dark](https://storage.googleapis.com/nanitabeyo-public/e2e-evidence/Ayato-kosaka/nanitabeyo/runs/32707026228/claude-issue-1513-tombstone-evidence-32707026228-1/evidence/tombstone-1513-dark.webm)
- 一覧: [ギャラリー](https://storage.googleapis.com/nanitabeyo-public/e2e-evidence/Ayato-kosaka/nanitabeyo/runs/32707026228/claude-issue-1513-tombstone-evidence-32707026228-1/index.html) / [manifest.json](https://storage.googleapis.com/nanitabeyo-public/e2e-evidence/Ayato-kosaka/nanitabeyo/runs/32707026228/claude-issue-1513-tombstone-evidence-32707026228-1/manifest.json)

⚠️ **認証・API・地図はすべてモックである。**映っているのは «画面» であって実データではない。また撮影は **この PR + #1549（ダークモード追従）をマージした木**（`b606ff67`）で行っている。#1549 が入るまで、いいね一覧の地とレビュー画面はライトのままになる。

## 撮って見て見つけて直した不具合 3 件

「保存できた」ではなく「保存したものが読めた」まで見るために PNG を自分で開いた結果、3 件見つかった。いずれも修正済み。

1. **ダークで «白いシートの上に黒い墓標»**。通知一覧だけ地が白直書きのままだった。墓標側を «この画面ではライト固定» に細工すると、後でこの画面をトークン化したときに取り残されるので、地の方（画面全体）をテーマ追従にした
2. **墓標が 50x50 のはずが 50x18 の平たい丸バッジに潰れていた**。墓標の既定は `flex: 1` で、**web では CSS の `flex` 短縮形が効いて `flex-basis: 0%` になる**ため縦が主軸の枠では height が潰れる。`flex: 0` を足しても CSS では `0 1 0%` なので直らない。50x50 の枠を外側の View に持たせる形へ変えた
3. **`renderNotificationItem` の依存配列から `styles` が漏れていて、行だけライトのまま白く残っていた**。web は hydration 前がライト固定で、その後ダークへ解決し直される

## ⚠️ #1469 へ取り込むときに必要な作業（2 件）

この PR 単体では緑だが、**#1549（`assert-no-hardcoded-colors` のゲート）と同時に #1469 へ入ると落ちる**。マージする人向けに書いておく。

1. **`app/[locale]/(tabs)/notifications/index.tsx` の EXCLUSIONS 行を消す。**
   この PR で同ファイルをトークン化したため、#1549 の除外リストに «解消済みなのに残っている行» ができる。ゲートは stale な除外行で落ちる仕様（`❌ 除外リストのファイルから直書きが消えています`）。マージ後の木で実際に落ちることを確認済み
2. **`features/dishMedia/components/OwnPostActions.tsx` をトークン化する（直書き 22 箇所）。**
   この PR が新規に足したファイルで、#1549 のゲートに引っかかる。必要なトークン（`borderMuted` / `textPlaceholder`）は **#1549 側にしか無い**ので、この PR 単体では直せない。#1469 に両方入ったあとに行う

## テスト（追加分）

- api: `tsc` 0 error / `jest` **628 passed**（assembler に «削除済みは URL を作らない» / «`deleted_at` を持たない入力を削除済みにしない» の 2 件を追加）。
  実行できない 9 suite は `api/.env` を要求する既存のもので本 PR とは無関係
- app-expo: `tsc` 0 error / `jest` **130 suites・1367 passed**
  - `LikeTab.tombstone.test.tsx`（4 件）… 行が残る / 写真を出さない / 押せない / `deleted_at` 無しを誤判定しない
  - `__tests__/notificationsTombstone.test.tsx`（4 件）… 同上
  - `DeletedMediaTombstone.contrast.test.ts`（4 件）… light / dark × 文字 / アイコン
  - `!= null` を `!== null` に変えると、この 8 件のうち «`deleted_at` 無し» の 2 件だけが落ちることを実測
