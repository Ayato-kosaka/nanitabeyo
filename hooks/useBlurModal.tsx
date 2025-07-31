import React, {
  ReactNode,
  memo,
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  BackHandler,
  Modal,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { ScrollView } from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

/* -------------------------------------------------------------------------- */
/*                                Hook 定義                                   */
/* -------------------------------------------------------------------------- */

export interface BlurModalOptions {
  /** モーダルを開いた直後に呼ばれる */
  onOpen?: () => void;
  /** モーダルを閉じた直後に呼ばれる */
  onClose?: () => void;
  /** iOS: blur intensity / Android: フェード色の透明度 (0–100) */
  intensity?: number;
  /** Android 用フォールバック色 (iOS では無視) */
  overlayColor?: string;
  /** 閉じるアイコンサイズ */
  closeIconSize?: number;
  /** 閉じるアイコンカラー */
  closeIconColor?: string;
  /** モーダル内部レイヤーの zIndex */
  zIndex?: number;
}

export function useBlurModal({
  onOpen,
  onClose,
  intensity = 50,
  overlayColor = 'rgba(0,0,0,0.6)',
  closeIconSize = 28,
  closeIconColor = '#666666',
  zIndex = 1100,
}: BlurModalOptions = {}) {
  const [visible, setVisible] = useState(false);
  const insets = useSafeAreaInsets();

  /* ── 開閉メソッド ─────────────────────────────────────────────── */
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const toggle = useCallback(() => setVisible((v) => !v), []);

  /* ── Android 戻るキー対策 ─────────────────────────────────────── */
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true; // ハンドリング済み
    });
    return () => sub.remove();
  }, [visible, close]);

  /* ── onOpen / onClose コールバック ────────────────────────────── */
  useEffect(() => {
    visible ? onOpen?.() : onClose?.();
  }, [visible, onOpen, onClose]);

  /* ── モーダル Component ───────────────────────────────────────── */
  const BlurModal = useCallback(
    memo(
      ({
        children,
        animationType = 'fade',
        presentationStyle = 'overFullScreen',
        contentContainerStyle,
        showCloseButton = true,
      }: {
        children: ReactNode;
        animationType?: 'none' | 'slide' | 'fade';
        presentationStyle?:
          | 'fullScreen'
          | 'pageSheet'
          | 'formSheet'
          | 'overFullScreen';
        /** 子要素ラッパー用スタイル (モーダル内) */
        contentContainerStyle?: StyleProp<ViewStyle>;
        /** 閉じるボタン表示有無 */
        showCloseButton?: boolean;
      }) => {
        if (!visible) return null;
        return (
          <Modal
            transparent
            visible={visible}
            animationType={animationType}
            presentationStyle={presentationStyle}
            statusBarTranslucent
            onRequestClose={close}
          >
            {/* 背景レイヤー */}
            <BlurView intensity={intensity} style={StyleSheet.absoluteFill}>
              {/* 背景タップで閉じる */}
              <Pressable
                onPress={close}
                style={StyleSheet.absoluteFillObject}
                android_ripple={{ color: 'rgba(255,255,255,0.05)' }}
              />
              {/* コンテンツ領域 (タップ透過) */}
              <ScrollView
                pointerEvents="box-none"
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[
                  styles.contentContainer,
                  { paddingTop: insets.top + 32 },
                ]}
              >
                <View pointerEvents="box-none" style={contentContainerStyle}>
                  {children}
                </View>
              </ScrollView>

              {/* 閉じるボタン */}
              {showCloseButton && (
                <Pressable
                  onPress={close}
                  accessibilityRole="button"
                  accessibilityLabel="閉じる"
                  hitSlop={10}
                  style={[
                    styles.closeButton,
                    {
                      top: insets.top + 16,
                      right: 16,
                      zIndex: zIndex + 1,
                    },
                  ]}
                >
                  <X size={closeIconSize} color={closeIconColor} />
                </Pressable>
              )}
            </BlurView>
          </Modal>
        );
      }
    ),
    [
      visible,
      intensity,
      overlayColor,
      close,
      insets,
      zIndex,
      closeIconColor,
      closeIconSize,
    ]
  );

  return { BlurModal, open, close, toggle, visible };
}

/* -------------------------------------------------------------------------- */
/*                               スタイル定義                                  */
/* -------------------------------------------------------------------------- */
const styles = StyleSheet.create({
  contentContainer: {},
  closeButton: {
    position: 'absolute',
    backgroundColor: 'transparent',
  },
});
