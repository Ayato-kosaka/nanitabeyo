import React from 'react';
import { Platform, View, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { useBlurModal } from '../useBlurModal';

// Mock expo-blur
jest.mock('expo-blur', () => ({
  BlurView: ({ children, ...props }: any) => <View testID="blur-view" {...props}>{children}</View>,
}));

// Mock react-native-paper
jest.mock('react-native-paper', () => ({
  Portal: ({ children }: any) => <View testID="portal">{children}</View>,
}));

// Mock i18n
jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

function TestComponent() {
  const { BlurModal, open } = useBlurModal({ intensity: 100 });
  
  React.useEffect(() => {
    open();
  }, [open]);

  return (
    <BlurModal>
      <Text testID="modal-content">Test Content</Text>
    </BlurModal>
  );
}

describe('useBlurModal', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should render Android overlay when Platform.OS is android', () => {
    // Mock Platform.OS to be 'android'
    Object.defineProperty(Platform, 'OS', {
      get: () => 'android',
    });

    const { getByTestId, queryAllByTestId } = render(<TestComponent />);
    
    // Should have the blur view
    expect(getByTestId('blur-view')).toBeTruthy();
    
    // Should have the Android overlay
    const overlays = queryAllByTestId('android-overlay');
    expect(overlays.length).toBeGreaterThan(0);
  });

  it('should not render Android overlay when Platform.OS is not android', () => {
    // Mock Platform.OS to be 'ios'
    Object.defineProperty(Platform, 'OS', {
      get: () => 'ios',
    });

    const { getByTestId, queryAllByTestId } = render(<TestComponent />);
    
    // Should have the blur view
    expect(getByTestId('blur-view')).toBeTruthy();
    
    // Should not have the Android overlay
    const overlays = queryAllByTestId('android-overlay');
    expect(overlays.length).toBe(0);
  });
});