import React, { useCallback, useState, useEffect } from 'react';
import {
  Modal,
  Pressable,
  BackHandler,
  StyleSheet,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { ScrollView } from 'react-native';
import { View } from 'react-native';

export interface BlurModalOptions {
  /** モーダルを開いた後に呼ばれる */
  onOpen?: () => void;
  /** モーダルを閉じた後に呼ばれる */
  onClose?: () => void;
  /** iOS の blur intensity | Android はフェード色の透明度 */
  intensity?: number; // 0–100
  /** Android 向けフォールバック色 (iOS は無視) */
  overlayColor?: string;
}

export function useBlurModal({
  onOpen,
  onClose,
  intensity = 50,
  overlayColor = 'rgba(0,0,0,0.6)',
}: BlurModalOptions = {}) {
  const [visible, setVisible] = useState(false);

  /** —— 開閉メソッド —— */
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const toggle = useCallback(() => setVisible((v) => !v), []);

  /** —— バックハンドラ (Android 戻るキー) —— */
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [visible, close]);

  /** —— モーダル表示・非表示時に値を更新 —— */
  useEffect(() => {
    if (visible && onOpen) onOpen();
    if (!visible && onClose) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /** —— モーダル本体 —— */
  const BlurModal = useCallback(
    ({
      children,
      animationType = 'none',
      presentationStyle = 'overFullScreen',
      contentContainerStyle = {},
    }: {
      children: React.ReactNode;
      /** モーダルのアニメーションタイプ */
      animationType?: 'none' | 'slide' | 'fade' | undefined;
      /** モーダルの表示スタイル */
      presentationStyle?:
        | 'fullScreen'
        | 'pageSheet'
        | 'formSheet'
        | 'overFullScreen'
        | undefined;
      contentContainerStyle?: StyleProp<ViewStyle>;
    }) => {
      if (!visible) return null;
      return (
        <Modal
          transparent
          visible={visible}
          animationType={animationType}
          presentationStyle={presentationStyle}
          onRequestClose={close}
          style={{ backgroundColor: 'transparent' }}
        >
          {/* 背景のブラー / フォールバック */}
          {/* {Platform.OS === 'ios' ? ( */}
          <BlurView intensity={intensity} style={StyleSheet.absoluteFill}>
            <Pressable onPress={close} style={StyleSheet.absoluteFillObject} />
            {/* コンテンツラッパー (タップで閉じないよう pointerEvents=box-none) */}
            <ScrollView
              pointerEvents="box-none"
              style={styles.contentContainer}
              keyboardShouldPersistTaps="handled"
            >
              <View pointerEvents="box-none" style={contentContainerStyle}>
                {children}
              </View>
            </ScrollView>
          </BlurView>
          {/* ) : ( */}
          {/* <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: overlayColor }]}
            onPress={close}
          />
        )} */}
        </Modal>
      );
    },
    [visible, intensity, overlayColor, close]
  );

  return { BlurModal, open, close, toggle, visible };
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingHorizontal: 24,
    paddingTop: 32,
  },
});
