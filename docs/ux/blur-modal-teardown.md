# BlurModal 影響調査と撤去方針

対象: `app-expo/features/blurModal/hooks/useBlurModal.tsx`
調査日: 2026-08-15 / 対象コミット: `9c871ee`

## 1. 結論（先に）

**「全方位ベストプラクティスなモーダルを作り直せば確実にバグが消える」とは言えない。**

理由は、これまでのバグが「良い設計の実装ミス」ではなく **仕組みそのものの帰結** だから。
`useBlurModal` は「アプリのツリーの中に絶対配置のレイヤを重ねる」実装で、次の4つを
**すべて自前で持っていない**：

1. ナビゲーション履歴との関係（戻る・URL・ディープリンク）
2. キーボードとウィンドウの調停（OS が本来やる仕事の再実装）
3. 重なり順の管理（呼び出し側の手動 `zIndex`）
4. アクセシビリティのモーダル意味論（フォーカストラップ / 背景の読み上げ抑止 / Esc）

これを「完璧に」実装し直すということは、**iOS / Android / Web（react-native-web）の3面ぶん
の OS 挙動差を自前で持ち続ける**という意味になる。実際 #1122 は「iOS だけ無事」だった。
1つの完璧なモーダルを3面で維持するコストは、**モーダルの母数を減らす**コストより高い。

したがって推奨は:

> **`useBlurModal` を撤去する。31 箇所を「ルート遷移 / 既存シート / 既存ダイアログ」の
> 3プリミティブへ振り分ける。ぼかし背景は "見た目" として必要な画面にだけ残す。**

3プリミティブはいずれも **このリポジトリで既に本番稼働している**（後述 §5）。新規採用ゼロ。

前例もある: #951 でフィードバックは BlurModal をやめ専用画面 `profile/feedback` へ移した。
`app/[locale]/(tabs)/profile/settings.tsx:82` にその設計判断のコメントが残っている。

---

## 2. 使用箇所の全洗い出し（20 ファイル / 31 インスタンス）

### A. 認証（6）

| # | 場所 | モーダル名 | 中身 |
| --- | --- | --- | --- |
| 1 | `features/profile/containers/ProfileTabsLayout.tsx:44` | `LoginModal` | `LoginbackModal` |
| 2 | `features/map/components/SelectedRestaurantDetails.tsx:68` | `LoginBlurModal` (z1400) | `LoginbackModal` |
| 3 | `features/review/components/SelectedRestaurantDetails.tsx:63` | `LoginBlurModal` (z1400) | `LoginbackModal` |
| 4 | `app/[locale]/(tabs)/review/index.tsx:26` | `LoginBlurModal` (z1400) | `LoginbackModal` |
| 5 | `features/profile/components/LoginbackModal.tsx:33` | `OtpModalComponent` | 電話 OTP 入力（TextInput） |
| 6 | `app/[locale]/auth/callback.tsx:51` | `ConflictModal` | プロバイダ競合の告知 |

1〜4 は **同じログイン UI を 4 箇所で複製している**。ここだけで 4 インスタンス減らせる。

### B. 法務ドキュメント（3）

| # | 場所 | モーダル名 |
| --- | --- | --- |
| 7 | `features/profile/components/LoginbackModal.tsx:35` | `LegalDocumentModal` |
| 8 | `app/[locale]/(tabs)/profile/settings.tsx:88` | `LegalDocumentModal` |
| 9 | `features/map/components/ReviewForm.tsx:232` | `LegalDocumentModal` |

### C. プロフィール（2）

| # | 場所 | モーダル名 | 中身 |
| --- | --- | --- | --- |
| 10 | `features/profile/containers/ProfileTabsLayout.tsx:43` | `ProfileEditModal` | `ProfileEditForm`（`KeyboardAwareForm` + TextInput 複数） |
| 11 | `features/profile/tabs/SavedTopicsTab.tsx:60` | `LocationModal` | `LocationSearchForm`（オートコンプリート + キーボード） |

### D. 地図・店詳細・レビュー投稿（6）

| # | 場所 | モーダル名 | 中身 |
| --- | --- | --- | --- |
| 12 | `app/[locale]/(tabs)/map.tsx:46` | `RestaurantBlurModal` (z1100, `height: "90%"`) | `SelectedRestaurantDetails` |
| 13 | `features/map/components/SelectedRestaurantDetails.tsx:58` | `ReviewBlurModal` (z1200) | `ReviewForm` |
| 14 | `features/map/components/SelectedRestaurantDetails.tsx:63` | `BidBlurModal` (z1300) | 入札 |
| 15 | `features/map/components/ReviewForm.tsx:222` | `DishCategoryModal` (**既定 z1100**) | `DishCategorySearchForm`（オートコンプリート + キーボード） |
| 16 | `features/map/components/FeedDishMediaViewer.tsx:23` | `ReviewFormModal` | `ReviewForm` |
| 17 | `features/map/components/tabs/RestaurantReviewsTab.tsx:33` | `DishMediaModal` (既定 z1100, `paddingVertical: 0`) | フィード全画面 |

**ここが最難関。最大3段の入れ子になっている:**

```
map.tsx  RestaurantBlurModal (z1100)
  └ SelectedRestaurantDetails  ReviewBlurModal (z1200)
      └ ReviewForm  DishCategoryModal (z1100 ← 親より下)
```

料理カテゴリ選択（15）は親（13）より **小さい zIndex** を持つ。同じ Portal ホスト配下の
同一スタッキング文脈なので、順序が不定というより **構造的に下に潜りうる**。
17 も既定 1100 で、親の 12 と同値。

### E. 料理カード操作（1）

| # | 場所 | モーダル名 | 備考 |
| --- | --- | --- | --- |
| 18 | `features/dishMedia/components/ActionButtons.tsx:89` | メニュー | 唯一 `closeOnBackdropPress: true` |

### F. 友達の料理投票（2）

| # | 場所 | モーダル名 | 備考 |
| --- | --- | --- | --- |
| 19 | `.../DishCategoryGroupVoteVoteScreen.tsx:43` | `CompletionBlurModal` | `showCloseButton: false` / `closeOnBackdropPress: false` / `minHeight: windowHeight` |
| 20 | `.../DishCategoryGroupVoteResultScreen.tsx:106` | `CandidateDetailBlurModal` | `minHeight: windowHeight` |

19 は「閉じられない・全画面・閉じるボタンなし」＝ **もはや画面**。モーダルである必要がない。
20 は #1122（モーダルを開いたまま遷移して操作不能）の当事者。

### G. コントリビューションタスク（11・社内向け）

| # | 場所 | 数 |
| --- | --- | --- |
| 21 | `contribution-tasks/dish-ranking-summary.tsx` | 4（Summary / Dish / ConditionPicker / Help） |
| 25 | `contribution-tasks/dish-category-manual-image-supply.tsx` | 2（tutorial / detail） |
| 27 | `contribution-tasks/dish-category-manual-text-supply.tsx` | 2（tutorial / edit） |
| 29 | `contribution-tasks/dish-copy-survey.tsx` | 1 |
| 30 | `contribution-tasks/dish-category-image-optimizer.tsx` | 1 |
| 31 | `contribution-tasks/dish-category-image-review.tsx` | 1 |

社内タスク画面。ユーザー影響が無いので **移行は最後でよい**。

### その他の依存

- `features/blurModal/components/KeyboardAwareForm.tsx` — `blurModal` 配下にあるが
  使っているのは `ProfileEditForm` のみ。feature 削除時は中立な置き場へ移すこと。
- E2E: `e2e-mobile/screens/LoginModal.ts` / `e2e-web/pages/LoginModal.ts` /
  `e2e-mobile/screens/DishCategoryGroupVoteResultScreen.ts` と 3 本のテストが
  BlurModal の描画前提（paper の `Portal`、右上 X = `Common.close`）に依存している。

---

## 3. これまでのバグ（"バグが多い" の実体）

| Issue | 内容 | 根っこ |
| --- | --- | --- |
| #202 | iOS 実機 Feedback 入力欄で日本語が1文字ずつ切れる | キーボード自前管理 |
| #292 | `HideTopicBlurModal` で IME が1文字ずつ確定 | 同上（render-prop 化で対処） |
| #285 | Pixel 9 で不具合送信ボタンが押せない | レイアウト/タップ領域 |
| #286 | 「スケスケおじさん」 | Android にぼかしが無く白ベタ塗り |
| #23 | ダークモードでレイアウト崩れ / 背景誤タップ多発 | 同上・`closeOnBackdropPress` を後付け |
| #308 | `RestaurantReviewsTab` でレビューが表示されない | `pointerEvents` / 重なり |
| #498 | Android で OAuth 成功後も `LoginbackModal` が閉じない | モーダル状態が遷移と無関係 |
| #528 → PR #1180 | オートコンプリート候補が選べない（初回起動） | `KeyboardAvoidingView` の `onStartShouldSetResponder` が子のタップを巻き添え |
| #1122 | 友達投票でモーダルを開いたまま遷移し操作不能（web/Android で再現・**iOS だけ無事**） | 遷移とモーダルが無関係 |

「一部制限がかかっている」という体感の出どころは **PR #1180**。#528 を直すために
「モーダル内の余白タップでキーボードが閉じる」挙動を捨て、閉じる責務を背景タップと
候補押下だけに限定した。PR 本文にも *「`BlurModal` を使う全モーダルに効く挙動変更」* と
明記されている。つまり **1 箇所のバグを直すために全モーダルの操作性を削った**。
共有コンポーネントに OS の仕事を持たせている限り、この形のトレードオフは繰り返す。

---

## 4. 実装が抱える構造的な欠陥（コードから）

1. **ナビゲーション履歴の外にある。** 状態はコンポーネントローカル。URL を持たず、
   Web の戻るでも閉じず、共有もディープリンクもできない。#1122 / #498 の根。
2. **キーボードを JS で二重管理。** `KeyboardAvoidingView`（Android は `behavior="height"`）＋
   `Keyboard.addListener` ＋ `KeyboardAwareForm` 内の `rAF` 2段 + `setTimeout(300)`。
   OS の `windowSoftInputMode` と競合する。#202 / #292 / #285 / #528 の根。
3. **Android にぼかしが無い。** `rgba(255,255,255, 0.5 + intensity*0.4/100)` の白ベタ。
   `intensity: 100` でも α=0.9 で透ける。#286 / #23 の根。
4. **重なり順が手動。** `zIndex` 1100〜1400 を呼び出し側が渡す。§2-D のとおり
   既に親子逆転が入っている。
5. **モーダルの意味論が無い。** `accessibilityViewIsModal`（iOS）も
   `importantForAccessibility="no-hide-descendants"`（Android）も `aria-modal` も無し。
   フォーカストラップ・Esc・背景スクロールロックも無い。閉じる X は
   **中身の位置と無関係に常に画面右上固定**。
6. **`useCallback(memo(...), deps)` でコンポーネント型を作っている。**
   - 依存が変わるたびに型が変わり、中身が丸ごと再マウントされる。
   - `onOpen` / `onClose` を安定参照で渡さないと毎レンダー再生成される
     （`DishCategoryGroupVoteResultScreen.tsx:108` にその注意書きが残っている）。
   - `useEffect(() => visible ? onOpen?.() : onClose?.(), ...)` は
     **初回マウント時に `onClose` を必ず1回発火する**（`visible === false` のため）。
   - `insets` が依存配列に無く、回転／セーフエリア変化で閉じるボタン位置が古くなる。
7. **高さ制御が呼び出し側任せ。** `height: "90%"` / `minHeight: windowHeight` /
   `paddingVertical: 0` と場当たりの指定が散っている。中身がはみ出しても
   スクロールしない（各呼び出し側が自前で `ScrollView` を置く前提）。

---

## 5. 移行先（すべて既存・新規採用ゼロ）

| プリミティブ | 既存の実績 | 使いどころ |
| --- | --- | --- |
| **expo-router のルート** | `profile/feedback`（#951 で BlurModal から移行済） / `search/_layout.tsx` は `presentation: "transparentModal"` を使用中 | 入力を伴うもの、共有・復帰したいもの、フローの一段 |
| **`@lodev09/react-native-true-sheet`** | `features/review/components/SavedRestaurantsSheet.tsx`（本番稼働） | 背景を見せたまま出す一時的なパネル |
| **`DialogProvider` / `@expo/react-native-action-sheet`** | `contexts/DialogProvider.tsx`、`features/topics/hooks/useBlockTopic.ts` | 確認・短いメニュー |

ぼかしの見た目が要る画面は、遷移先ルートの中で `BlurView` を敷けばよい。
**ぼかしは見た目であって、仕組みではない。**

---

## 6. 箇所ごとの方針（案）

| 群 | 方針 | UX の変化 |
| --- | --- | --- |
| A 認証（6） | `/[locale]/auth/login` を1本作り、`?next=` で復帰。4 箇所の複製を1本化。OTP は同ルート内のステップ。#6 の競合告知もルートへ | 戻るで確実に戻れる。ログイン URL を共有・復帰できる。IME 問題が構造的に消える |
| B 法務（3） | `/[locale]/legal/[doc]` ルート | 規約を URL で指せる。SEO 的にも有利 |
| C プロフィール（2） | プロフィール編集は `/profile/edit` ルート。保存地点の地点検索も専用ルート | 入力途中で戻る操作が期待どおりになる |
| D 地図・投稿（6） | 店詳細（12）は **TrueSheet**（地図を見せたまま出したいので）。レビュー投稿（13/16）と入札（14）は **ルート**。料理カテゴリ選択（15）は投稿ルート内のステップ画面。フィード（17）はルート | 3段入れ子が消える。`zIndex` の手動管理が不要になる |
| E カード操作（1） | **ActionSheet**（OS ネイティブ） | プラットフォーム標準の見た目になる |
| F 友達投票（2） | 完了（19）は **画面のインライン終端状態**（そもそも閉じられない全画面なのでモーダルである必要がない）。候補詳細（20）はルートかインライン展開 | #1122 が構造的に再発しなくなる |
| G 社内タスク（11） | 最後にまとめて。ルート or TrueSheet | 社内のみ |

### 要確認（1点）

「**料理提案のブロックはモーダルのままにしたい**」の指すものが確定できませんでした。
候補が2つあり、対応が変わります。

- (a) 料理カードの「…」メニュー = `features/dishMedia/components/ActionButtons.tsx:89`
  → BlurModal 使用中。**残すなら TrueSheet か ActionSheet へ載せ替え**（見た目は近い）。
- (b) トピックのブロック確認 = `features/topics/hooks/useBlockTopic.ts:64` の `showDialog`
  → **これは元々 BlurModal ではない**（`DialogProvider`）。この撤去の影響を受けない。

(b) であれば「そのまま」で完了です。

---

## 7. 段取り（案）

| Phase | 内容 | 消える数 |
| --- | --- | --- |
| P0 | `/auth/login`（`?next=` 復帰）と `/legal/[doc]` のルートを用意 | 0 |
| P1 | A 認証 + B 法務 を撤去 | 9 / 31 |
| P2 | F 友達投票 をインライン化・ルート化 | 11 / 31 |
| P3 | C プロフィール + E カード操作 | 14 / 31 |
| P4 | D 地図・投稿（3段入れ子の解消込み・最難関） | 20 / 31 |
| P5 | G 社内タスク | 31 / 31 |
| P6 | `features/blurModal` 削除、`KeyboardAwareForm` を移設、E2E の Screen/Page Object 更新 | — |

P1〜P3 だけで **14/31（45%）** が消え、しかも過去バグの再発源（認証・投票）が先に片づく。
P4 は単独で1スプリント規模を見ておく。

## 8. 正直な見立て

- **消えることが保証できるバグ**: 戻る／履歴系（#1122・#498 型）、キーボード・IME 系
  （#202・#292・#528 型）、重なり順系（#308 型）。OS かルータが責務を持つため。
- **消えない／新たに出るバグ**: 画面遷移が増えることによる遷移アニメーションのちらつき、
  戻り先の状態復元、Web の履歴スタックの深さ。**質は変わるが数はゼロにならない。**
- ただし後者は **各画面のローカルな問題** で、31 箇所へ一斉に波及しない。
  これが「1つの完璧なモーダル」との決定的な違い。
