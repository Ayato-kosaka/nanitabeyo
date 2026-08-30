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
import { StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";

export function KeyboardAwareForm<K extends readonly string[]>({
	fields,
	keyboardVerticalOffset = 0,
	bottomNode,
	children,
}: {
	fields: K;
	keyboardVerticalOffset?: number;
	bottomNode?: React.ReactNode;
	children: (helpers: {
		recordY: (key: K[number]) => (e: any) => void;
		onFocusFactory: (key: K[number]) => () => void;
	}) => React.ReactNode;
}) {
	type FieldKey = K[number];

	// Safe Area を除いたフレームの高さ
	const frame = useSafeAreaFrame();
	// Safe Area を考慮したインセット
	const insets = useSafeAreaInsets();

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
		// キーボードが表示された場合に高さを自動調整
		<KeyboardAvoidingView
			style={{ height: frame.height - 100 }}
			behavior={Platform.select({ ios: "padding", android: "height" })}
			keyboardVerticalOffset={keyboardVerticalOffset}>
			<ScrollView
				ref={scrollRef}
				style={styles.scrollView}
				contentContainerStyle={[
					styles.contentContainer,
					// キーボードで隠れないように最小限の下パディングを確保
					{ paddingBottom: 24 + insets.bottom },
				]}
				keyboardShouldPersistTaps="handled"
				// iOS の自動インセット調整は避ける（SafeAreaは自前で付与）
				automaticallyAdjustContentInsets={false}>
				{children({ recordY, onFocusFactory })}
			</ScrollView>
			{bottomNode ? bottomNode : null}
		</KeyboardAvoidingView>
	);
}

const styles = StyleSheet.create({
	scrollView: { flex: 1 },
	contentContainer: {},
});
