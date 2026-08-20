import { Stack } from "expo-router";

export default function MyDishesStackLayout() {
	return (
		<Stack screenOptions={{ headerShown: false }}>
			<Stack.Screen name="index" />
			<Stack.Screen name="select-restaurant" />
			{/*
			 * #1396 フィルタ編集は **ルート**にする（設計書 (2/2) §8-5）。
			 * BlurModal（旧オーバーレイ）で出すと、Portal.Host が <Stack> を包んでいるため
			 * 開いたまま push した遷移先が下に潜る（#1364 で実測）。
			 */}
			<Stack.Screen name="filters" />
		</Stack>
	);
}
