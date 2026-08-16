/**
 * #1358 【責務】
 * 友達投票の全画面レイヤー（投票完了の入力・候補詳細）を、**呼び出した画面のツリーの内側**へ描く器。
 *
 * #1350 【設計】以前は共通の BlurModal フック（`features/blurModal` = react-native-paper の `Portal`）を
 * 使っていた。Portal は
 * `Portal.Host` 直下 ＝ 画面スタックの外側へ描かれるため、開いたまま遷移すると遷移先の上に
 * バックドロップ（`StyleSheet.absoluteFill` の Pressable）が残り、遷移先を一切タップできない
 * （#1122。web / Android で再現し、iOS だけ遷移先が `presentation:"transparentModal"` のため無事だった）。
 *
 * この器は画面の子として留まるので、遷移すれば遷移先の画面がこのレイヤーごと上から覆う。
 * つまり #1122 は「順序を守っているから起きない」ではなく「構造として起こせない」になる。
 *
 * ⚠️ 【バグ】ここに zIndex を積んではいけない。web では親（画面コンテナ）が stacking context を
 * 作っているとは限らず、大きな zIndex を置くと兄弟の画面より上へ抜けうる ＝ Portal と同じ壊れ方に戻る。
 * RN / RN Web はどちらも兄弟の描画順が子の順序で決まるため、**画面の最後の子として置くだけ**で足りる。
 */
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import {
	BackHandler,
	Keyboard,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	type StyleProp,
	StyleSheet,
	View,
	type ViewStyle,
} from "react-native";
import { BlurView } from "expo-blur";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import i18n from "@/lib/i18n";

/** 移行前の BlurModal の既定値をそのまま踏襲する（見た目を変えないため） */
const BLUR_INTENSITY = 50;
const CLOSE_ICON_SIZE = 28;
const CLOSE_ICON_COLOR = "#666666";

type Props = {
	children: ReactNode;
	/** 中身を包むコンテナの追加スタイル（余白の調整用） */
	contentContainerStyle?: StyleProp<ViewStyle>;
	/**
	 * 閉じる要求のハンドラ。
	 *
	 * 【設計】渡さない場合は「閉じられない全画面レイヤー」になる（右上の X も出さず、
	 * バックドロップ押下・Android 戻るキーにも反応しない）。投票完了画面のように、
	 * 実質そこが 1 枚の画面であって離脱導線を持たせたくない用途を想定している。
	 */
	onRequestClose?: () => void;
};

export function DishCategoryGroupVoteInlineOverlay({ children, contentContainerStyle, onRequestClose }: Props) {
	const insets = useSafeAreaInsets();
	const isKeyboardVisibleRef = useRef(false);

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

	// 【設計】キーボードが出ているときは、まずキーボードだけ閉じる。
	// 入力中に背景を触った / 戻るキーを押しただけでレイヤーごと消えると、入力内容を失う。
	const requestClose = useCallback(() => {
		if (!onRequestClose) return false;
		if (isKeyboardVisibleRef.current) {
			Keyboard.dismiss();
			return true;
		}
		onRequestClose();
		return true;
	}, [onRequestClose]);

	useEffect(() => {
		if (!onRequestClose) return;
		const sub = BackHandler.addEventListener("hardwareBackPress", () => requestClose());
		return () => sub.remove();
	}, [onRequestClose, requestClose]);

	return (
		<View style={StyleSheet.absoluteFill} pointerEvents="box-none">
			{/* 背景。押下で閉じる（onRequestClose を渡した場合のみ） */}
			<Pressable
				onPress={() => requestClose()}
				style={StyleSheet.absoluteFillObject}
				android_ripple={{ color: "rgba(255,255,255,0.05)" }}>
				{Platform.OS === "android" ? (
					// Android の BlurView は実機で重く、プラットフォーム間のコントラスト差も大きいので白の半透明で代替する
					<View
						testID="android-overlay"
						style={[
							StyleSheet.absoluteFillObject,
							{ backgroundColor: `rgba(255,255,255,${0.5 + (BLUR_INTENSITY * 0.4) / 100})` },
						]}
					/>
				) : (
					<BlurView tint="light" intensity={BLUR_INTENSITY} style={StyleSheet.absoluteFill} />
				)}
			</Pressable>

			<KeyboardAvoidingView
				style={styles.fill}
				behavior={Platform.OS === "ios" ? "padding" : "height"}
				pointerEvents="box-none">
				{/* 【設計】包み側は box-none。中身の外側をタップしたときは背景の Pressable まで届かせる */}
				<View pointerEvents="box-none" style={[styles.content, contentContainerStyle]}>
					{children}
				</View>
			</KeyboardAvoidingView>

			{onRequestClose ? (
				// E2E は accessibilityLabel（= Common.close）でこの X を引く。ラベルを変えるときは
				// e2e-web / e2e-mobile の両方を同時に直すこと
				<Pressable
					onPress={onRequestClose}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("Common.close")}
					hitSlop={10}
					style={[styles.closeButton, { top: insets.top, right: insets.right }]}>
					<X size={CLOSE_ICON_SIZE} color={CLOSE_ICON_COLOR} />
				</Pressable>
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	fill: {
		flex: 1,
	},
	content: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
	},
	closeButton: {
		position: "absolute",
		backgroundColor: "transparent",
		paddingHorizontal: 12,
	},
});
