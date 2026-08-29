/* -------------------------------------------------------------------------- */
/*                        LegacyBlurModal（凍結コピー）                        */
/* -------------------------------------------------------------------------- */
/*
  #1363 【設計】これは `features/blurModal/hooks/useBlurModal.tsx` の凍結コピーである。
  改善版でも移行先でもない。中身は元実装をそのまま写したもので、意図的に直していない。

  - 用途は社内向けの `app/[locale]/contribution-tasks/*` に限定する。公開アプリからは使わない。
    この境界は `.eslintrc.js` の `no-restricted-imports` で error として固定してある。
  - 新規利用を増やさないこと。新しい画面でモーダルが要るなら、ここではなく
    公開アプリ側の実装（現時点では `features/blurModal`、将来はその後継）を使う。
  - 隔離の効果は双方向である。ここを触っても公開アプリへは波及しないが、
    逆に公開アプリ側の改善もここへは降りてこない。修正が要ると感じたら、
    まず「その画面を凍結対象のままにしてよいか」を #1350 の方針に照らして判断する。

  #1363 【設計】なぜ移行ではなく凍結なのか。
  BlurModal 撤去（#1350）の目的は (1) ユーザーに見えるバグを消す (2) 共有部品が全画面を
  人質に取る状態をやめる、の 2 つである。社内タスク画面はユーザー影響が無いため、
  利用者をここだけに閉じ込めれば (1) は完全に満たし、(2) も満たす。11 箇所ぶんの移行工数を
  クリティカルパスから外すための判断であり、この画面群の品質を諦めた判断ではない。

  #1363 【設計】元実装の既知の問題は #1350 に記録がある。ここでは直さない。
  - モーダルがナビゲーション履歴の外にあり、戻る操作の意味論が画面と揃わない
  - キーボード状態を本フックと子コンポーネントで二重に管理している
  - Android にぼかしが無く、白の半透明オーバーレイで代替している
  - 重なり順を手動の zIndex で決めている
  - アクセシビリティ上のモーダル意味論（フォーカストラップ等）を持たない
*/

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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "@/contexts/ThemeProvider";

/* -------------------------------------------------------------------------- */
/*                                Hook 定義                                   */
/* -------------------------------------------------------------------------- */

export interface LegacyBlurModalOptions {
	/** モーダルを開いた直後に呼ばれる */
	onOpen?: () => void;
	/** モーダルを閉じた直後に呼ばれる */
	onClose?: () => void;
	/** iOS: blur intensity / Android: フェード色の透明度 (0–100) */
	intensity?: number;
	/** 閉じるアイコンサイズ */
	closeIconSize?: number;
	/**
	 * 閉じるアイコンカラー。
	 * #1629 既定値はテーマの «補足文字» トークン（ライトでは従来と同じ `#666666`）。
	 * モジュールスコープの既定値にできないので、未指定のときにフック内で解決する。
	 */
	closeIconColor?: string;
	/** モーダル内部レイヤーの zIndex */
	zIndex?: number;
	/** iOSでヘッダー等の高さ分を避けたい場合のオフセット */
	keyboardVerticalOffset?: number;
	/** バックドロップ/戻るキーで、まずキーボードだけ閉じる */
	dismissKeyboardFirst?: boolean;
	/** バックドロップ押下でモーダルを閉じるかどうか */
	closeOnBackdropPress?: boolean;
	/** Android 戻るキーで閉じるかどうか */
	backHandlerEnabled?: boolean;
}

export function useLegacyBlurModal({
	onOpen,
	onClose,
	intensity = 50,
	closeIconSize = 28,
	closeIconColor,
	zIndex = 1100,
	keyboardVerticalOffset = 0,
	dismissKeyboardFirst = true,
	closeOnBackdropPress = false,
	backHandlerEnabled = true,
}: LegacyBlurModalOptions = {}) {
	const insets = useSafeAreaInsets();
	/*
	  #1629 【設計】このモーダルはオーバーレイ（ぼかし / 半透明の膜）だけをここで描き、
	  本体の地は呼び出し側の `contentContainerStyle` が持つ。ダークで «膜だけ暗くて本体は白い»
	  という絵にならないよう、オーバーレイをテーマへ追従させるのと同時に、
	  呼び出し側（app/[locale]/contribution-tasks/*）の本体もトークンへ移してある。
	*/
	const { colors, scheme } = useAppTheme();
	const resolvedCloseIconColor = closeIconColor ?? colors.textMuted;
	const isDark = scheme === "dark";
	const [visible, setVisible] = useState(false);
	const isKeyboardVisibleRef = useRef(false);

	/* ── 開閉メソッド ─────────────────────────────────────────────── */
	const open = useCallback(() => setVisible(true), []);
	const close = useCallback(() => setVisible(false), []);
	const toggle = useCallback(() => setVisible((v) => !v), []);

	/* ── Android 戻るキー対策 ─────────────────────────────────────── */
	useEffect(() => {
		if (!visible) return;
		if (!backHandlerEnabled) return;
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
	}, [visible, close, backHandlerEnabled]);

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
		if (dismissKeyboardFirst && isKeyboardVisibleRef.current) {
			Keyboard.dismiss();
			return;
		}
		if (closeOnBackdropPress) close();
	}, [dismissKeyboardFirst, closeOnBackdropPress, close]);

	/* ── モーダル Component ───────────────────────────────────────── */
	const LegacyBlurModal = useCallback(
		memo(
			({
				children,
				contentContainerStyle,
				showCloseButton = true,
				paddingVertical = 32,
			}: {
				children: ReactNode | ((props: { close: () => void }) => ReactNode);
				contentContainerStyle?: StyleProp<ViewStyle>;
				showCloseButton?: boolean;
				paddingVertical?: number;
			}) => {
				if (!visible) return null;

				// Render children - support both ReactNode and render prop pattern
				const renderChildren = () => {
					if (typeof children === "function") {
						return (children as (p: { close: () => void }) => ReactNode)({ close });
					}
					return children;
				};

				const contenContinerWrapperStyle: StyleProp<ViewStyle> = {
					paddingVertical,
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
											{
												// #1629 Android にぼかしが無いための代替。ライトは白の膜（従来どおり）、
												// ダークは背景トークン `#141313` の膜にして、暗い画面が白く発光しないようにする。
												backgroundColor: isDark
													? `rgba(20,19,19,${0.5 + (intensity * 0.4) / 100})`
													: `rgba(255,255,255,${0.5 + (intensity * 0.4) / 100})`,
											},
										]}
									/>
								) : (
									<BlurView tint={isDark ? "dark" : "light"} intensity={intensity} style={StyleSheet.absoluteFill} />
								)}
							</Pressable>

							{/*
							  #528 【修正】ここに `onStartShouldSetResponder` を付けてはいけない。
							  以前は「レスポンダは奪わず（false を返す）副作用として Keyboard.dismiss() だけ行う」
							  実装だったが、このコールバックはタップ**開始**時に呼ばれるため、
							    候補タップ開始 → 親が Keyboard.dismiss() → キーボード高の変化でレイアウト再計算
							    → 候補リストが畳まれて unmount → 子の onPress がキャンセル
							  となり「キーボードだけ閉じて選択が反応しない」不具合になっていた
							  （初回起動でだけ再現したのはレイアウトタイミングの揺らぎによるもので原因は同じ）。
							  キーボードを閉じる責務は、背景タップの `handleBackdropPress` と
							  子（オートコンプリート側の候補押下）だけが持つ。
							*/}
							<KeyboardAvoidingView
								style={{ flex: 1 }}
								behavior={Platform.OS === "ios" ? "padding" : "height"}
								keyboardVerticalOffset={keyboardVerticalOffset}
								pointerEvents="box-none">
								{/* Content (non-blocking layout wrapper) */}
								<View pointerEvents="box-none" style={[contenContinerWrapperStyle]}>
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
											top: insets.top,
											right: insets.right,
											zIndex: zIndex + 1,
										},
									]}>
									<X size={closeIconSize} color={resolvedCloseIconColor} />
								</Pressable>
							)}
						</View>
					</Portal>
				);
			},
		),
		[
			visible,
			intensity,
			close,
			zIndex,
			resolvedCloseIconColor,
			closeIconSize,
			keyboardVerticalOffset,
			handleBackdropPress,
			isDark,
		],
	);

	return { LegacyBlurModal, open, close, toggle, visible };
}

/* -------------------------------------------------------------------------- */
/*                               スタイル定義                                  */
/* -------------------------------------------------------------------------- */
const styles = StyleSheet.create({
	closeButton: {
		position: "absolute",
		backgroundColor: "transparent",
		paddingHorizontal: 12,
	},
});
