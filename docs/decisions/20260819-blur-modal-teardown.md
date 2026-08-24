# BlurModal 影響調査と撤去方針

対象: `app-expo/features/blurModal/hooks/useBlurModal.tsx`
調査日: 2026-08-15 / 対象コミット: `9c871ee`

> **改訂 2**: 初版はファイル数を 20 と誤記していた（正: **21**）。また `useBlurModal` の
> grep 1 本だけで「全部」としていたため、**BlurModal 以外のオーバーレイ機構**（RN `<Modal>` /
> TrueSheet / `showDialog` / ActionSheet / `transparentModal` ルート / 自前フルスクリーン層）を
> 数えていなかった。§2 を機械的に再集計し、§3 に全機構のマップを追加。§4 に死にコード 2 件を追記。
>
> **改訂 3**: D 群の店詳細を「TrueSheet」としていたのを **ルート**へ訂正（§2-D）。背景の地図が
> 実際には見えていないこと、入れ子が解けないこと、既に同じ店詳細のルート実装が存在することが理由。
>
> **改訂 4**: 実装着手後、認証ルート化の設計 run（#1359）が調査の誤りを 2 件見つけたので訂正する。
> (1) **OTP モーダルも死にコードだった**（死にコードは 1 件ではなく 2 件）。§4 に追記。
> (2) **E2E は `Common.close`（右上の X）を掴んでいない**。§9 の依存の書き方が誤りだった。
> あわせて、電話番号 / SMS ログインの扱いがオーナー判断で「削除」に確定した（§4）。
>
> **改訂 5（完了記録）**: 方針どおり実装が完了し、`useBlurModal` は **31 → 0 件**になった。
> 実施結果を §11 に、当初計画（§9）との差分もそこに残す。この文書は以後、
> 「なぜオーバーレイを使わないのか」を説明するための記録として参照する。

---

## 1. 結論（先に）

**「全方位ベストプラクティスなモーダルを作り直せば確実にバグが消える」とは言えない。**

これまでのバグは実装ミスではなく、**「アプリのツリーの中に絶対配置のレイヤを重ねる」という
仕組みそのものの帰結**だった。`useBlurModal` は次の4つを自前で持っていない。

1. ナビゲーション履歴との関係（戻る・URL・ディープリンク）
2. キーボードとウィンドウの調停（OS の仕事の再実装）
3. 重なり順の管理（呼び出し側の手動 `zIndex`）
4. モーダルの意味論（フォーカストラップ / 背景の読み上げ抑止 / Esc）

これを「完璧に」作り直すことは、**iOS / Android / Web の3面ぶんの OS 挙動差を自前で
持ち続ける**という意味になる。実際 #1122 は「iOS だけ無事」だった。

> **推奨: `useBlurModal` を公開アプリから撤去し、「ルート遷移 / 既存シート / 既存ダイアログ」の
> 3プリミティブへ振り分ける。ぼかしは "見た目" として必要な画面にだけ残す。**

前例あり: #951 でフィードバックは BlurModal をやめ専用画面 `profile/feedback` へ移した
（`app/[locale]/(tabs)/profile/settings.tsx:82` に設計コメントが残っている）。

---

## 2. `useBlurModal` の全使用箇所（21 ファイル / 31 インスタンス）

再現コマンド（この数字は目視ではなく下記の出力）:

```bash
cd app-expo
grep -rn "useBlurModal(" --include=*.tsx --include=*.ts . \
  | grep -v "\.test\." | grep -v "export function useBlurModal" \
  | sed 's/:.*//' | sort | uniq -c
```

| ファイル                                                                           |     数 |
| ---------------------------------------------------------------------------------- | -----: |
| `app/[locale]/(tabs)/map.tsx`                                                      |      1 |
| `app/[locale]/(tabs)/profile/settings.tsx`                                         |      1 |
| `app/[locale]/(tabs)/review/index.tsx`                                             |      1 |
| `app/[locale]/auth/callback.tsx`                                                   |      1 |
| `app/[locale]/contribution-tasks/dish-category-image-optimizer.tsx`                |      1 |
| `app/[locale]/contribution-tasks/dish-category-image-review.tsx`                   |      1 |
| `app/[locale]/contribution-tasks/dish-category-manual-image-supply.tsx`            |      2 |
| `app/[locale]/contribution-tasks/dish-category-manual-text-supply.tsx`             |      2 |
| `app/[locale]/contribution-tasks/dish-copy-survey.tsx`                             |      1 |
| `app/[locale]/contribution-tasks/dish-ranking-summary.tsx`                         |      4 |
| `features/dishCategoryGroupVotes/components/DishCategoryGroupVoteResultScreen.tsx` |      1 |
| `features/dishCategoryGroupVotes/components/DishCategoryGroupVoteVoteScreen.tsx`   |      1 |
| `features/dishMedia/components/ActionButtons.tsx`                                  |      1 |
| `features/map/components/FeedDishMediaViewer.tsx`                                  |      1 |
| `features/map/components/ReviewForm.tsx`                                           |      2 |
| `features/map/components/SelectedRestaurantDetails.tsx`                            |      3 |
| `features/map/components/tabs/RestaurantReviewsTab.tsx`                            |      1 |
| `features/profile/components/LoginbackModal.tsx`                                   |      2 |
| `features/profile/containers/ProfileTabsLayout.tsx`                                |      2 |
| `features/profile/tabs/SavedTopicsTab.tsx`                                         |      1 |
| `features/review/components/SelectedRestaurantDetails.tsx`                         |      1 |
| **合計**                                                                           | **31** |

### 用途別の内訳（31 = 6+3+2+6+1+2+11）

#### A. 認証（6）

| 場所                                                          | モーダル                 | 中身                    |
| ------------------------------------------------------------- | ------------------------ | ----------------------- |
| `features/profile/containers/ProfileTabsLayout.tsx:44`        | `LoginModal`             | `LoginbackModal`        |
| `features/map/components/SelectedRestaurantDetails.tsx:68`    | `LoginBlurModal` (z1400) | `LoginbackModal`        |
| `features/review/components/SelectedRestaurantDetails.tsx:63` | `LoginBlurModal` (z1400) | `LoginbackModal`        |
| `app/[locale]/(tabs)/review/index.tsx:26`                     | `LoginBlurModal` (z1400) | `LoginbackModal`        |
| `features/profile/components/LoginbackModal.tsx:33`           | `OtpModalComponent`      | `OtpModal`（TextInput） |
| `app/[locale]/auth/callback.tsx:51`                           | `ConflictModal`          | プロバイダ競合の告知    |

上4件は**同じログイン UI の複製**。`/auth/login` 1本に集約すれば 4 → 1。

**レビュータブ（`(tabs)/review/*`）で BlurModal を使っているのはこの2件だけで、どちらも
ログイン。** つまりレビュータブ側は独自の改修不要で、認証のルート化に巻き取られて消える。
（同タブの `SavedRestaurantsSheet` は既に TrueSheet で BlurModal ではない）

#### B. 法務ドキュメント（3）

`LoginbackModal.tsx:35` / `settings.tsx:88` / `ReviewForm.tsx:232` の `LegalDocumentModal`。

#### C. プロフィール（2）

| 場所                       | モーダル           | 中身                                                                                                      |
| -------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------- |
| `ProfileTabsLayout.tsx:43` | `ProfileEditModal` | `ProfileEditForm`（`KeyboardAwareForm` + TextInput 複数）                                                 |
| `SavedTopicsTab.tsx:60`    | `LocationModal`    | `LocationSearchForm`（**保存した料理＝トピックから地点で検索するやつ**。オートコンプリート + キーボード） |

#### D. 地図・店詳細・レビュー投稿（6）

| 場所                                   | モーダル                                            | 中身                        |
| -------------------------------------- | --------------------------------------------------- | --------------------------- |
| `map.tsx:46`                           | `RestaurantBlurModal` (z1100, `height: "90%"`)      | `SelectedRestaurantDetails` |
| `map/SelectedRestaurantDetails.tsx:58` | `ReviewBlurModal` (z1200)                           | `ReviewForm`                |
| `map/SelectedRestaurantDetails.tsx:63` | `BidBlurModal` (z1300)                              | 入札                        |
| `ReviewForm.tsx:222`                   | `DishCategoryModal` (**既定 z1100**)                | `DishCategorySearchForm`    |
| `FeedDishMediaViewer.tsx:23`           | `ReviewFormModal`                                   | `ReviewForm`                |
| `RestaurantReviewsTab.tsx:33`          | `DishMediaModal` (既定 z1100, `paddingVertical: 0`) | フィード全画面              |

**最大3段の入れ子。しかも親子で zIndex が逆転している:**

```
map.tsx  RestaurantBlurModal (z1100)
  └ SelectedRestaurantDetails  ReviewBlurModal (z1200)
      └ ReviewForm  DishCategoryModal (z1100 ← 親より下)
```

**店詳細を TrueSheet にしない理由（改訂3で訂正）。** 改訂2までは「地図を見せたまま出したいので
店詳細は TrueSheet」としていたが、根拠が成り立たない。

- `intensity: 100` + `height: "90%"` で **背景の地図はほぼ見えていない**（Android は α=0.9 の白ベタ）
- 前例にした `SavedRestaurantsSheet` は detents + draggable で高さを変えながら地図を操作する用途。
  店詳細は 90% 固定・ドラッグなしで性質が違う
- 店詳細をシートにすると、その中の レビュー投稿(z1200) / 入札(z1300) / ログイン(z1400) が
  **ネイティブシートの上に載る**という一番難しい形が残る
- **既にルート版が存在する**: `app/[locale]/(tabs)/review/restaurant/[restaurantId].tsx` が
  `features/review/components/SelectedRestaurantDetails`（241行）をフルスクリーンで描いている。
  map 版（`features/map/components/SelectedRestaurantDetails`, 353行）と **店詳細が2実装ある**

したがって **D 群は全部ルート**とし、map の店詳細は既存ルートへ統合する。
「下から出るシートの見た目」を残したい場合は `presentation: "formSheet"`
（`react-native-screens` 4.16 で利用可、Web はフルスクリーンにフォールバック）を使えば、
**URL と履歴を Stack に持たせたまま**見た目だけシートにできる。
`app/[locale]/(tabs)/search/_layout.tsx:14` に `transparentModal` の前例がある。

要点は「シートに見えるか」ではなく **誰が履歴と重なり順を持つか**。

#### E. 料理カードのメニュー（1）— **到達不能な死にコード**

`features/dishMedia/components/ActionButtons.tsx:89`。

- 開く関数 `handleMenuOpen`（266行）は **定義のみで参照ゼロ**
- 唯一の起動ボタンは 412–417 行で **コメントアウト済み**

つまり**このモーダルは UI から開けない**。ActionSheet への載せ替えは不要で、
`BlurModal` ごと `menuOptions` / `handleMenuOpen` / `styles.menuContainer` を削除するだけ。

#### F. 友達の料理投票（2）

| 場所                                        | モーダル                   | 備考                                                                                 |
| ------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------ |
| `DishCategoryGroupVoteVoteScreen.tsx:43`    | `CompletionBlurModal`      | `showCloseButton: false` / `closeOnBackdropPress: false` / `minHeight: windowHeight` |
| `DishCategoryGroupVoteResultScreen.tsx:106` | `CandidateDetailBlurModal` | `minHeight: windowHeight`、#1122 の当事者                                            |

前者は「閉じるボタンなし・背景タップ無効・全画面」＝**既に実質は画面**。

#### G. コントリビューションタスク（11・社内向け）

`dish-ranking-summary` 4 / `manual-image-supply` 2 / `manual-text-supply` 2 /
`dish-copy-survey` 1 / `image-optimizer` 1 / `image-review` 1。

---

## 3. BlurModal 以外のオーバーレイ機構（初版で数えていなかったぶん）

「あとで漏れが出る」を防ぐため、画面の上に何かを重ねる手段を全部並べる。

| 機構                                                    | 箇所 | 場所                                                                                                                                                                                                            |
| ------------------------------------------------------- | ---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useBlurModal`                                          |   31 | §2                                                                                                                                                                                                              |
| react-native `<Modal>`                                  |    3 | `contribution-tasks/dish-copy-survey.tsx:445`（ヘルプ）/ `features/topics/components/TopicsSpotlightTutorial.tsx:645` / `features/map/components/InitialMediaPreview.tsx:91`（動画）                            |
| `@lodev09/react-native-true-sheet`                      |    2 | `features/review/components/SavedRestaurantsSheet.tsx:271` / `features/search/components/TutorialBottomSheet.tsx:251`                                                                                           |
| `DialogProvider` の `showDialog`                        |    7 | `hooks/useAPICall.ts:308,330` / `settings.tsx:221` / `blocked-topics.tsx:176` / `search/topics.tsx:663` / **`features/topics/hooks/useBlockTopic.ts:64`（トピックのブロック）** / `useGoogleMapsFallback.ts:51` |
| `@expo/react-native-action-sheet`                       |    1 | `features/dishMedia/components/DishMediaMap.tsx:277`                                                                                                                                                            |
| `presentation: "transparentModal"` ルート               |    1 | `app/[locale]/(tabs)/search/_layout.tsx:14`（`result`）                                                                                                                                                         |
| 自前フルスクリーン層（`absoluteFill` + `zIndex: 9999`） |    2 | `profile/search-results.tsx:67` / `search/result.tsx:202`                                                                                                                                                       |
| 固定バナー（`zIndex: 1000`）                            |    1 | `components/deepLinking/OpenInAppBanner.tsx:356`                                                                                                                                                                |

**トピックのブロック確認は `showDialog`（react-native-paper の `Dialog`）であって BlurModal
ではない。** よってこの撤去の影響を受けず、そのままで完了。

---

## 4. 死にコード（撤去のついでに消せるもの）

| 対象                                                         | 状態                                                                   | 根拠                                                                                                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/dishMedia/components/ActionButtons.tsx` のメニュー | 起動ボタンがコメントアウト、`handleMenuOpen` の参照ゼロ → **開けない** | 起動ボタンは 412–417 行でコメントアウト                                                                                                                          |
| `features/profile/components/CreateAccountModal.tsx`         | **import している箇所がゼロ**                                          | リポジトリ全体の grep                                                                                                                                            |
| `features/profile/components/OtpModal.tsx`（A 群 5 番）      | **UI から到達できない**                                                | `openOtpModal()` の呼び元 `handleSubmit` を参照しているのは**コメントアウトされた** `PrimaryButton` だけ。電話番号の `TextInput` も divider もコメントアウト済み |

**OTP は改訂 2 までの調査で見落としていた。** A 群 6 件のうち 1 件は「認証のルート化で移す対象」では
なく「消す対象」だった。**電話番号 / SMS ログインの削除はオーナー判断として確定**している（#1359）。

削除で一緒に失われるものを記録しておく（復活時は git から設計コメントごと復元すること）:

- #1205 で入れた OTP 再送・検証の二重実行ガードと、その回帰テスト `OtpModal.test.tsx`

復活させる場合は**別ルート**（`/[locale]/auth/login/otp?phone=...`）にする。番号入力と OTP 入力は
「やり直したくなる 2 段階」で、戻る手段を Navigator に持たせないと自前の戻るボタンを抱えることになる。

---

## 5. これまでのバグ

| Issue           | 内容                                                                             | 根っこ                                        |
| --------------- | -------------------------------------------------------------------------------- | --------------------------------------------- |
| #202            | iOS 実機 Feedback 入力欄で日本語が1文字ずつ切れる                                | キーボード自前管理                            |
| #292            | `HideTopicBlurModal` で IME が1文字ずつ確定                                      | 同上                                          |
| #285            | Pixel 9 で不具合送信ボタンが押せない                                             | レイアウト / タップ領域                       |
| #286            | 「スケスケおじさん」                                                             | Android にぼかしが無く白ベタ塗り              |
| #23             | ダークモードで崩れ / 背景誤タップ多発                                            | 同上・`closeOnBackdropPress` を後付け         |
| #308            | `RestaurantReviewsTab` でレビューが出ない                                        | `pointerEvents` / 重なり                      |
| #498            | Android で OAuth 成功後も `LoginbackModal` が閉じない                            | モーダル状態が遷移と無関係                    |
| #528 → PR #1180 | オートコンプリート候補が選べない                                                 | `KeyboardAvoidingView` が子のタップを巻き添え |
| #1122           | 友達投票でモーダルを開いたまま遷移し操作不能（web/Android で再現・iOS だけ無事） | 遷移とモーダルが無関係                        |

**「操作に制限がかかった」体感の出どころは PR #1180。** #528 を直すために
「モーダル内の余白タップでキーボードが閉じる」挙動を捨て、閉じる責務を背景タップと
候補押下だけに限定した。PR 本文にも _「`BlurModal` を使う全モーダルに効く挙動変更」_ と
明記されている。**1箇所のバグを直すために全モーダルの操作性を削った**形。

---

## 6. 実装が抱える構造的な欠陥

1. **ナビゲーション履歴の外にある。** URL を持たず、Web の戻るでも閉じない。#1122 / #498 の根。
2. **キーボードを JS で二重管理。** `KeyboardAvoidingView`（Android は `behavior="height"`）＋
   `Keyboard.addListener` ＋ `KeyboardAwareForm` の `rAF` 2段 + `setTimeout(300)`。
   OS の `windowSoftInputMode` と競合する。#202 / #292 / #285 / #528 の根。
3. **Android にぼかしが無い。** `rgba(255,255,255, 0.5 + intensity*0.4/100)` の白ベタ。
   `intensity: 100` でも α=0.9 で透ける。#286 / #23 の根。
4. **重なり順が手動。** §2-D のとおり既に親子逆転がある。
5. **モーダルの意味論が無い。** `accessibilityViewIsModal` / `importantForAccessibility` /
   `aria-modal` / フォーカストラップ / Esc / 背景スクロールロック いずれも無し。
   閉じる X は**中身の位置と無関係に常に画面右上固定**。
6. **`useCallback(memo(...), deps)` でコンポーネント型を作っている。**
   - `onOpen` / `onClose` を安定参照で渡さないと毎レンダー再生成される
     （`DishCategoryGroupVoteResultScreen.tsx:108` に注意書きが残っている）
   - `useEffect(() => visible ? onOpen?.() : onClose?.(), ...)` は
     **初回マウント時に `onClose` を必ず1回発火する**（`visible === false` のため）
   - `insets` が依存配列に無く、回転で閉じるボタン位置が古くなる
7. **高さ制御が呼び出し側任せ。** `height: "90%"` / `minHeight: windowHeight` /
   `paddingVertical: 0` と場当たりの指定が散っている。

---

## 7. 「社内タスクが残るなら BlurModal は消せないのでは？」への答え

そのとおりで、G 群 11 箇所を残す限りファイルは消えない。取れる手は3つ。

| 案            | 内容                                                                                                                                                                           | 評価                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| A             | 社内タスク 11 箇所も移行して完全削除                                                                                                                                           | 一番きれいだが 11 箇所ぶんの工数がクリティカルパスに乗る |
| **B（推奨）** | **`features/contributionTasks/legacyBlurModal/` へ「凍結コピー」として移設**し、`LegacyBlurModal` へ改名。ESLint の `no-restricted-imports` で公開アプリ側からの import を禁止 | 工数を後ろ倒ししつつ、目的は達成できる                   |
| C             | 社内タスク画面ごと Web 管理画面へ追い出す                                                                                                                                      | 別スコープ。将来的には筋が良い                           |

**B を推す理由。** 撤去の目的は2つある。

1. ユーザーに見えるバグを消す
2. **共有部品が全画面を人質に取る状態をやめる**（＝ PR #1180 の再演を止める）

B は 1 を完全に満たし、2 も満たす。凍結後は利用者が社内タスクだけになるので、
そこを触っても公開アプリには波及しない。バグっても影響は社内ユーザーのみ。
「作り変えたくない・でも消せない」の答えは **"直さず、隔離して凍らせる"**。

その後 A へ進むかは、社内タスクを今後どれだけ触るか次第で判断すればよい。

---

## 8. 箇所ごとの方針

| 群             |  数 | 方針                                                                                                                                                                                                                                           |
| -------------- | --: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A 認証         |   6 | `/[locale]/auth/login` を1本作り `?next=` で復帰。4複製を1本化。OTP は同ルート内のステップ。競合告知もルート                                                                                                                                   |
| B 法務         |   3 | `/[locale]/legal/[doc]` ルート                                                                                                                                                                                                                 |
| C プロフィール |   2 | `/profile/edit` ルート。保存トピックの地点検索も専用ルート                                                                                                                                                                                     |
| D 地図・投稿   |   6 | **全部ルート。** 店詳細は既存の `/review/restaurant/[restaurantId]` へ統合（見た目を残すなら `presentation: "formSheet"`）。レビュー投稿・入札・フィードもルート。料理カテゴリ選択は投稿ルート内のステップ → 3段入れ子と手動 `zIndex` が消える |
| E カード操作   |   1 | **削除のみ**（死にコード）                                                                                                                                                                                                                     |
| F 友達投票     |   2 | 完了は**画面のインライン終端状態**へ。候補詳細はルートかインライン展開 → #1122 が構造的に再発しない                                                                                                                                            |
| G 社内タスク   |  11 | §7-B で凍結移設                                                                                                                                                                                                                                |

移行先の3プリミティブはいずれも**このリポジトリで既に本番稼働している**（§3）。新規採用ゼロ。

---

## 9. 段取り

| Phase | 内容                                                                                                | 消える数 |
| ----- | --------------------------------------------------------------------------------------------------- | -------: |
| P0    | `/auth/login`（`?next=` 復帰）と `/legal/[doc]` を用意                                              |        0 |
| P1    | A 認証 + B 法務 + E 死にコード削除                                                                  |  10 / 31 |
| P2    | F 友達投票                                                                                          |  12 / 31 |
| P3    | C プロフィール                                                                                      |  14 / 31 |
| P4    | D 地図・投稿（最難関・単独で1スプリント規模）                                                       |  20 / 31 |
| P5    | G 社内タスクを `LegacyBlurModal` へ凍結移設 + import 境界を ESLint で固定                           |  31 / 31 |
| P6    | `features/blurModal` 削除、`KeyboardAwareForm` を中立な置き場へ移設、E2E の Screen/Page Object 更新 |        — |

P1〜P3 で **14/31（45%）** が消え、再発源だった認証・投票が先に片づく。

### 付随して触る必要があるもの

- **`catalog/screens.json`** — 画面定義の唯一の情報源。ログインは現在 `review-guest-login-modal` と
  `profile-guest-login-modal` の **2 エントリ**あり、ルート化で 1 つへ統合される。`flow` セクションの
  参照も張り替えが要る。`docs/ui-catalog.md` / `docs/ui-catalog-mobile.md` は
  `catalog/generate-catalog.mjs` の生成物なので手で書き換えないこと
- `features/blurModal/components/KeyboardAwareForm.tsx` — 利用者は `ProfileEditForm` のみ
- E2E: `e2e-mobile/screens/LoginModal.ts` / `e2e-web/pages/LoginModal.ts` /
  `e2e-mobile/screens/DishCategoryGroupVoteResultScreen.ts` と3本のテストが BlurModal の描画に依存。
  **依存の中身は改訂 3 まで誤って書いていた**（訂正）:
  - 誤: 「右上の X（`Common.close`）を前提にしている」→ **どの Screen/Page Object も X を掴んでいない**
  - 正: (1) web は `getByTestId("login-modal")` を可視判定に使う (2) mobile には「ぼかし背景で iOS の
    75% 可視判定を満たせないためコンテナを観測点にできない」という **BlurModal 固有の回避策**が
    埋まっている (3) 両方とも「開いても画面は変わらない」前提で並んでいる

---

## 10. 正直な見立て

- **構造的に消えるバグ**: 戻る／履歴系（#1122・#498 型）、キーボード・IME 系
  （#202・#292・#528 型）、重なり順系（#308 型）
- **消えない／新たに出るバグ**: 遷移アニメーションのちらつき、戻り先の状態復元、
  Web の履歴スタックの深さ。**質は変わるが数はゼロにならない**
- ただし後者は各画面のローカルな問題で、31 箇所へ一斉には波及しない。
  これが「1つの完璧なモーダル」との決定的な違い

---

## 11. 実施結果（改訂 5・2026-08-19）

### 数

| 時点                | `useBlurModal` の呼び出し | 手動 `zIndex` 1100–1400 |
| ------------------- | ------------------------: | ----------------------: |
| 調査時（`9c871ee`） |     **31**（21 ファイル） |                       8 |
| 完了時              |                     **0** |                   **0** |

`app-expo/features/blurModal` はディレクトリごと削除した。残るのは社内タスク専用の
凍結コピー `features/contributionTasks/legacyBlurModal` の **1 本だけ**で、
公開アプリからは import できない（CI で機械的に落ちる。後述）。

### 何をどこへ移したか

| 群                                                     | 件数 | 行き先                                           | PR            |
| ------------------------------------------------------ | ---: | ------------------------------------------------ | ------------- |
| E 料理カードのメニュー（死にコード）                   |    1 | 削除                                             | #1360         |
| — `CreateAccountModal`（未使用）                       |    — | 削除                                             | #1360         |
| — OTP / SMS ログイン（死にコード・オーナー判断で削除） |    1 | 削除                                             | #1364         |
| F 友達の料理投票                                       |    2 | **同じ画面にインライン描画**                     | #1361         |
| A 認証                                                 |    5 | ルート `/[locale]/auth/login`（`?next=` で復帰） | #1362 / #1364 |
| A 認証（`auth/callback` の競合告知）                   |    1 | **DialogProvider の `confirm()`**                | #1371         |
| G 社内タスク                                           |   11 | `legacyBlurModal` へ凍結移設（挙動そのまま）     | #1365         |
| C プロフィール                                         |    2 | ルート `/profile/edit` ほか                      | #1373         |
| B 法務ドキュメント                                     |    3 | ルート `/[locale]/legal/[doc]`                   | #1372 / #1388 |
| D 地図・店詳細・レビュー投稿                           |    6 | ルート（下表）                                   | #1388         |
| P6 本体の撤去                                          |    — | `features/blurModal` 削除                        | #1389         |

D 群の内訳（すべて `presentation` 指定なし ＝ 既定の card）:

| 旧                                         | 新                                                          |
| ------------------------------------------ | ----------------------------------------------------------- |
| 地図の店詳細シート（z1100）                | `/[locale]/review/restaurant/[restaurantId]`（既存へ統合）  |
| レビュー投稿（z1200）                      | `.../[restaurantId]/review`（既存）                         |
| 入札（z1300）                              | ~~`.../[restaurantId]/bid`（新規）~~ → #1411 で削除（下記） |
| 料理カテゴリ選択（既定 z1100 ＝ 親より下） | `.../[restaurantId]/dish-category`（新規）                  |
| 既存メディアへの投稿                       | `.../review-from-media/[dishMediaId]`（既存）               |
| 店舗レビューのフィード                     | `.../[restaurantId]/feed`（新規）                           |

### 当初計画（§9）との差分

- **§2-D の「店詳細は TrueSheet」を撤回**した（改訂 3）。背景の地図が実際には見えておらず、
  入れ子も解けず、そもそも同じ店詳細のルート実装が既にあった。統合の結果
  `features/map/components/SelectedRestaurantDetails.tsx`（353 行）を削除し、
  **2 実装が 1 つ**になった（#1388）
- **法務 3 件は 2 回に分かれた**。`ReviewForm` の 1 件だけは、フォーム自身が portal の中に
  描かれていたため「push すると遷移先が portal の下に潜る」「先に閉じると入力と
  `mediaState`（#1127）が消える」の板挟みで #1372 では移せず、D 群（#1388）へ引き渡した。
  フォームがルートの中身になった時点で制約が両方消えている
- **P5 の import 境界は ESLint ではなく専用スクリプトで張った**。`pnpm --filter app-expo lint`
  は CI で一度も走っておらず（#1366）、かつ既存 48 errors で落ちるため lint には任せられない。
  `scripts/assert-legacy-blur-modal-boundary.mjs` を `pr-check.yml` に載せてある

### 逆戻りを防ぐ仕掛け

1. **`features/blurModal` の再出現を CI で落とす**（`assert-legacy-blur-modal-boundary.mjs`）。
   31 箇所を移し切ったから撤去できたのであって、1 箇所でも「とりあえず戻す」が入れば
   §6 の構造的欠陥へ逆戻りする
2. **凍結コピーの import は社内タスク画面の外で禁止**（同スクリプト。解決後の絶対パスで判定）
3. **各画面の「オーバーレイを 1 つも持たない」を jest で固定**（9 件）。観測点は消えた
   モジュール名ではなく `react-native-paper` の `<Portal>` そのものなので、直に `<Portal>` を
   書いても、凍結コピーを持ち込んでも赤くなる

### 残った既知の問題（別 Issue）

| Issue | 内容                                                                                                                                | 結末                                                                                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| #1366 | `app-expo` の lint が CI に無く、既存 48 errors で落ちる                                                                            | **完了**（PR #1394）。lint は `pr-check.yml` で強制されるようになった                                                             |
| #1374 | ネイティブのディープリンクで `next` が二重エンコードされる                                                                          | **完了**（PR #1393）。書く側と読む側の両方を «1 回» へ揃えた                                                                      |
| #1387 | プロフィール編集で取得失敗時にスピナーが固着する                                                                                    | **完了**（PR #1392）。フックが `hasLoadFailed` を持ち、再試行できる                                                               |
| #1404 | `ScreenHeader` の戻るが全画面共通 testID で、E2E が背面の画面を掴む                                                                 | **完了**（PR #1405 / #1407）。あわせて `(tabs)` の離脱判定を `canDismiss` へ                                                      |
| #1367 | `toInAppPath` が `/[locale]/auth/*` を落とす                                                                                        | **見送り**。アプリは `/auth/login` への外部リンクを一切生成せず、sitemap にも無い。踏むには誰かが web の URL を共有する必要がある |
| #1390 | 料理カテゴリの受け渡し箱が «前回の結果» を持ち越す                                                                                  | **見送り**。ストアは永続化されておらず、同一セッション内で `dish-category` へ直リンクする以外に箱が埋まる経路が無い               |
| —     | 法務文書の実体が ja-JP / en-US の 2 ロケールしか無く、sitemap の 32 URL のうち 24 本が英語本文の複製（`lib/seo/sitemap.ts` に記録） | 未対応（翻訳コンテンツの不在が原因でコードでは直せない）                                                                          |

### #1404 が教えてくれたこと

撤去作業で追加した E2E は **一度も CI で実行されていなかった**（`e2e-web-test.yml` は夜間と手動のみ）。
main で手動実行したところ 5 failed で、原因は 2 つとも «ルート化そのものの帰結» だった。

1. 戻るボタンの testID が全画面共通だった。オーバーレイ時代は背面が覆われていたので成立していたが、
   ルート化で push した画面と背面の画面が同時に存在するようになり、id が 2 件に当たる
2. 離脱判定の `canGoBack()` はナビゲーション状態を «親までさかのぼって» 見るため、
   `(tabs)/_layout.tsx` の `initialRouteName="search"` により直リンク着地でも true になり、
   «親へ倒す» 保険が働かず検索タブへ飛んでいた。`canDismiss()`（スタック限定）へ寄せて解決

**どちらもユニットテストでは踏めない。** ルート構成を変える PR で E2E が走らないこと自体が、
5 件が長期間気付かれなかった理由である。修正後は **117 passed / 0 failed**（run 32275954113）。

### 人手でしか確認できないこと

自動テストでは踏めない経路が 3 つ残っている。

1. **#1371 の Android 実機確認** — 認証イベント直後の `router.replace` に query 付き href を
   渡す形。`lib/logoutRedirect.ts` にフリーズの実測が残っている
   → **実施済み**。書きかけの保持（投稿フォーム → 料理カテゴリ選択 / 法務画面 → 戻る）と
   プロフィール編集の再試行（#1387）は Android 実機で確認できた
2. ~~**カスタムスキームの直リンク着地**（`nanitabeyo:///ja-JP/legal/terms`）を実機で踏む~~
   → **スキップ**。Android 実機で試したが、メモ / Google Keep / Instagram / Chrome の
   アドレスバーのいずれからも **リンクとして開けなかった**。カスタムスキームをリンク化する
   アプリがほぼ無いためで、**普通に使っていて踏める経路ではない**。
   実際に踏めるのは App Links（`https://app.nanitabeyo.net/*` / `app.config.ts` の
   `intentFilters` で `autoVerify: true`）の側で、そちらは «履歴なし着地» にはならない。
   直リンク着地から親へ倒れることの検証は E2E Web（素の `page` フィクスチャ）が持っている
3. ~~**`/legal/[doc]` の `expo export` 成果物**の確認~~
   → **確認済み**。`e2e-web-test.yml`（`eas env:pull` で本物の環境変数を用意してから
   `pnpm --filter app-expo build:web` を実行する）を main で手動実行し、
   `🏗️ Build Web App` が success であることを確認した。

> ⚠️ ローカルの `expo export` は、静的レンダリングの Node パスで `Constants.expoConfig.extra` が
> 空になり `supabaseUrl is required` で落ちる。`.env` を置いても環境変数を直接渡しても同じだった。
> 成果物の確認は CI（EAS の環境変数が入る）で行うこと。

### #1411 が教えてくれたこと（統合レビューの盲点）

#1388 の統合で、地図側の店詳細（353 行）にあった **入札ボタン / 入札タブ / 現在の入札額** を
「機能を落とさない」つもりでレビュー側へ持ち込んだ。しかし `app/[locale]/(tabs)/_layout.tsx` の
map タブは **`href: null`** でタブバーに出ない。地図側の店詳細は本番から到達不能で、
入札の導線は事実上出ていなかった。到達可能なレビュー側へ移したことで、これは
**移設ではなく復活**になり、実機のレビュー投稿画面に「入札する」が出た。決済は未実装で、
`bid.tsx` の送信は 2 秒待つだけのダミーである。

独立レビューは「地図側の機能が落ちていないか」を 353 行ぶん突き合わせた。**逆方向 —
そもそも出してはいけないものを持ち込んでいないか — は誰も見ていない。** 2 実装を 1 つへ
畳むときは、両実装の «到達可能性» が同じかを先に確かめること。片方が到達不能なら、
その機能は «落としてはいけないもの» ではなく «出してはいけないもの» かもしれない。

#1411 では入札の導線（ボタン / タブ / 現在の入札額 / `bid` ルートと E2E・カタログの参照）を
すべて削除した。`__tests__/restaurantDetailRoutes.test.tsx` と
`e2e-web/tests/my-dishes/restaurant-routes.spec.ts`（#1375 で `tests/review/` から移設）に «出ないこと» のアサーションを置いてある。

### #1419 マップタブを丸ごと削除した

#1411 / #1418 の 2 件は、どちらも **`href: null` のマップタブから «移設» したこと**が原因だった。
オーナー判断は明確で、**「到達不能 ＝ もう要らない」**である。

> そもそもマップタブはもういらないので消して良くて、それを復活させようとしているのがおかしくて、
> 単純にレビュータブの状態で、ブラーモーダルを廃止するという方針がいいと思います。

#1386 で「到達不能だから _移設_ しないと機能が落ちる」と考えたのが誤りだった。
**「レビュータブはそのままに、BlurModal だけ廃止する」が最初から正しい方針だった。**

| 消したもの                                            | 補足                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `app/[locale]/(tabs)/map.tsx`（363 行）               |                                                                             |
| `_layout.tsx` の `Tabs.Screen name="map"`             | `href: null` の指定ごと                                                     |
| `lib/seo/sitemap.ts` の `"map"`                       | **到達不能な画面を sitemap に出していた**（8 ロケール × 1 ルート ＝ 8 URL） |
| i18n の `Tabs.map` / `Tabs.labels.map`                | 8 ロケール                                                                  |
| `catalog/screens.json` の `map` ノードと 2 本のエッジ |                                                                             |
| e2e の `tab-map` 参照（web / mobile）                 | 「常に非表示であること」の検証ごと不要になった                              |
| 店舗詳細の「Google マップで開く」                     | map 側にしか無かったもの（#1414 表 B-2）                                    |

「写真・動画を投稿」の意匠も #1386 以前のレビュー側（カード内・淡色アウトライン）へ戻した。
#1386 は入札ボタンと横並びにするためカード下のアクション行へ出していた。

`app/[locale]/(tabs)/review/selectRestaurant.tsx` の «ストアへ upsert してから push する»
順序は、旧 `__tests__/mapRestaurantRoute.test.tsx` が **地図側だけ**で見ていたため、
マップタブと一緒に消えた。**到達可能なあちらは、最初から 1 度も守られていなかった。**

> 「到達不能な側にだけ検査が付いている」は #1411 / #1418 とまったく同じ形の見落としである。
> 検査を書くときは «その画面が本番から到達できるか» を先に確かめること。

#1451 で `__tests__/selectRestaurantRoute.test.tsx` を新設し、**4 経路すべて**
（Place 作成 / マーカー押下 / カード押下 / 投稿ボタン）を `["upsert", "push"]` という
**呼び出し順の列**で固定した。変異テストで 5 種類すべてが赤くなることを実測してある。

⚠️ アサーションを «push されたこと» に置かないこと。それだと順序を入れ替えても緑のままになる
（それが今まさに無防備だった形）。

### 孤児化した i18n キーの片付け（#1451）

撤去で参照が 0 件になったキーを 8 ロケールから消した（521 キーへ）。
**コード参照が実際に 0 件であることを 1 件ずつ実測してから**消している。

| 消したキー                                                               | 出どころ                                 |
| ------------------------------------------------------------------------ | ---------------------------------------- |
| `DishMediaContent.menuOptions.*`                                         | #1357 到達不能だった料理カードのメニュー |
| `auth.field_phone` / `hint_sms` / `otp_*` / `error_invalid_phone`        | #1359 削除した電話番号 / SMS ログイン    |
| `Map.buttons.placeBid` / `Map.tabs.bids` / `Map.labels.currentBidAmount` | #1411 落とした入札の «導線» 3 つ         |

**残したもの**: `Map.buttons.openInGoogle`（`DishMediaMap` がまだ使う）、
`Review.everybodyPostsTitle`（#1418 で復活）、入札 _そのもの_ の文言
（`RestaurantBidsTab` / `BidForm` がコードとして残っており決済実装時に使う）。

> ⚠️ 「`i18n.t("<key>")` の grep が 0 件」だけで消さないこと。この repo には
> `i18n.t(option.label)` のような **動的参照**が検索画面に多数ある。
> 実際、機械的に数えると «直接参照が無いキー» は 197 件出るが、そのほとんどは生きている。
