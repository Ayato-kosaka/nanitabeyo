import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/*
#1742 【設計】**画面の下端に貼り付くシートの下余白は、必ずここで組む。**

Android は Expo SDK 54 / RN 0.81 で edge-to-edge が既定になっており、
**画面の一番下に自分で貼り付くもの（`position: "absolute"` の `bottom: 0`、
`<Modal>` の中の `justifyContent: "flex-end"`）はナビゲーションバーの «下» へ描かれる**。
3 ボタンナビの端末では最下行がスクリムに沈み、タップ領域も削られる。

`<Modal>` はネイティブでは別ウィンドウなので、**画面側で足した余白は中まで届かない**。
`@expo/react-native-action-sheet` も `bottom: 0` で貼るだけで safe area を見ない。
つまりどちらも «シート自身が自分で inset を足す» 以外に手が無い。

⚠️ 固定値で水増ししないこと。ジェスチャーナビ端末・iOS・web では inset が小さい（web は 0）ので、
   固定値を足すと今度は余白が過剰になる。`base` は «シートとして欲しいデザイン上の余白»、
   inset は «システム UI を避けるぶん» で、意味が違う。

## キーボードが出ている間は inset を足さない

避けたい相手（ナビゲーションバー / ホームインジケータ）は、**キーボードが出ている間は
その裏に隠れている**。一方でキーボードを避ける仕事は `KeyboardAvoidingView` が既に
やっていて、シートはキーボードのすぐ上まで持ち上がっている。そこへ inset を足すと、
**最後の入力欄とキーボードの間に、避ける相手の居ない空白が 1 本できる**
（`ReportContentSheet` / `EditDishReviewModal` はどちらも入力欄を持つ）。
入力欄を持たないシートはこの枝を踏まないので、判定はここに一本化してよい。

（#1629 で `MyDishOwnReviewSheet` だけ個別に直していたものを、#1742 でここへ集約した）
*/
export function useSheetBottomPadding(base = 0): number {
	const insets = useSafeAreaInsets();
	const isKeyboardVisible = useIsKeyboardVisible();

	return isKeyboardVisible ? base : base + insets.bottom;
}

/** キーボードが出ているか。イベント名の使い分けは `features/map/components/ReviewForm.tsx` と同じ */
function useIsKeyboardVisible(): boolean {
	const [isVisible, setIsVisible] = useState(false);

	useEffect(() => {
		const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
		const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

		const showSub = Keyboard.addListener(showEvent, () => setIsVisible(true));
		const hideSub = Keyboard.addListener(hideEvent, () => setIsVisible(false));

		return () => {
			showSub.remove();
			hideSub.remove();
		};
	}, []);

	return isVisible;
}
