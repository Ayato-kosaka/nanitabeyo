# Tutorial Pages Visual Guide

## Page 1: 使い方 (How to Use)

```
┌─────────────────────────────────────┐
│            使い方                    │
│        (How to Use)                 │
│                                     │
│  • 料理カテゴリをタップ              │
│    (Tap a dish category)            │
│                                     │
│  • AIで生成した美味しそうな画像を選択 │
│    (Select AI-generated image)      │
│                                     │
│  • 「画像を送信する」ボタンで完了！   │
│    (Complete with submit button)    │
│                                     │
│                                     │
│         ●  ○  ○                     │
│    (Page indicator - page 1)        │
│                                     │
│  [さっそくやってみる！]              │
│  (Close button)                     │
└─────────────────────────────────────┘
```

## Page 2: こんな画像が欲しい (Images We Want)

```
┌─────────────────────────────────────┐
│        こんな画像が欲しい             │
│        (Images We Want)             │
│                                     │
│  • 縦長（9:16）で、料理が主役        │
│    (Portrait 9:16, dish as focus)   │
│                                     │
│  • 料理が大きく写っていて、           │
│    背景はシンプル                    │
│    (Large dish, simple background)  │
│                                     │
│  • 文字入りやコラージュは避けてね     │
│    (Avoid text/collages)            │
│                                     │
│  ┌──────┐  ┌──────┐                │
│  │ IMG  │  │ IMG  │                │
│  │  1   │  │  2   │                │
│  │      │  │      │                │
│  └──────┘  └──────┘                │
│  ┌──────┐  ┌──────┐                │
│  │ IMG  │  │ IMG  │                │
│  │  3   │  │  4   │                │
│  │      │  │      │                │
│  └──────┘  └──────┘                │
│   (2×2 grid of 9:16 images)        │
│                                     │
│         ○  ●  ○                     │
│    (Page indicator - page 2)        │
│                                     │
│  [さっそくやってみる！]              │
│  (Close button)                     │
└─────────────────────────────────────┘
```

## Page 3: AIで画像を作る (Create with AI)

```
┌─────────────────────────────────────┐
│       AIで画像を作る                 │
│       (Create with AI)              │
│                                     │
│  • 画像生成アプリで料理名を入れて     │
│    作ってみてね                      │
│    (Try AI image generator)         │
│                                     │
│  • できた画像はこの画面で選んで送信！ │
│    (Select and submit here)         │
│                                     │
│  プロンプト例（タップでコピー）       │
│  (Example prompt - tap to copy)     │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ 提供後の料理を撮影した写真。    │  │
│  │ 料理そのものは誇張せず、       │  │
│  │ 現実的で自然な見た目。         │  │
│  │                              │  │
│  │ 大きな器・鍋・トレイ・...     │  │
│  │ ...                          │  │
│  │                              │  │
│  │ 縦長構図（9:16）、高解像度、   │  │
│  │ SNS向け。                    │  │
│  │                              │  │
│  │ 料理は、「おでん」            │  │
│  └───────────────────────────────┘  │
│     ☝ Tap to copy prompt           │
│                                     │
│         ○  ○  ●                     │
│    (Page indicator - page 3)        │
│                                     │
│  [さっそくやってみる！]              │
│  (Close button)                     │
└─────────────────────────────────────┘
```

## Interaction Flow

### Initial Launch
```
User opens screen → Tutorial check in AsyncStorage
                   ↓
                No record found
                   ↓
              Tutorial opens
                   ↓
            Display Page 1
```

### Swiping Through Pages
```
Page 1 → [Swipe Left] → Page 2 → [Swipe Left] → Page 3
   ↑                       ↑                       ↑
   ●                       ●                       ●
Dot indicator updates automatically
```

### Copying Prompt (Page 3)
```
User taps prompt box
       ↓
Clipboard.setStringAsync(promptText)
       ↓
showSnackbar("プロンプトをコピーしました")
       ↓
Log event: dish_manual_image_supply_prompt_copied
```

### Closing Tutorial
```
User taps [さっそくやってみる！] button
                ↓
  AsyncStorage.setItem(TUTORIAL_STORAGE_KEY, "true")
                ↓
         tutorialModal.close()
                ↓
        Tutorial dismissed
```

### Reopening Tutorial
```
User taps Help button (?)
         ↓
   tutorialModal.open()
         ↓
    Display Page 1
(Same flow as initial launch)
```

## Key Features Illustrated

1. **Page Indicator**: 
   - Page 1: ● ○ ○
   - Page 2: ○ ● ○
   - Page 3: ○ ○ ●

2. **Navigation**:
   - Horizontal swipe/scroll to move between pages
   - No back/next buttons (simplified UX)
   - Close button (×) in top-right (from BlurModal)
   - Bottom button closes and saves completion status

3. **Page 2 Grid Layout**:
   ```
   [Image 1] [Image 2]
   [Image 3] [Image 4]
   ```
   Each image: 9:16 aspect ratio, 48% width with 4% gap

4. **Page 3 Prompt Box**:
   - Pressable component
   - Shows prompt text with "おでん" example
   - Tap anywhere on box to copy
   - Snackbar confirmation appears

5. **Web Compatibility**:
   - FlatList works with mouse/trackpad scrolling
   - Horizontal scroll maintains paging behavior
   - No platform-specific code required
