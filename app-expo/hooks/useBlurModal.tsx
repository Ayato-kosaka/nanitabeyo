import React, { ReactNode, memo, useCallback, useEffect, useState, useRef } from "react";
import {
	BackHandler,
	Platform,
	Pressable,
	StyleProp,
	StyleSheet,
	View,
	ViewStyle,
	Keyboard,
	KeyboardAvoidingView,
} from "react-native";
import { BlurView } from "expo-blur";
import { X } from "lucide-react-native";
import i18n from "@/lib/i18n";
import { Portal } from "react-native-paper";

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
	/** 閉じるアイコンサイズ */
	closeIconSize?: number;
	/** 閉じるアイコンカラー */
	closeIconColor?: string;
	/** モーダル内部レイヤーの zIndex */
	zIndex?: number;
	/** iOSでヘッダー等の高さ分を避けたい場合のオフセット */
	keyboardVerticalOffset?: number;
	/** バックドロップ/戻るキーで、まずキーボードだけ閉じる */
	dismissKeyboardFirst?: boolean;
}

export function useBlurModal({
	onOpen,
	onClose,
	intensity = 50,
	closeIconSize = 28,
	closeIconColor = "#666666",
	zIndex = 1100,
	keyboardVerticalOffset = 0,
	dismissKeyboardFirst = true,
}: BlurModalOptions = {}) {
	const [visible, setVisible] = useState(false);
	const isKeyboardVisibleRef = useRef(false);

	/* ── 開閉メソッド ─────────────────────────────────────────────── */
	const open = useCallback(() => setVisible(true), []);
	const close = useCallback(() => setVisible(false), []);
	const toggle = useCallback(() => setVisible((v) => !v), []);

	/* ── Android 戻るキー対策 ─────────────────────────────────────── */
	useEffect(() => {
		if (!visible) return;
		const sub = BackHandler.addEventListener("hardwareBackPress", () => {
			/* ---- まずキーボードを閉じる ---- */
			if (isKeyboardVisibleRef.current) {
				Keyboard.dismiss();
				return true;
			}
			close();
			return true; // ハンドリング済み
		});
		return () => sub.remove();
	}, [visible, close]);

	/* ── onOpen / onClose コールバック ────────────────────────────── */
	useEffect(() => {
		visible ? onOpen?.() : onClose?.();
	}, [visible, onOpen, onClose]);

	/* ---- キーボード可視状態の追跡 ---- */
	useEffect(() => {
		const showSub = Keyboard.addListener("keyboardDidShow", () => {
			isKeyboardVisibleRef.current = true;
		});
		const hideSub = Keyboard.addListener("keyboardDidHide", () => {
			isKeyboardVisibleRef.current = false;
		});
		return () => {
			showSub.remove();
			hideSub.remove();
		};
	}, []);

	/* ---- バックドロップ押下の処理 ---- */
	const handleBackdropPress = useCallback(() => {
		console.log("Backdrop pressed");
		if (dismissKeyboardFirst && isKeyboardVisibleRef.current) {
			Keyboard.dismiss();
			return;
		}
		close();
	}, [dismissKeyboardFirst, close]);

	/* ── モーダル Component ───────────────────────────────────────── */
	const BlurModal = useCallback(
		memo(
			({
				children,
				contentContainerStyle,
				showCloseButton = true,
			}: {
				children: ReactNode | ((props: { close: () => void }) => ReactNode);
				contentContainerStyle?: StyleProp<ViewStyle>;
				showCloseButton?: boolean;
			}) => {
				if (!visible) return null;

				// Render children - support both ReactNode and render prop pattern
				const renderChildren = () => {
					if (typeof children === "function") {
						return (children as (p: { close: () => void }) => ReactNode)({ close });
					}
					return children;
				};

				return (
					<Portal>
						{/* Fullscreen layer */}
						<View style={[StyleSheet.absoluteFill, { zIndex }]} pointerEvents="box-none">
							{/* Dim overlay to ensure consistent contrast across platforms */}
							<Pressable
								onPress={handleBackdropPress}
								style={[StyleSheet.absoluteFillObject]}
								android_ripple={{ color: "rgba(255,255,255,0.05)" }}>
								{/* Blur background */}
								{Platform.OS === "android" ? (
									<View
										testID="android-overlay"
										style={[
											StyleSheet.absoluteFillObject,
											{ backgroundColor: `rgba(255,255,255,${0.5 + (intensity * 0.4) / 100})` },
										]}
									/>
								) : (
									<BlurView intensity={intensity} style={StyleSheet.absoluteFill} />
								)}
							</Pressable>

							<KeyboardAvoidingView
								style={{ flex: 1 }}
								behavior={Platform.OS === "ios" ? "padding" : "height"}
								keyboardVerticalOffset={keyboardVerticalOffset}
								pointerEvents="box-none"
								onStartShouldSetResponder={() => {
									Keyboard.dismiss();
									return false; // ← 自分ではレスポンダを奪わない（子要素にタップを渡す）
								}}>
								{/* Content (non-blocking layout wrapper) */}
								<View pointerEvents="box-none" style={[styles.contentContainer, { paddingTop: 32 }]}>
									<View pointerEvents="auto" style={contentContainerStyle}>
										{renderChildren()}
									</View>
								</View>
							</KeyboardAvoidingView>

							{/* Close button */}
							{showCloseButton && (
								<Pressable
									onPress={close}
									accessibilityRole="button"
									accessibilityLabel={i18n.t("Common.close")}
									hitSlop={10}
									style={[
										styles.closeButton,
										{
											top: 16,
											right: 16,
											zIndex: zIndex + 1,
										},
									]}>
									<X size={closeIconSize} color={closeIconColor} />
								</Pressable>
							)}
						</View>
					</Portal>
				);
			},
		),
		[visible, intensity, close, zIndex, closeIconColor, closeIconSize, keyboardVerticalOffset, handleBackdropPress],
	);

	return { BlurModal, open, close, toggle, visible };
}

/* -------------------------------------------------------------------------- */
/*                               スタイル定義                                  */
/* -------------------------------------------------------------------------- */
const styles = StyleSheet.create({
	contentContainer: {
		paddingBottom: 32,
	},
	closeButton: {
		position: "absolute",
		backgroundColor: "transparent",
	},
});
