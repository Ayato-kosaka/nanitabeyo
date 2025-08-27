import React, { ReactNode, memo, useCallback, useEffect, useState } from "react";
import { BackHandler, Platform, Pressable, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { ScrollView } from "react-native";
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
}

export function useBlurModal({
	onOpen,
	onClose,
	intensity = 50,
	closeIconSize = 28,
	closeIconColor = "#666666",
	zIndex = 1100,
}: BlurModalOptions = {}) {
	const [visible, setVisible] = useState(false);

	/* ── 開閉メソッド ─────────────────────────────────────────────── */
	const open = useCallback(() => setVisible(true), []);
	const close = useCallback(() => setVisible(false), []);
	const toggle = useCallback(() => setVisible((v) => !v), []);

	/* ── Android 戻るキー対策 ─────────────────────────────────────── */
	useEffect(() => {
		if (!visible) return;
		const sub = BackHandler.addEventListener("hardwareBackPress", () => {
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
						return children({ close });
					}
					return children;
				};

				return (
					<Portal>
						{/* Fullscreen layer */}
						<View style={[StyleSheet.absoluteFill, { zIndex }]} pointerEvents="box-none">
							{/* Dim overlay to ensure consistent contrast across platforms */}
							<Pressable
								onPress={close}
								style={[StyleSheet.absoluteFillObject]}
								android_ripple={{ color: "rgba(255,255,255,0.05)" }}>
								{/* Blur background */}
								<BlurView intensity={intensity} style={StyleSheet.absoluteFill} />
								{/* Content (non-blocking layout wrapper) */}
								{Platform.OS !== "web" && (
									<ScrollView
										pointerEvents="box-none"
										keyboardShouldPersistTaps="handled"
										contentContainerStyle={[styles.contentContainer, { paddingTop: 32 }]}>
										<View pointerEvents="auto" style={contentContainerStyle}>
											{renderChildren()}
										</View>
									</ScrollView>
								)}
							</Pressable>

							{/* Content (non-blocking layout wrapper) */}
							{Platform.OS === "web" && (
								<ScrollView
									pointerEvents="box-none"
									keyboardShouldPersistTaps="handled"
									contentContainerStyle={[styles.contentContainer, { paddingTop: 32 }]}>
									<View pointerEvents="auto" style={contentContainerStyle}>
										{renderChildren()}
									</View>
								</ScrollView>
							)}

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
		[visible, intensity, close, zIndex, closeIconColor, closeIconSize],
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
