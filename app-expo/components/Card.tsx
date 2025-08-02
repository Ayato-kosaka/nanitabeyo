import React, { forwardRef } from 'react';
import { View, ViewProps, ViewStyle, Platform, StyleProp } from 'react-native';
import { useColorScheme } from 'react-native';

export interface CardProps extends ViewProps {
  /** 角丸 (dp)。デフォルト 20 */
  radius?: number;
  /** elevation / shadow 深さ。iOS は 0–16、Android は 0–24 程度 */
  elevation?: number;
  /** 内側パディング。単一値または StyleSheet のショートハンド形式 */
  padding?: number | ViewStyle['padding'];
  /** カスタムスタイル (背景色や余白などを上書き) */
  style?: StyleProp<ViewStyle>;
  /** テスト用 ID */
  testID?: string;
}

/**
 * Reusable white (or themed) card with rounded corners and shadow.
 */
export const Card = forwardRef<View, CardProps>(
  (
    {
      children,
      radius = 20,
      elevation = 4,
      padding = { paddingHorizontal: 16, paddingVertical: 20 },
      style,
      ...rest
    },
    ref
  ) => {
    /** ----- Theme-aware background ----- */
    const colorScheme = useColorScheme();
    const bgColor =
      colorScheme === 'dark' ? 'rgba(255,255,255,0.05)' : '#FFFFFF';

    /** ----- Compose shadow style (iOS / Android / Web) ----- */
    const shadow: ViewStyle =
      Platform.OS === 'android'
        ? { elevation }
        : {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.1,
            shadowRadius: elevation * 4,
          };

    /** ----- Merge all styles ----- */
    const containerStyle: StyleProp<ViewStyle> = [
      {
        backgroundColor: bgColor,
        borderRadius: radius,
        margin: 16,
        // Default padding
        ...(typeof padding === 'number' ? { padding } : (padding as object)),
      },
      shadow,
      style,
    ];

    return (
      <View ref={ref} style={containerStyle} {...rest}>
        {children}
      </View>
    );
  }
);

Card.displayName = 'Card';
