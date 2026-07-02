import { Stack } from "expo-router";

// deep link 時に Search Stack の戻り先として index を積む
export const unstable_settings = {
	initialRouteName: "index",
};

export default function SearchStackLayout() {
	return (
		<Stack screenOptions={{ headerShown: false }}>
			<Stack.Screen name="index" />
			<Stack.Screen name="topics" />
			<Stack.Screen name="dish-category-group-votes" />
			<Stack.Screen name="result" options={{ presentation: "transparentModal", headerShown: false }} />
		</Stack>
	);
}
