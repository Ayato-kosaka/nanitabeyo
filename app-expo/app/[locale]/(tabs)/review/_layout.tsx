import { Stack } from "expo-router";

export default function ReviewStackLayout() {
	return (
		<Stack screenOptions={{ headerShown: false }}>
			<Stack.Screen name="index" />
			<Stack.Screen name="selectRestaurant" />
			<Stack.Screen name="post/[id]" />
		</Stack>
	);
}
