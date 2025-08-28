# BlurModal Japanese Input Fix

This document explains the fix for Japanese text input composition issues in `BlurModal` components.

## Problem

When using `TextInput` components inside `BlurModal`, Japanese IME (Input Method Editor) composition was breaking. Characters would be committed individually instead of allowing proper conversion (e.g., typing "とうきょう" and converting to "東京").

### Root Cause

- External state management in parent components caused re-renders on every keystroke
- Parent re-renders → `BlurModal` re-renders → `TextInput` loses IME composition context
- This interrupted the Japanese input composition session

## Solution

The `BlurModal` component now supports a **render-prop pattern** that allows child components to receive the `close` function while keeping their input state isolated.

### Updated BlurModal API

```tsx
// Before (still supported for backward compatibility)
<BlurModal>
  <SomeComponent />
</BlurModal>

// After (recommended for forms with TextInput)
<BlurModal>
  {({ close }) => (
    <SomeFormComponent onCancel={close} />
  )}
</BlurModal>
```

### Key Benefits

1. **Prevents Parent Re-renders**: Input state is encapsulated within form components
2. **Maintains IME Context**: TextInput components don't get re-rendered during typing
3. **Backward Compatible**: Existing usage patterns continue to work
4. **Clean API**: Easy access to modal close function in child components

## Usage Examples

### 1. Using ProfileEditForm (Recommended)

```tsx
import { useBlurModal } from "@/hooks/useBlurModal";
import { ProfileEditForm } from "@/components/forms/ProfileEditForm";

const { BlurModal, open, close } = useBlurModal();

// In your JSX:
<BlurModal>
	{({ close }) => (
		<ProfileEditForm
			initialValue={currentBio}
			onSubmit={(newBio) => {
				updateProfile(newBio);
				close();
			}}
			onCancel={close}
		/>
	)}
</BlurModal>;
```

### 2. Custom Form Components

Create your own form components that manage internal state:

```tsx
function MyTextForm({ initialValue, onSubmit, onCancel }) {
	const [value, setValue] = useState(initialValue);

	return (
		<Card>
			<TextInput
				value={value}
				onChangeText={setValue} // Internal state only
				placeholder="Type Japanese text here..."
			/>
			<Button onPress={() => onSubmit(value)} title="Save" />
			<Button onPress={onCancel} title="Cancel" />
		</Card>
	);
}

// Usage:
<BlurModal>
	{({ close }) => (
		<MyTextForm
			initialValue="初期値"
			onSubmit={(value) => {
				saveData(value);
				close();
			}}
			onCancel={close}
		/>
	)}
</BlurModal>;
```

### 3. Migration from External State

```tsx
// Before (problematic for Japanese input):
const [inputValue, setInputValue] = useState("");

<BlurModal>
  <TextInput
    value={inputValue}
    onChangeText={setInputValue} // Causes parent re-renders
  />
</BlurModal>

// After (fixed):
<BlurModal>
  {({ close }) => (
    <MyTextForm
      initialValue={inputValue}
      onSubmit={(newValue) => {
        setInputValue(newValue); // Only update on submit
        close();
      }}
      onCancel={close}
    />
  )}
</BlurModal>
```

## Testing Japanese Input

To test that the fix works:

1. Open a modal with TextInput using the new render-prop pattern
2. Type Japanese hiragana: `とうきょう`
3. Press spacebar to convert to kanji: `東京`
4. The conversion should work smoothly without character interruption

## Available Form Components

- `ProfileEditForm`: For editing profile bio text
- More form components can be created following the same pattern

## Backward Compatibility

Existing code using the old pattern will continue to work without changes. However, for any forms with TextInput that might be used for Japanese input, it's recommended to migrate to the render-prop pattern.

## Technical Implementation

The `BlurModal` component now accepts `children` as either:

- `ReactNode` (original behavior)
- `(props: { close: () => void }) => ReactNode` (new render-prop pattern)

The component automatically detects the type and renders accordingly.
