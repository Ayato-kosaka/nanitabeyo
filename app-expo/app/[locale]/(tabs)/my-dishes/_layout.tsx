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
			{/*
			 * #1397 (PR4/5) 全画面 Feed も **ルート**にする（設計 (2/2) §9-2）。
			 * 先例は `app/[locale]/(tabs)/notifications/feed.tsx`（タブの Stack の中のフィードルート）。
			 * presentation は指定しない（＝既定の card）ので、Android の戻る・ブラウザバック・
			 * URL 共有はすべて Navigator の既定挙動で賄える。
			 */}
			<Stack.Screen name="feed" />
		</Stack>
	);
}
