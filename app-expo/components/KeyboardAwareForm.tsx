/*
#1369 【設計】`features/blurModal/components/` から中立な置き場（components/）へ «移設だけ» した。
実装は当時のまま変えていない。

利用者は `features/profile/components/ProfileEditForm.tsx` の 1 つだけで、blurModal の配下に
在り続けると #1350 の最終目的（BlurModal の削除）でこのファイルの行き場を都度考えることになる。

## ルート化後もキーボード回避が要る理由
モーダル時代は useBlurModal 側の KeyboardAvoidingView と «二重» に掛かっていたが、
#1369 で編集画面をルートへ移した結果、ツリーに残る KeyboardAvoidingView はここの 1 つだけになった。
`app/[locale]/(tabs)/profile/edit.tsx` は KeyboardAvoidingView も ScrollView も持たない
（両方をこのコンポーネントが持つため）。つまりここを外すと «回避が 0 個» になるので、
不要になったわけではない。加えてフォーカスした入力欄まで運ぶスクロール（scrollToField）は
KeyboardAvoidingView では代替できない、このコンポーネント固有の役割である。
*/
import React, { useCallback, useRef } from "react";
import { Keyboard } from "react-native";
import { StyleSheet, ScrollView, View, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";

export function KeyboardAwareForm<K extends readonly string[]>({
	fields,
	bottomNode,
	children,
}: {
	fields: K;
	bottomNode?: React.ReactNode;
	children: (helpers: {
		recordY: (key: K[number]) => (e: any) => void;
		onFocusFactory: (key: K[number]) => () => void;
	}) => React.ReactNode;
}) {
	type FieldKey = K[number];

	// Safe Area を考慮したインセット
	const insets = useSafeAreaInsets();
	/*
	#1750 【バグ】**保存ボタンが画面の外にあって押せなかった。**

	旧実装は器の高さを `height: frame.height - 100` と «窓の高さから当てずっぽうの 100px を引く»
	で決めていた。`useSafeAreaFrame()` が返すのは **窓全体**の高さなので、この器が実際に置かれる
	領域（窓 − ステータスバー − ScreenHeader − タブバー − ナビゲーションバー）より必ず高くなる。
	はみ出した分は下へ流れ、器の一番下にある `bottomNode`（＝ 保存ボタン）が
	**タブバーの裏か画面の外**に来る。

	実機ログ（dev 2026-08-31 17:06-17:07 UTC / commit 6d9b89d8）:

	    profile_edit_started
	    profile_avatar_selected {uriScheme:"file", mimeType:"image/jpeg"}  ← 画像は選べている
	    profile_edit_screen_back_pressed                                    ← 保存せず戻っている

	これが 2 回続いており、`profile_edit_saved` は 1 件も無い。つまり
	«画像が上がらない» の正体は «保存ボタンを押せない» だった。

	表示名だけの保存が通っていたのは、**キーボードを開くと** KeyboardAvoidingView が
	器を縮めてボタンが画面内へ上がってきたためである。画像を選ぶだけならキーボードを
	開かないので、ボタンは画面の外に居続ける。

	直し方は #1629 と同じ。**器の高さを計算しない**（`flex: 1` で親に合わせる）。
	キーボード回避も `KeyboardAvoidingView` をやめ、キーボードの高さだけを見る
	`useKeyboardInset()` で器の下に余白を空ける。`useKeyboardInset` の JSDoc が
	«高さを固定した親（height: frame.height 等）の中では前提が崩れる» と名指ししている、
	まさにその形がここに残っていた。

	⚠️ ここへ `height` / `maxHeight` を戻さないこと。器の高さは親が決める。
	*/
	const keyboardInset = useKeyboardInset();

	const scrollRef = useRef<ScrollView>(null);

	// ScrollView 直下の Y 座標を onLayout で保存
	const fieldYRef = useRef<Record<FieldKey, number>>(
		fields.reduce((prev, k) => ({ ...prev, [k]: 0 }), {} as Record<FieldKey, number>),
	);
	const recordY = useCallback(
		(key: FieldKey) => (e: any) => {
			fieldYRef.current[key] = e?.nativeEvent?.layout?.y ?? 0;
		},
		[],
	);

	// 指定フィールドへスクロール（キーボード表示を待ってから）
	const scrollToField = useCallback((key: FieldKey, padding = 16) => {
		const y = fieldYRef.current[key] ?? 0;
		// 行のラベル + 余白 + 入力欄の高さぶん手前で止める

		const run = () => {
			// レイアウト確定後にスクロール
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					scrollRef.current?.scrollTo({ y: Math.max(y - padding, 0), animated: true });
				});
			});
		};

		if (Platform.OS === "ios") {
			// iOS はキーボード開閉に合わせると安定
			const sub1 = Keyboard.addListener("keyboardWillShow", run);
			const sub2 = Keyboard.addListener("keyboardWillChangeFrame", run);
			// 既に開いている場合も考慮して即実行
			run();
			setTimeout(() => {
				sub1.remove();
				sub2.remove();
			}, 300);
		} else {
			// Android は rAF だけでだいたい安定
			run();
		}
	}, []);

	const onFocusFactory = useCallback((key: FieldKey) => () => scrollToField(key), [scrollToField]);

	return (
		/*
		#1750 器の高さは親に合わせる（`flex: 1`）。キーボードが出ている間はその高さぶん
		下を空けて器ごと縮めるので、**一番下の `bottomNode`（保存ボタン）は常に画面の中**に居る。
		*/
		<View style={[styles.container, keyboardInset > 0 ? { paddingBottom: keyboardInset } : null]}>
			<ScrollView
				ref={scrollRef}
				style={styles.scrollView}
				contentContainerStyle={[
					styles.contentContainer,
					// キーボードで隠れないように最小限の下パディングを確保
					{ paddingBottom: 24 + insets.bottom },
				]}
				keyboardShouldPersistTaps="handled"
				// iOS の自動インセット調整は避ける（SafeArea も キーボードぶんも自前で付与）。
				// #1750 上の paddingBottom で器ごと縮めているので、ここで足すと二重になる
				automaticallyAdjustContentInsets={false}
				automaticallyAdjustKeyboardInsets={false}>
				{children({ recordY, onFocusFactory })}
			</ScrollView>
			{bottomNode ? bottomNode : null}
		</View>
	);
}

const styles = StyleSheet.create({
	// #1750 高さを数えない。親（画面）が与えた領域をそのまま使う
	container: { flex: 1 },
	scrollView: { flex: 1 },
	contentContainer: {},
});
