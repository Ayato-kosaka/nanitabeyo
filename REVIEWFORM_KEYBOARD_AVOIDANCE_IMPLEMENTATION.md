# ReviewForm キーボード回避・行UI整備・i18n 追加 実装ドキュメント

## 概要

`app-expo/features/map/components/ReviewForm.tsx` に以下の改善を実装しました。

## 実装内容

### 1. i18n 追加

全8言語のロケールファイルに新しいキー `Map.actions.selectDishCategory` を追加しました。

#### 追加された翻訳

| 言語 | キー | 翻訳 |
|-----|-----|-----|
| ar-SA | Map.actions.selectDishCategory | اختر فئة الطبق |
| en-US | Map.actions.selectDishCategory | Select dish category |
| es-ES | Map.actions.selectDishCategory | Seleccionar categoría de plato |
| fr-FR | Map.actions.selectDishCategory | Sélectionner la catégorie du plat |
| hi-IN | Map.actions.selectDishCategory | डिश श्रेणी चुनें |
| ja-JP | Map.actions.selectDishCategory | 料理カテゴリを選択 |
| ko-KR | Map.actions.selectDishCategory | 요리 카테고리 선택 |
| zh-CN | Map.actions.selectDishCategory | 选择菜品类别 |

### 2. レビュー入力（キーボード回避）

#### KeyboardAvoidingView の導入

```tsx
<KeyboardAvoidingView
  behavior={Platform.OS === "ios" ? "padding" : "height"}
  style={{ flex: 1 }}
  keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}>
```

- iOS では `behavior="padding"` を使用
- Android では `behavior="height"` を使用
- `keyboardVerticalOffset` は両プラットフォームで 0 に設定

#### InitialMediaPreview の高さアニメーション

```tsx
const mediaHeightAnim = useRef(new Animated.Value(320)).current;

useEffect(() => {
  const keyboardShowListener = Keyboard.addListener(
    Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
    () => {
      setIsKeyboardVisible(true);
      Animated.timing(mediaHeightAnim, {
        toValue: 180, // Reduced height
        duration: 250,
        useNativeDriver: false,
      }).start();
    }
  );
  
  const keyboardHideListener = Keyboard.addListener(
    Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
    () => {
      setIsKeyboardVisible(false);
      Animated.timing(mediaHeightAnim, {
        toValue: 320, // Original height
        duration: 250,
        useNativeDriver: false,
      }).start();
    }
  );
  
  return () => {
    keyboardShowListener.remove();
    keyboardHideListener.remove();
  };
}, [mediaHeightAnim]);
```

**動作**：
- キーボード表示時：InitialMediaPreview の高さが 320 → 180 にアニメーション（250ms）
- キーボード非表示時：高さが 180 → 320 にアニメーション（250ms）
- iOS では `keyboardWillShow/Hide`、Android では `keyboardDidShow/Hide` を使用

### 3. 料理カテゴリ 行（Pressable 行タップ UI 化）

```tsx
<Pressable
  style={styles.selectRow}
  onPress={openDishCategoryModal}
  accessibilityRole="button"
  accessibilityLabel={i18n.t("Map.actions.selectDishCategory")}>
  <Text style={styles.selectRowText}>
    {dishCategoryName || i18n.t("Map.actions.selectDishCategory")}
  </Text>
  <ChevronRight size={20} color="#666" />
</Pressable>
```

**スタイル**：
```tsx
selectRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  minHeight: 48,
  paddingHorizontal: 12,
  paddingVertical: 12,
  borderRadius: 8,
  backgroundColor: "#F8F9FA",
}
```

**機能**：
- 行全体がタップ可能
- 右端に ChevronRight アイコン（lucide-react-native）を表示
- タップで useBlurModal を開く
- アクセシビリティロール "button" を設定

#### useBlurModal 統合

```tsx
const {
  BlurModal,
  open: openDishCategoryModal,
  close: closeDishCategoryModal,
} = useBlurModal({
  keyboardVerticalOffset: Platform.OS === "ios" ? 0 : 0,
  dismissKeyboardFirst: true,
});
```

```tsx
<BlurModal contentContainerStyle={styles.modalContent}>
  <View style={styles.autocompleteContainer}>
    <DishCategoryAutocomplete
      value={dishCategoryName}
      onChangeText={setDishCategoryName}
      onSelectSuggestion={handleDishCategorySelect}
      onClear={handleDishCategoryClear}
      placeholder={i18n.t("Map.placeholders.enterDishCategory")}
      autofocus={true}
    />
  </View>
</BlurModal>
```

**動作**：
- モーダルが開くと DishCategoryAutocomplete が自動フォーカス（`autofocus={true}`）
- キーボードが自動的に表示される
- 候補選択時に `handleDishCategorySelect` が呼ばれ、モーダルを自動的に閉じる

### 4. 評価入力（行内左右配置）

```tsx
<View style={styles.inputRow}>
  <Text style={styles.inputRowLabel}>
    {i18n.t("Map.placeholders.enterReview")}
  </Text>
  <View style={styles.ratingInput}>
    {[1, 2, 3, 4, 5].map((star) => (
      <TouchableOpacity key={star} onPress={() => setRating(star)}>
        <Star size={24} color="#FFD700" fill={star <= rating ? "#FFD700" : "transparent"} />
      </TouchableOpacity>
    ))}
  </View>
</View>
```

**スタイル**：
```tsx
inputRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  minHeight: 48,
},
inputRowLabel: {
  fontSize: 14,
  color: "#666",
  flex: 1,
},
ratingInput: {
  flexDirection: "row",
  gap: 4,
  alignItems: "center",
}
```

**変更点**：
- 星アイコンのサイズを 32 → 24 に縮小
- gap を 8 → 4 に縮小
- 行の左側にラベルを表示
- 行の高さは minHeight: 48 で統一

### 5. 価格入力（行内左右配置）

```tsx
<View style={styles.inputRow}>
  <Text style={styles.inputRowLabel}>
    {i18n.t("Map.placeholders.enterPrice")}
  </Text>
  {currencySymbol ? (
    <View style={styles.priceInputContainer}>
      <Text style={styles.currencySymbol}>{currencySymbol}</Text>
      <TextInput
        style={[styles.textInput, styles.priceInput]}
        placeholder={i18n.t("Map.placeholders.enterPrice")}
        value={price}
        onChangeText={setPrice}
        keyboardType="numeric"
      />
    </View>
  ) : (
    <TextInput
      style={[styles.textInput, styles.priceInputSmall]}
      placeholder={i18n.t("Map.placeholders.enterPrice")}
      value={price}
      onChangeText={setPrice}
      keyboardType="numeric"
    />
  )}
</View>
```

**スタイル**：
```tsx
priceInputContainer: {
  flexDirection: "row",
  alignItems: "center",
  borderRadius: 8,
  minWidth: 120,
},
currencySymbol: {
  fontSize: 16,
  fontWeight: "600",
  color: "#666",
  minWidth: 24,
  paddingLeft: 8,
},
priceInput: {
  flex: 1,
  paddingLeft: 4,
  paddingRight: 12,
  minWidth: 80,
}
```

**変更点**：
- 行の左側にラベルを表示
- 右側に価格入力フィールドを配置
- キーボード表示中は InitialMediaPreview が縮小されるため、入力フィールドが隠れない

## アクセシビリティ対応

1. **Pressable 行**：
   - `accessibilityRole="button"` を設定
   - `accessibilityLabel` に i18n の文言を使用

2. **エラーメッセージ**：
   - `accessibilityLiveRegion="polite"` を設定

## テスト観点

### キーボード回避
- [ ] iOS：レビュー本文フォーカス → メディアプレビュー縮小（320→180）
- [ ] iOS：価格入力フォーカス → メディアプレビュー縮小
- [ ] iOS：キーボード閉 → メディアプレビュー復元（180→320）
- [ ] Android：同様の動作確認

### 料理カテゴリ行
- [ ] 行タップ → useBlurModal 表示
- [ ] DishCategoryAutocomplete 自動フォーカス
- [ ] キーボード自動表示
- [ ] 候補選択 → モーダル自動クローズ
- [ ] ChevronRight アイコン表示

### 評価入力行
- [ ] 左テキスト表示：「レビューを入力」
- [ ] 右 ratingInput 収まり
- [ ] 星タップ操作問題なし

### 価格入力行
- [ ] 左テキスト表示：「価格を入力」
- [ ] 右 priceInputContainer 収まり
- [ ] 編集可能

### i18n
- [ ] 8 言語で selectDishCategory 文言が翻訳表示

### アクセシビリティ
- [ ] VoiceOver/TalkBack：行タップ要素がボタンとして読み上げられる

### 回帰
- [ ] 送信動作に影響なし
- [ ] 既存バリデーションに影響なし
- [ ] Dark/Light 両テーマで視認性問題なし

## 変更ファイル

### コンポーネント
- `app-expo/features/map/components/ReviewForm.tsx`

### i18n
- `app-expo/locales/ar-SA.json`
- `app-expo/locales/en-US.json`
- `app-expo/locales/es-ES.json`
- `app-expo/locales/fr-FR.json`
- `app-expo/locales/hi-IN.json`
- `app-expo/locales/ja-JP.json`
- `app-expo/locales/ko-KR.json`
- `app-expo/locales/zh-CN.json`

## 技術的な実装詳細

### インポート追加
```tsx
import { 
  KeyboardAvoidingView, 
  Platform, 
  Keyboard, 
  Pressable, 
  Animated 
} from "react-native";
import { Star, ChevronRight } from "lucide-react-native";
import { useBlurModal } from "@/hooks/useBlurModal";
```

### 状態管理
```tsx
const mediaHeightAnim = useRef(new Animated.Value(320)).current;
const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
```

### useBlurModal の使用
```tsx
const {
  BlurModal,
  open: openDishCategoryModal,
  close: closeDishCategoryModal,
} = useBlurModal({
  keyboardVerticalOffset: Platform.OS === "ios" ? 0 : 0,
  dismissKeyboardFirst: true,
});
```

### handleDishCategorySelect の変更
候補選択時にモーダルを自動的に閉じるように `closeDishCategoryModal()` を追加：
```tsx
const handleDishCategorySelect = useCallback(
  (suggestion: { dishCategoryId: string; label: string }) => {
    setDishCategoryId(suggestion.dishCategoryId);
    setDishCategoryName(suggestion.label);
    setDishCategoryError(null);
    logFrontendEvent({
      event_name: "dish_category_selected",
      error_level: "log",
      payload: { dishCategoryId: suggestion.dishCategoryId, label: suggestion.label },
    });
    closeDishCategoryModal(); // 追加
  },
  [logFrontendEvent, closeDishCategoryModal],
);
```

## パフォーマンス考慮事項

1. **アニメーション**：
   - `useNativeDriver: false` を使用（height プロパティのため）
   - アニメーション時間は 250ms で短く、パフォーマンスへの影響は最小限

2. **キーボードリスナー**：
   - useEffect のクリーンアップ関数で適切にリスナーを削除
   - メモリリークを防止

3. **useCallback の使用**：
   - すべてのイベントハンドラで useCallback を使用
   - 不要な再レンダリングを防止

## 既存機能への影響

- ✅ 既存のレビュー送信フローは変更なし
- ✅ バリデーションロジックは変更なし
- ✅ エラーハンドリングは変更なし
- ✅ 料理カテゴリの作成フローは変更なし

## 今後の改善提案

1. **テーマ対応**：
   - Dark モードでの色の調整が必要な場合は、テーマコンテキストを使用

2. **アクセシビリティ**：
   - 各行の accessibilityHint を追加

3. **アニメーション**：
   - React Native Reanimated への移行を検討（パフォーマンス向上）

4. **テスト**：
   - コンポーネントテストの追加（Jest + React Native Testing Library）
