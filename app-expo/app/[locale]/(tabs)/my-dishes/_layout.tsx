import { Stack } from "expo-router";

export default function MyDishesStackLayout() {
	return (
		<Stack screenOptions={{ headerShown: false }}>
			<Stack.Screen name="index" />
			<Stack.Screen name="select-restaurant" />
		</Stack>
	);
}
