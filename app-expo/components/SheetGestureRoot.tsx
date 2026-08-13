import type { ReactNode } from "react";
import { Platform, StyleProp, View, ViewStyle } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

/**
 * 🖐 TrueSheet の中身に «RNGH のルート» を張るためのラッパ。
 *
 * ## なぜ要るのか（実機で踏んだ）
 * Android の TrueSheet は、シートの中身を **`android.R.id.content` へ付け替える**。
 *
 * ```kotlin
 * // @lodev09/react-native-true-sheet TrueSheetView.kt
 * // findRootContainerView() が android.R.id.content まで遡り、そこへシートを載せる
 * override fun findRootContainerView(): ViewGroup?
 * ```
 *
 * アプリの `GestureHandlerRootView` は `app/_layout.tsx` に 1 つだけで、
 * 付け替えられたシートは **その外**へ出る。RNGH は自分のルート配下にしかタッチを配らないので、
 * **シート内の Pan / Tap などの RNGH ジェスチャには一切イベントが届かない**。
 *
 * 実機で観測された形:
 *   保存店カルーセルを横へドラッグしても **まったく動かない**。
 *   そのまま指を離すと **1 枚目のカードの onPress が発火する**。
 *
 * `Pressable` / `TouchableOpacity` は RN 本体のレスポンダ系なので生きており、
 * RNGH のジェスチャだけが死ぬ。この「タップは効くがドラッグは効かない」という
 * 非対称が、原因を «閾値の問題» と誤診させやすい。
 * `activeOffsetX` や `snapMode` をいくら調整しても直らない。
 *
 * ## iOS を巻き添えにしない
 * iOS はシートが RN のビュー階層に残るため、この問題は起きない。
 * 余計なビューを 1 枚増やすとレイアウトの回帰リスクだけが乗るので、**Android のときだけ**差し替える。
 *
 * ⚠️ `style` は必ず呼び出し側から «元の View と同じもの» を渡すこと。
 * `GestureHandlerRootView` は style を持つ普通の View として描画されるので、
 * 同じ style を渡せばレイアウトは変わらない。ここを省くと flex が効かず高さが潰れる。
 */
export function SheetGestureRoot({
	children,
	style,
	testID,
}: {
	children: ReactNode;
	style?: StyleProp<ViewStyle>;
	testID?: string;
}) {
	if (Platform.OS === "android") {
		return (
			<GestureHandlerRootView style={style} testID={testID}>
				{children}
			</GestureHandlerRootView>
		);
	}

	return (
		<View style={style} testID={testID}>
			{children}
		</View>
	);
}
