import { Stack } from "expo-router";

export default function SearchStackLayout() {
	return (
		<Stack screenOptions={{ headerShown: false }}>
			<Stack.Screen name="index" />
			<Stack.Screen name="topics" />
			<Stack.Screen name="feed" options={{ presentation: "transparentModal", headerShown: false }} />
		</Stack>
	);
}
