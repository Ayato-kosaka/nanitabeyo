# BlurModal 影響調査と撤去方針

対象: `app-expo/features/blurModal/hooks/useBlurModal.tsx`
調査日: 2026-08-15 / 対象コミット: `9c871ee`

> **改訂 2**: 初版はファイル数を 20 と誤記していた（正: **21**）。また `useBlurModal` の
> grep 1 本だけで「全部」としていたため、**BlurModal 以外のオーバーレイ機構**（RN `<Modal>` /
> TrueSheet / `showDialog` / ActionSheet / `transparentModal` ルート / 自前フルスクリーン層）を
> 数えていなかった。§2 を機械的に再集計し、§3 に全機構のマップを追加。§4 に死にコード 2 件を追記。

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

| ファイル | 数 |
| --- | ---: |
| `app/[locale]/(tabs)/map.tsx` | 1 |
| `app/[locale]/(tabs)/profile/settings.tsx` | 1 |
| `app/[locale]/(tabs)/review/index.tsx` | 1 |
| `app/[locale]/auth/callback.tsx` | 1 |
| `app/[locale]/contribution-tasks/dish-category-image-optimizer.tsx` | 1 |
| `app/[locale]/contribution-tasks/dish-category-image-review.tsx` | 1 |
| `app/[locale]/contribution-tasks/dish-category-manual-image-supply.tsx` | 2 |
| `app/[locale]/contribution-tasks/dish-category-manual-text-supply.tsx` | 2 |
| `app/[locale]/contribution-tasks/dish-copy-survey.tsx` | 1 |
| `app/[locale]/contribution-tasks/dish-ranking-summary.tsx` | 4 |
| `features/dishCategoryGroupVotes/components/DishCategoryGroupVoteResultScreen.tsx` | 1 |
| `features/dishCategoryGroupVotes/components/DishCategoryGroupVoteVoteScreen.tsx` | 1 |
| `features/dishMedia/components/ActionButtons.tsx` | 1 |
| `features/map/components/FeedDishMediaViewer.tsx` | 1 |
| `features/map/components/ReviewForm.tsx` | 2 |
| `features/map/components/SelectedRestaurantDetails.tsx` | 3 |
| `features/map/components/tabs/RestaurantReviewsTab.tsx` | 1 |
| `features/profile/components/LoginbackModal.tsx` | 2 |
| `features/profile/containers/ProfileTabsLayout.tsx` | 2 |
| `features/profile/tabs/SavedTopicsTab.tsx` | 1 |
| `features/review/components/SelectedRestaurantDetails.tsx` | 1 |
| **合計** | **31** |

### 用途別の内訳（31 = 6+3+2+6+1+2+11）

#### A. 認証（6）

| 場所 | モーダル | 中身 |
| --- | --- | --- |
| `features/profile/containers/ProfileTabsLayout.tsx:44` | `LoginModal` | `LoginbackModal` |
| `features/map/components/SelectedRestaurantDetails.tsx:68` | `LoginBlurModal` (z1400) | `LoginbackModal` |
| `features/review/components/SelectedRestaurantDetails.tsx:63` | `LoginBlurModal` (z1400) | `LoginbackModal` |
| `app/[locale]/(tabs)/review/index.tsx:26` | `LoginBlurModal` (z1400) | `LoginbackModal` |
| `features/profile/components/LoginbackModal.tsx:33` | `OtpModalComponent` | `OtpModal`（TextInput） |
| `app/[locale]/auth/callback.tsx:51` | `ConflictModal` | プロバイダ競合の告知 |

上4件は**同じログイン UI の複製**。`/auth/login` 1本に集約すれば 4 → 1。

**レビュータブ（`(tabs)/review/*`）で BlurModal を使っているのはこの2件だけで、どちらも
ログイン。** つまりレビュータブ側は独自の改修不要で、認証のルート化に巻き取られて消える。
（同タブの `SavedRestaurantsSheet` は既に TrueSheet で BlurModal ではない）

#### B. 法務ドキュメント（3）

`LoginbackModal.tsx:35` / `settings.tsx:88` / `ReviewForm.tsx:232` の `LegalDocumentModal`。

#### C. プロフィール（2）

| 場所 | モーダル | 中身 |
| --- | --- | --- |
| `ProfileTabsLayout.tsx:43` | `ProfileEditModal` | `ProfileEditForm`（`KeyboardAwareForm` + TextInput 複数） |
| `SavedTopicsTab.tsx:60` | `LocationModal` | `LocationSearchForm`（**保存した料理＝トピックから地点で検索するやつ**。オートコンプリート + キーボード） |

#### D. 地図・店詳細・レビュー投稿（6）

| 場所 | モーダル | 中身 |
| --- | --- | --- |
| `map.tsx:46` | `RestaurantBlurModal` (z1100, `height: "90%"`) | `SelectedRestaurantDetails` |
| `map/SelectedRestaurantDetails.tsx:58` | `ReviewBlurModal` (z1200) | `ReviewForm` |
| `map/SelectedRestaurantDetails.tsx:63` | `BidBlurModal` (z1300) | 入札 |
| `ReviewForm.tsx:222` | `DishCategoryModal` (**既定 z1100**) | `DishCategorySearchForm` |
| `FeedDishMediaViewer.tsx:23` | `ReviewFormModal` | `ReviewForm` |
| `RestaurantReviewsTab.tsx:33` | `DishMediaModal` (既定 z1100, `paddingVertical: 0`) | フィード全画面 |

**最大3段の入れ子。しかも親子で zIndex が逆転している:**

```
map.tsx  RestaurantBlurModal (z1100)
  └ SelectedRestaurantDetails  ReviewBlurModal (z1200)
      └ ReviewForm  DishCategoryModal (z1100 ← 親より下)
```

#### E. 料理カードのメニュー（1）— **到達不能な死にコード**

`features/dishMedia/components/ActionButtons.tsx:89`。

- 開く関数 `handleMenuOpen`（266行）は **定義のみで参照ゼロ**
- 唯一の起動ボタンは 412–417 行で **コメントアウト済み**

つまり**このモーダルは UI から開けない**。ActionSheet への載せ替えは不要で、
`BlurModal` ごと `menuOptions` / `handleMenuOpen` / `styles.menuContainer` を削除するだけ。

#### F. 友達の料理投票（2）

| 場所 | モーダル | 備考 |
| --- | --- | --- |
| `DishCategoryGroupVoteVoteScreen.tsx:43` | `CompletionBlurModal` | `showCloseButton: false` / `closeOnBackdropPress: false` / `minHeight: windowHeight` |
| `DishCategoryGroupVoteResultScreen.tsx:106` | `CandidateDetailBlurModal` | `minHeight: windowHeight`、#1122 の当事者 |

前者は「閉じるボタンなし・背景タップ無効・全画面」＝**既に実質は画面**。

#### G. コントリビューションタスク（11・社内向け）

`dish-ranking-summary` 4 / `manual-image-supply` 2 / `manual-text-supply` 2 /
`dish-copy-survey` 1 / `image-optimizer` 1 / `image-review` 1。

---

## 3. BlurModal 以外のオーバーレイ機構（初版で数えていなかったぶん）

「あとで漏れが出る」を防ぐため、画面の上に何かを重ねる手段を全部並べる。

| 機構 | 箇所 | 場所 |
| --- | ---: | --- |
| `useBlurModal` | 31 | §2 |
| react-native `<Modal>` | 3 | `contribution-tasks/dish-copy-survey.tsx:445`（ヘルプ）/ `features/topics/components/TopicsSpotlightTutorial.tsx:645` / `features/map/components/InitialMediaPreview.tsx:91`（動画） |
| `@lodev09/react-native-true-sheet` | 2 | `features/review/components/SavedRestaurantsSheet.tsx:271` / `features/search/components/TutorialBottomSheet.tsx:251` |
| `DialogProvider` の `showDialog` | 7 | `hooks/useAPICall.ts:308,330` / `settings.tsx:221` / `blocked-topics.tsx:176` / `search/topics.tsx:663` / **`features/topics/hooks/useBlockTopic.ts:64`（トピックのブロック）** / `useGoogleMapsFallback.ts:51` |
| `@expo/react-native-action-sheet` | 1 | `features/dishMedia/components/DishMediaMap.tsx:277` |
| `presentation: "transparentModal"` ルート | 1 | `app/[locale]/(tabs)/search/_layout.tsx:14`（`result`） |
| 自前フルスクリーン層（`absoluteFill` + `zIndex: 9999`） | 2 | `profile/search-results.tsx:67` / `search/result.tsx:202` |
| 固定バナー（`zIndex: 1000`） | 1 | `components/deepLinking/OpenInAppBanner.tsx:356` |

**トピックのブロック確認は `showDialog`（react-native-paper の `Dialog`）であって BlurModal
ではない。** よってこの撤去の影響を受けず、そのままで完了。

---

## 4. 死にコード（撤去のついでに消せるもの）

| 対象 | 状態 |
| --- | --- |
| `features/dishMedia/components/ActionButtons.tsx` のメニュー | 起動ボタンがコメントアウト、`handleMenuOpen` の参照ゼロ → **開けない** |
| `features/profile/components/CreateAccountModal.tsx` | **import している箇所がゼロ** |

---

## 5. これまでのバグ

| Issue | 内容 | 根っこ |
| --- | --- | --- |
| #202 | iOS 実機 Feedback 入力欄で日本語が1文字ずつ切れる | キーボード自前管理 |
| #292 | `HideTopicBlurModal` で IME が1文字ずつ確定 | 同上 |
| #285 | Pixel 9 で不具合送信ボタンが押せない | レイアウト / タップ領域 |
| #286 | 「スケスケおじさん」 | Android にぼかしが無く白ベタ塗り |
| #23 | ダークモードで崩れ / 背景誤タップ多発 | 同上・`closeOnBackdropPress` を後付け |
| #308 | `RestaurantReviewsTab` でレビューが出ない | `pointerEvents` / 重なり |
| #498 | Android で OAuth 成功後も `LoginbackModal` が閉じない | モーダル状態が遷移と無関係 |
| #528 → PR #1180 | オートコンプリート候補が選べない | `KeyboardAvoidingView` が子のタップを巻き添え |
| #1122 | 友達投票でモーダルを開いたまま遷移し操作不能（web/Android で再現・iOS だけ無事） | 遷移とモーダルが無関係 |

**「操作に制限がかかった」体感の出どころは PR #1180。** #528 を直すために
「モーダル内の余白タップでキーボードが閉じる」挙動を捨て、閉じる責務を背景タップと
候補押下だけに限定した。PR 本文にも *「`BlurModal` を使う全モーダルに効く挙動変更」* と
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

| 案 | 内容 | 評価 |
| --- | --- | --- |
| A | 社内タスク 11 箇所も移行して完全削除 | 一番きれいだが 11 箇所ぶんの工数がクリティカルパスに乗る |
| **B（推奨）** | **`features/contributionTasks/legacyBlurModal/` へ「凍結コピー」として移設**し、`LegacyBlurModal` へ改名。ESLint の `no-restricted-imports` で公開アプリ側からの import を禁止 | 工数を後ろ倒ししつつ、目的は達成できる |
| C | 社内タスク画面ごと Web 管理画面へ追い出す | 別スコープ。将来的には筋が良い |

**B を推す理由。** 撤去の目的は2つある。

1. ユーザーに見えるバグを消す
2. **共有部品が全画面を人質に取る状態をやめる**（＝ PR #1180 の再演を止める）

B は 1 を完全に満たし、2 も満たす。凍結後は利用者が社内タスクだけになるので、
そこを触っても公開アプリには波及しない。バグっても影響は社内ユーザーのみ。
「作り変えたくない・でも消せない」の答えは **"直さず、隔離して凍らせる"**。

その後 A へ進むかは、社内タスクを今後どれだけ触るか次第で判断すればよい。

---

## 8. 箇所ごとの方針

| 群 | 数 | 方針 |
| --- | ---: | --- |
| A 認証 | 6 | `/[locale]/auth/login` を1本作り `?next=` で復帰。4複製を1本化。OTP は同ルート内のステップ。競合告知もルート |
| B 法務 | 3 | `/[locale]/legal/[doc]` ルート |
| C プロフィール | 2 | `/profile/edit` ルート。保存トピックの地点検索も専用ルート |
| D 地図・投稿 | 6 | 店詳細は **TrueSheet**（地図を見せたいので）。レビュー投稿・入札・フィードは**ルート**。料理カテゴリ選択は投稿ルート内のステップ → 3段入れ子と手動 `zIndex` が消える |
| E カード操作 | 1 | **削除のみ**（死にコード） |
| F 友達投票 | 2 | 完了は**画面のインライン終端状態**へ。候補詳細はルートかインライン展開 → #1122 が構造的に再発しない |
| G 社内タスク | 11 | §7-B で凍結移設 |

移行先の3プリミティブはいずれも**このリポジトリで既に本番稼働している**（§3）。新規採用ゼロ。

---

## 9. 段取り

| Phase | 内容 | 消える数 |
| --- | --- | ---: |
| P0 | `/auth/login`（`?next=` 復帰）と `/legal/[doc]` を用意 | 0 |
| P1 | A 認証 + B 法務 + E 死にコード削除 | 10 / 31 |
| P2 | F 友達投票 | 12 / 31 |
| P3 | C プロフィール | 14 / 31 |
| P4 | D 地図・投稿（最難関・単独で1スプリント規模） | 20 / 31 |
| P5 | G 社内タスクを `LegacyBlurModal` へ凍結移設 + import 境界を ESLint で固定 | 31 / 31 |
| P6 | `features/blurModal` 削除、`KeyboardAwareForm` を中立な置き場へ移設、E2E の Screen/Page Object 更新 | — |

P1〜P3 で **14/31（45%）** が消え、再発源だった認証・投票が先に片づく。

### 付随して触る必要があるもの

- `features/blurModal/components/KeyboardAwareForm.tsx` — 利用者は `ProfileEditForm` のみ
- E2E: `e2e-mobile/screens/LoginModal.ts` / `e2e-web/pages/LoginModal.ts` /
  `e2e-mobile/screens/DishCategoryGroupVoteResultScreen.ts` と3本のテストが
  BlurModal の描画前提（paper の `Portal`、右上 X = `Common.close`）に依存

---

## 10. 正直な見立て

- **構造的に消えるバグ**: 戻る／履歴系（#1122・#498 型）、キーボード・IME 系
  （#202・#292・#528 型）、重なり順系（#308 型）
- **消えない／新たに出るバグ**: 遷移アニメーションのちらつき、戻り先の状態復元、
  Web の履歴スタックの深さ。**質は変わるが数はゼロにならない**
- ただし後者は各画面のローカルな問題で、31 箇所へ一斉には波及しない。
  これが「1つの完璧なモーダル」との決定的な違い
