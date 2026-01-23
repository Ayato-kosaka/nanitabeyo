# Manual Testing Guide - Dish Category Manual Image Supply Screen

## Prerequisites

1. **API Server Running**

   ```bash
   cd api
   pnpm dev
   ```

2. **Expo App Running**

   ```bash
   cd app-expo
   pnpm start
   ```

3. **Test Data on CDN**
   Deploy `test-data/dish_category_manual_image_supply_v1.latest.json` to:
   `https://${CDN_PUBLIC_HOST}/tickets/703/dish_category_manual_image_supply_v1.latest.json`

4. **Test Images**
   Prepare 2-3 food images on your device for upload testing

## Test Scenarios

### 1. Initial Load & Tutorial ✅

**Steps:**

1. Navigate to the screen for the first time
2. Verify tutorial modal appears automatically
3. Read the tutorial content
4. Click "さっそくやってみる！" button

**Expected Results:**

- ✅ Tutorial modal displays with:
  - Title: "使い方"
  - Usage instructions (3 bullet points)
  - Prompt examples
  - Action button
- ✅ Modal closes when button is clicked
- ✅ Grid view is displayed after closing

**Screenshot Required:** Tutorial modal

---

### 2. Grid Display ✅

**Steps:**

1. After closing tutorial, observe the main screen
2. Check header text
3. Check grid layout
4. Count columns (should be 3)
5. Verify card images load

**Expected Results:**

- ✅ Header shows:
  - Title: "料理提案画像を綺麗にしよう！"
  - Subtitle with instructions
  - Help icon (?) in top right
- ✅ Grid displays in 3 columns
- ✅ Cards show:
  - Background image from CDN
  - Category name overlay at bottom
  - 9:16 aspect ratio
- ✅ No state badges initially (all cards are "idle")

**Screenshot Required:** Main grid view with multiple items

---

### 3. Help Button ✅

**Steps:**

1. Tap the "?" button in top right
2. Verify tutorial modal appears
3. Close the modal

**Expected Results:**

- ✅ Tutorial modal reappears
- ✅ Content is identical to first-time tutorial
- ✅ Can close and return to grid

**Screenshot Required:** Help button highlighted

---

### 4. Card Selection & Detail Modal ✅

**Steps:**

1. Tap any dish category card
2. Observe the detail modal
3. Check all elements

**Expected Results:**

- ✅ BlurModal opens with:
  - Full-screen blur background
  - Card image at top (9:16 ratio, contain fit)
  - Dark overlay at bottom with:
    - Topic title (bold)
    - Reason text (smaller, 3 lines max)
  - Close button (X) in top right
  - Action buttons at bottom:
    - "画像を選ぶ" (primary)
- ✅ No "元に戻す" button (image not selected yet)

**Screenshot Required:** Detail modal with image and overlay

---

### 5. Image Selection & Upload ✅

**Steps:**

1. In detail modal, tap "画像を選ぶ"
2. Select an image from device
3. Wait for upload to complete
4. Check badge on card after closing modal

**Expected Results:**

- ✅ Image picker opens
- ✅ Selected image triggers upload immediately
- ✅ During upload:
  - "画像を選ぶ" button shows loading indicator
  - Status text: "アップロード中…ちょっと待ってね"
- ✅ After successful upload:
  - Detail modal shows selected image (not original)
  - "元に戻す" button appears
  - Card badge shows "OK！" with ✓ icon
- ✅ Footer counter increases: "準備できた料理：1"

**Screenshots Required:**

1. Uploading state (loading indicator)
2. Success state with "OK！" badge
3. Detail modal with selected image

---

### 6. Reset Image ✅

**Steps:**

1. Open detail modal for a card with image selected
2. Tap "元に戻す"
3. Check badge disappears

**Expected Results:**

- ✅ Image reverts to original
- ✅ "元に戻す" button disappears
- ✅ Card badge removed
- ✅ Footer counter decreases

**Screenshot Required:** Modal with "元に戻す" button visible

---

### 7. Upload Error Handling ✅

**Steps:**

1. Turn off network connection
2. Try to upload an image
3. Observe error state

**Expected Results:**

- ✅ Upload fails gracefully
- ✅ Status text: "うまくいかなかったみたい。もう一度選んでね"
- ✅ Card badge shows "もう一度！" with ⚠️ icon
- ✅ Can retry by selecting image again

**Screenshot Required:** Error state with "もう一度！" badge

---

### 8. Multiple Uploads ✅

**Steps:**

1. Select and upload images for 3-4 different categories
2. Verify each upload succeeds
3. Check footer counter

**Expected Results:**

- ✅ Each card can be uploaded independently
- ✅ All "OK！" badges display correctly
- ✅ Footer shows correct count
- ✅ Submit button becomes enabled

**Screenshot Required:** Grid with multiple "OK！" badges

---

### 9. Submit Button States ✅

**Steps:**

1. Initially (no images uploaded)
2. After 1+ images uploaded
3. During submission

**Expected Results:**

- ✅ **No images uploaded:**
  - Button disabled (grayed out)
  - Text: "まずは画像を選んでね"
- ✅ **1+ images uploaded:**
  - Button enabled
  - Text: "画像を送信する（n）" where n = count
- ✅ **During submission:**
  - Button shows loading indicator
  - Cannot click again

**Screenshots Required:**

1. Disabled state
2. Enabled state with count

---

### 10. Submission Process ✅

**Steps:**

1. Upload 2-3 images
2. Tap submit button
3. Wait for completion
4. Observe thank you screen

**Expected Results:**

- ✅ Submit button shows loading
- ✅ Each item is POSTed sequentially to `/v1/contribution-tasks`
- ✅ After completion, thank you screen appears with:
  - Title: "ご協力ありがとうございます！"
  - Message about review and resize
  - Action button

**Screenshot Required:** Thank you screen

---

### 11. Thank You Screen - Continue Flow ✅

**Steps:**

1. Submit 1-2 items (leaving others)
2. Check button text on thank you screen
3. Tap the button
4. Verify return to grid

**Expected Results:**

- ✅ Button text: "まだ協力できる料理を見る"
- ✅ Returns to grid view
- ✅ Submitted items are filtered out (not shown)
- ✅ Remaining items still visible

**Screenshot Required:** Thank you screen with continue button

---

### 12. Thank You Screen - All Complete Flow ✅

**Steps:**

1. Submit all available items
2. Check button text on thank you screen
3. Tap the button

**Expected Results:**

- ✅ Button text: "画面を閉じる"
- ✅ Navigates back to previous screen

---

### 13. Completed Items Filtering ✅

**Steps:**

1. Submit some items
2. Reload the screen (restart app or navigate away and back)
3. Verify submitted items don't reappear

**Expected Results:**

- ✅ API call to `/v1/contribution-tasks/completed-target-ids` succeeds
- ✅ Grid only shows items that haven't been submitted
- ✅ Previously submitted items are filtered out

---

### 14. CDN Load Error Handling ✅

**Steps:**

1. Remove test JSON from CDN (or break URL)
2. Reload screen
3. Check error handling

**Expected Results:**

- ✅ Error message: "読み込みに失敗しました"
- ✅ "再読み込み" button appears
- ✅ Tapping button retries CDN load

**Screenshot Required:** Error state with retry button

---

### 15. Persistence Check ✅

**Steps:**

1. Complete tutorial
2. Close app completely
3. Reopen app and navigate to screen

**Expected Results:**

- ✅ Tutorial does NOT appear again
- ✅ Goes directly to grid view
- ✅ Help button (?) still shows tutorial when tapped

---

## Logging Verification

Check console/logs for these events:

1. ✅ `dish_manual_image_supply_tutorial_shown` - On first load
2. ✅ `dish_manual_image_supply_help_opened` - When help tapped
3. ✅ `dish_manual_image_supply_item_opened` - When card tapped
4. ✅ `dish_manual_image_supply_upload_started` - When upload begins
5. ✅ `dish_manual_image_supply_upload_succeeded` - On upload success
6. ✅ `dish_manual_image_supply_upload_failed` - On upload error
7. ✅ `dish_manual_image_supply_submit_started` - When submit pressed
8. ✅ `dish_manual_image_supply_submit_result` - After submission
9. ✅ `dish_manual_image_supply_thanks_continue_clicked` - When continue tapped

---

## Screenshot Checklist for PR

**Required Screenshots:**

1. ☐ Tutorial modal (first time)
2. ☐ Main grid view with 3 columns
3. ☐ Detail modal with original image
4. ☐ Uploading state (loading)
5. ☐ Success state - card with "OK！" badge
6. ☐ Detail modal with selected image + "元に戻す" button
7. ☐ Error state - card with "もう一度！" badge
8. ☐ Multiple items with "OK！" badges
9. ☐ Submit button enabled with count
10. ☐ Thank you screen with continue option
11. ☐ Help button highlighted

**Optional but Recommended:**

- Different device sizes (phone, tablet)
- Light/dark mode if applicable
- Web view if testing on web

---

## Platform Testing

Test on at least 2 platforms:

- ☐ iOS (iPhone)
- ☐ Android (Phone)
- ☐ Web browser

---

## Performance Checks

- ☐ Grid scrolls smoothly with many items
- ☐ Image loading is performant
- ☐ Upload doesn't block UI
- ☐ Modal animations are smooth
- ☐ No memory leaks during extended use

---

## Edge Cases

1. **Network interruption during upload**
   - ✅ Should show error state
   - ✅ Can retry

2. **Very long category names**
   - ✅ Should truncate with ellipsis after 2 lines

3. **Large images**
   - ✅ Should upload without crashing
   - ✅ Preview shows correctly

4. **Rapid tapping**
   - ✅ Upload doesn't start multiple times
   - ✅ Submit doesn't trigger multiple times

5. **Back button/navigation**
   - ✅ Can navigate away and return
   - ✅ Upload state is preserved during session

---

## Completion Criteria

- ☑ All 15 test scenarios pass
- ☑ All 9 logging events fire correctly
- ☑ No console errors
- ☑ No TypeScript errors
- ☑ All required screenshots captured
- ☑ Tested on at least 2 platforms
- ☑ Performance is acceptable
- ☑ Edge cases handled gracefully

---

## Notes for Tester

- Take screenshots in Japanese (all text is Japanese)
- Test with real food images for authenticity
- Check that upload URLs are signed (inspect network)
- Verify API requests match expected format
- Check that completed items API is called on load
