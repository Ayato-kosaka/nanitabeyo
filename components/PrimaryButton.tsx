import React, { memo, ReactElement, useCallback } from 'react';
import {
  ActivityIndicator,
  ColorValue,
  GestureResponderEvent,
  Pressable,
  PressableStateCallbackType,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export interface PrimaryButtonProps {
  /** 表示テキスト */
  label: string;
  /** 押下時のコールバック */
  onPress: (event: GestureResponderEvent) => void;
  /** 左側に表示するアイコン要素 (例: <ThumbsUp size={20} color="#FFF" />) */
  icon?: ReactElement;
  /** グラデーション用カラー配列。デフォルトは青系 */
  colors?: readonly [ColorValue, ColorValue, ...ColorValue[]];
  /** 角丸 */
  borderRadius?: number;
  /** 読み込み状態でインジケータ表示 */
  loading?: boolean;
  /** 無効化 */
  disabled?: boolean;
  /** 外側（影・角丸含む）用スタイル */
  style?: StyleProp<ViewStyle>;
  /** グラデ枠内（行揃え・パディング等）追加スタイル */
  contentStyle?: StyleProp<ViewStyle>;
  /** テキストスタイル追加 */
  labelStyle?: StyleProp<TextStyle>;
  /** testID / a11y */
  testID?: string;
  accessibilityLabel?: string;
}

const PrimaryButtonComponent: React.FC<PrimaryButtonProps> = ({
  label,
  onPress,
  icon,
  colors = ['#5EA2FF', '#357AFF'],
  borderRadius = 24,
  loading = false,
  disabled = false,
  style,
  contentStyle,
  labelStyle,
  testID,
  accessibilityLabel,
}) => {
  const isDisabled = disabled || loading;

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      if (!isDisabled) onPress(e);
    },
    [onPress, isDisabled]
  );

  const getWrapperStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.wrapper,
      { borderRadius },
      pressed && !isDisabled && styles.pressed,
      isDisabled && styles.disabled,
      style,
    ],
    [style, borderRadius, isDisabled]
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      onPress={handlePress}
      style={getWrapperStyle}
      android_ripple={{ color: 'rgba(255,255,255,0.12)', borderless: true }}
    >
      <LinearGradient
        colors={colors}
        style={[styles.gradient, { borderRadius }, contentStyle]}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            {icon}
            <Text style={[styles.label, labelStyle]}>{label}</Text>
          </>
        )}
      </LinearGradient>
    </Pressable>
  );
};

export const PrimaryButton = memo(PrimaryButtonComponent);

const styles = StyleSheet.create({
  wrapper: {
    // 影
    shadowColor: '#5EA2FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 32,
    elevation: 12,
    overflow: 'hidden',
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 12,
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.4,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});
