# Screenshot Guide for Tutorial Pages

## Purpose
This document outlines what screenshots are needed to demonstrate the paginated tutorial feature.

## Required Screenshots

### 1. Tutorial Page 1 - Usage Instructions
**Filename:** `tutorial-page-1-usage.png`

**What to capture:**
- Modal with "使い方" title
- Three bullet points showing usage steps
- Page indicator showing first dot active (● ○ ○)
- Close button at bottom "さっそくやってみる！"

**How to test:**
1. Reset app data or clear AsyncStorage
2. Open the dish category manual image supply screen
3. Tutorial should auto-open on Page 1
4. Take screenshot

**Expected elements:**
- Title: "使い方"
- Step 1: "料理カテゴリをタップ"
- Step 2: "AIで生成した美味しそうな画像を選択"
- Step 3: "「画像を送信する」ボタンで完了！"
- Indicator: ● ○ ○

---

### 2. Tutorial Page 2 - Image Examples
**Filename:** `tutorial-page-2-images.png`

**What to capture:**
- Modal with "こんな画像が欲しい" title
- Three bullet points with image guidelines
- 2×2 grid of example 9:16 images
- Page indicator showing second dot active (○ ● ○)
- Close button at bottom

**How to test:**
1. From Page 1, swipe left to navigate to Page 2
2. Take screenshot

**Expected elements:**
- Title: "こんな画像が欲しい"
- Description 1: "縦長（9:16）で、料理が主役"
- Description 2: "料理が大きく写っていて、背景はシンプル"
- Description 3: "文字入りやコラージュは避けてね"
- 2×2 grid with 4 CDN images
- Indicator: ○ ● ○

**Note:** If CDN images are not uploaded yet, screenshot will show empty/placeholder images.

---

### 3. Tutorial Page 3 - AI Generation & Prompt
**Filename:** `tutorial-page-3-prompt.png`

**What to capture:**
- Modal with "AIで画像を作る" title
- Two bullet points with AI generation instructions
- Section titled "プロンプト例（タップでコピー）"
- Gray box containing the prompt example
- Page indicator showing third dot active (○ ○ ●)
- Close button at bottom

**How to test:**
1. From Page 2, swipe left to navigate to Page 3
2. Take screenshot

**Expected elements:**
- Title: "AIで画像を作る"
- Description 1: "画像生成アプリで料理名を入れて作ってみてね"
- Description 2: "できた画像はこの画面で選んで送信！"
- Prompt title: "プロンプト例（タップでコピー）"
- Prompt box with text starting with "提供後の料理を撮影した写真。"
- Prompt ending with "料理は、「おでん」"
- Indicator: ○ ○ ●

---

### 4. Snackbar - Prompt Copied Confirmation
**Filename:** `snackbar-prompt-copied.png`

**What to capture:**
- Tutorial Page 3 still visible in background
- Snackbar at bottom showing "プロンプトをコピーしました"

**How to test:**
1. On Page 3, tap the gray prompt box
2. Snackbar should appear at bottom
3. Take screenshot quickly (snackbar auto-dismisses after 4 seconds)

**Expected elements:**
- Snackbar message: "プロンプトをコピーしました"
- Snackbar positioned above bottom navigation/safe area

---

### 5. Horizontal Swipe Interaction (Optional)
**Filename:** `tutorial-swipe-interaction.gif` or multiple frames

**What to capture:**
- Animation/video showing swipe from Page 1 to Page 2
- Page indicator animation
- Smooth horizontal transition

**How to test:**
1. Start recording screen
2. Slowly swipe from Page 1 to Page 2 to Page 3
3. Show the page indicator updating
4. Stop recording

**Alternative:** Take 3 separate screenshots during mid-swipe to show transition

---

### 6. Web Platform Screenshot (Optional)
**Filename:** `tutorial-web-view.png`

**What to capture:**
- Tutorial running in web browser
- Mouse cursor hovering over tutorial
- Browser URL bar showing localhost or deployed URL

**How to test:**
1. Run `pnpm start` in app-expo
2. Open web browser to Expo web URL
3. Navigate to the dish category manual image supply screen
4. Tutorial opens
5. Take screenshot

**Purpose:** Demonstrate Web compatibility as required

---

### 7. Help Button Reopening Tutorial
**Filename:** `help-button-tutorial.png`

**What to capture:**
- Main screen with Help button (?) visible in header
- Tutorial modal opened after tapping help button

**How to test:**
1. Close tutorial by tapping bottom button
2. Back on main screen, tap the Help button (?) in header
3. Tutorial reopens
4. Take screenshot

**Expected elements:**
- Help button highlighted or clearly visible in header
- Tutorial modal opened to Page 1

---

## Multi-Language Screenshots (Optional)

To demonstrate i18n support, capture Page 1 in different languages:

### English (en-US)
**Filename:** `tutorial-page-1-english.png`
- Title: "How to Use"
- Steps in English

### Arabic (ar-SA)  
**Filename:** `tutorial-page-1-arabic.png`
- Title: "كيفية الاستخدام"
- Right-to-left layout
- Steps in Arabic

### Spanish (es-ES)
**Filename:** `tutorial-page-1-spanish.png`
- Title: "Cómo usar"
- Steps in Spanish

---

## Screenshot Specifications

### Format
- **Format:** PNG (preferred) or JPEG
- **Quality:** High resolution, suitable for documentation
- **Size:** Full screen capture of mobile device/emulator

### Devices/Platforms
- **iOS:** iPhone 14 or newer (recommended)
- **Android:** Pixel 6 or newer (recommended)
- **Web:** Modern browser (Chrome/Safari) at 375px or 768px viewport width

### Annotations (Optional)
For enhanced documentation, consider adding:
- Red arrows pointing to key UI elements
- Text callouts explaining interactions
- Numbered steps showing flow

---

## Testing Checklist

Before taking screenshots, verify:

- [ ] All 8 language translations are present
- [ ] CDN images are uploaded (or acknowledge placeholders)
- [ ] Tutorial opens on first launch
- [ ] Horizontal swipe works smoothly
- [ ] Page indicator updates correctly
- [ ] Prompt copy works and shows snackbar
- [ ] Close button saves to AsyncStorage
- [ ] Help button reopens tutorial
- [ ] Web platform works (trackpad/mouse scrolling)
- [ ] No console errors or warnings

---

## Submission

Place all screenshots in a folder named `screenshots/` with descriptive filenames as specified above.

If screenshots cannot be taken due to environment limitations, provide:
1. This documentation explaining what should be captured
2. Code walkthrough showing the implementation
3. Build success confirmation
4. Statement that manual testing is required

---

## Alternative: Screen Recording

Instead of static screenshots, consider a 30-60 second screen recording showing:
1. Tutorial auto-opening
2. Swiping through all 3 pages
3. Page indicator updating
4. Tapping prompt box
5. Snackbar appearing
6. Closing tutorial
7. Reopening via help button

**Filename:** `tutorial-demo-video.mp4` or `.mov`
