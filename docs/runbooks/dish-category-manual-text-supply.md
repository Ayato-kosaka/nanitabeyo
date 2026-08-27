# Dish Category Manual Text Supply Screen Implementation

## Overview

This feature implements a Tinder-style UI for community-driven improvement of dish category text (title/subTitle). Users can swipe through cards to either approve existing text, skip, or propose improvements.

**Issue**: #749 【実装】dish category 手動文言改善画面（Tinder UI）

## File Location

`app-expo/app/[locale]/contribution-tasks/dish-category-manual-text-supply.tsx`

## Key Features

### 1. Card-Based UI

- Displays dish categories with image, title, and subTitle
- Based on `TopicCard` component design
- Uses react-native-reanimated for smooth animations
- Swipeable gestures (left/right)

### 2. User Actions

#### Right Swipe / Right Button - OK

- Marks content as acceptable
- No API call (local dismiss only)
- Stores ID in local storage to prevent re-showing
- Haptic feedback

#### Left Swipe / Left Button - Edit

- Opens modal to propose improvements
- Allows editing of both title and subTitle
- Shows live preview
- Submits to `v1/contribution-tasks` API
- Only successful submissions are dismissed

#### Center Button - Skip

- No persistence (will reappear on reload)
- Allows users to defer decision
- Can be re-shown at the end if user wants

### 3. Edit Modal

Features:

- Two text input fields (title and subTitle)
- Live preview card showing changes
- Validation:
  - Empty fields not allowed
  - Must differ from original
  - Shows error messages
- Blur background modal using `useLegacyBlurModal` hook
- Submit and close buttons

### 4. Tutorial/Help Modal

- Auto-shows on first visit (stored in AsyncStorage)
- Can be manually opened via help icon (?)
- Explains the three actions (OK, Edit, Skip)
- Japanese text only (no i18n)

### 5. Completion States

#### All Items Reviewed

- If skipped items exist: Shows "re-show skipped" button
- If no skipped items: Shows thank you message

#### Thank You Message

"ご協力ありがとうございました。内容確認後、アプリに反映して、もっとなに食べよを使いやすくしていきます！"

### 6. Local Storage

Storage Keys:

- `dish_manual_text_supply_tutorial_shown`: Tutorial completion flag
- `dish_manual_text_supply_v1_dismissed`: Array of dismissed IDs

Data persisted:

- Right swipe (OK) → Dismissed IDs
- Edit submission success → Dismissed IDs
- Skip → NOT persisted (reappears on reload)

### 7. API Integration

**Endpoint**: `POST v1/contribution-tasks`

**Payload**:

```json
{
	"type": "text_feedback",
	"taskKey": "dish_category_manual_text_supply_v1",
	"targetType": "dish_categories",
	"targetId": "Q46383",
	"payload": {
		"original": {
			"title": "...",
			"subTitle": "..."
		},
		"proposed": {
			"title": "...",
			"subTitle": "..."
		},
		"source": {
			"cdnJsonPath": "tickets/749/dish_category_manual_text_supply_v1.latest.json"
		}
	}
}
```

**Note**: `completed-target-ids` API is NOT used. All progress tracking is local.

### 8. CDN Data Source

**URL Pattern**: `https://{CDN_PUBLIC_HOST}/{CDN_JSON_PATH}?t={timestamp}`

**JSON Schema**:

```typescript
type CandidateItem = {
	id: string; // Wikidata QID (e.g., Q46383)
	label: string; // Category name (not displayed)
	title: string; // Display title
	subTitle: string; // Display subtitle
	imageUrl: string; // Image URL
}[];
```

**Cache Busting**: `?t=${Date.now()}` appended to prevent stale data

### 9. Logging Events

All events are logged via `useLogger` hook:

- `dish_manual_text_supply_screen_displayed` - Screen loaded
- `dish_manual_text_supply_data_loaded` - JSON fetched successfully
- `dish_manual_text_supply_data_load_error` - JSON fetch failed
- `dish_manual_text_supply_tutorial_shown` - Tutorial auto-shown
- `dish_manual_text_supply_help_opened` - Help button pressed
- `dish_manual_text_supply_ok_confirmed` - Right swipe/button
- `dish_manual_text_supply_skipped` - Skip button pressed
- `dish_manual_text_supply_edit_opened` - Edit modal opened
- `dish_manual_text_supply_edit_closed` - Edit modal closed
- `dish_manual_text_supply_edit_submit_started` - Edit submission started
- `dish_manual_text_supply_edit_submit_success` - Edit submitted successfully
- `dish_manual_text_supply_edit_submit_error` - Edit submission failed
- `dish_manual_text_supply_image_load_error` - Card image load error

### 10. Haptic Feedback

- Light impact: Edit button, skip button
- Medium impact: OK button, successful edit submission

## Constants

```typescript
const TASK_KEY = "dish_category_manual_text_supply_v1";
const TYPE = "text_feedback";
const TARGET_TYPE = "dish_categories";
const CDN_JSON_PATH = "tickets/749/dish_category_manual_text_supply_v1.latest.json";
const SWIPE_THRESHOLD = 100; // pixels
```

## Dependencies

Key libraries used:

- `react-native-reanimated` - Animations and gestures
- `react-native-gesture-handler` - Pan gesture detection
- `@react-native-async-storage/async-storage` - Local persistence
- `expo-image` - Optimized image loading
- `lucide-react-native` - Icons

Hooks:

- `useLegacyBlurModal` - Modal with blur background (frozen copy, contribution-tasks only)
- `useLogger` - Event logging
- `useAPICall` - Backend API calls
- `useHaptics` - Haptic feedback
- `useImageLoadWithRetry` - Image loading with retry logic
- `useSnackbar` - Toast notifications

## UI Design

### Card Dimensions

- Width: `CARD_WIDTH` (from topics constants)
- Height: 60% of screen height
- Rounded corners: 24px
- Shadow: elevation 12

### Colors

- Edit button: `#FF6B35` (primary orange)
- OK button: `#4CAF50` (green)
- Skip button: `#E0E0E0` (gray)
- Background: `#F5F5F5`

### Typography

- Header title: 18px, bold
- Card title: 32px, bold, white with text shadow
- Card subtitle: 18px, medium, white with text shadow
- Button text: 16px, semi-bold

## Testing

### Manual Testing Steps

1. **Initial Load**
   - Verify tutorial modal appears on first visit
   - Check that tutorial doesn't appear on subsequent visits
   - Verify data loads from CDN with cache busting

2. **Card Interactions**
   - Test right swipe → card disappears
   - Test left swipe → edit modal opens
   - Test skip button → card moves to next
   - Verify haptic feedback on all actions

3. **Edit Modal**
   - Test validation (empty fields)
   - Test validation (unchanged text)
   - Test live preview updates
   - Test successful submission
   - Test cancel (close) button

4. **Completion Flow**
   - Go through all cards with mix of actions
   - Verify "re-show skipped" appears if items were skipped
   - Verify thank you message if all completed

5. **Persistence**
   - Reload app → OK'd items should not reappear
   - Reload app → Successfully edited items should not reappear
   - Reload app → Skipped items should reappear

6. **Error Handling**
   - Test with invalid CDN URL
   - Test with network failure during edit submission
   - Verify error messages display properly

### API Testing

Verify POST to `v1/contribution-tasks`:

- Correct payload structure
- Only called on edit submission (not OK/skip)
- Includes original and proposed text
- Includes source metadata

## Known Limitations

1. **No i18n**: All text is Japanese only
2. **No server-side progress**: Progress is local only, not synced across devices
3. **Fixed image aspect ratio**: Uses TopicCard layout (might not fit all images perfectly)

## Future Enhancements

Potential improvements (not in scope):

- Multi-language support
- Server-side progress tracking
- Image aspect ratio optimization
- Analytics dashboard for submissions
- Admin review interface
- A/B testing for proposed text

## Related Files

- `/app-expo/features/topics/components/TopicCard.tsx` - Reference card design
- `/app-expo/features/contributionTasks/legacyBlurModal/useLegacyBlurModal.tsx` - Modal implementation (frozen copy)
- `/shared/api/v1/dto/contribution-tasks/create-contribution-task.dto.ts` - API DTO
- `/app-expo/app/[locale]/contribution-tasks/dish-category-manual-image-supply.tsx` - Similar pattern for image supply

## Acceptance Criteria

- [x] CDN JSON fetched with `?t=Date.now()` for cache busting
- [x] Label field not displayed in UI
- [x] Left swipe/button opens edit modal
- [x] Cancel in edit modal keeps card (no persistence)
- [x] Edit submission POSTs to `v1/contribution-tasks`
- [x] Successful edit dismisses card locally
- [x] Right swipe/button dismisses locally without POST
- [x] Skip doesn't persist (reappears on reload)
- [x] Re-show skipped button appears when all non-skipped done
- [x] Thank you message when all completed
- [x] No i18n (Japanese only)
- [x] All logging events implemented

## Notes for Reviewers

- The `label` field in JSON is intentionally not displayed (per specs)
- Tutorial modal uses blur background similar to other contribution tasks
- Swipe animations use react-native-reanimated for smooth 60fps performance
- Local storage versioning (`v1`) allows for future data model changes
- Edit modal includes live preview to help users visualize changes
