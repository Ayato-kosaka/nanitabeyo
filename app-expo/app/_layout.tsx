import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActionSheetProvider } from "@expo/react-native-action-sheet";
import { GestureHandlerRootView } from "react-native-gesture-handler";

export default function RootLayout() {
	return (
		<SafeAreaProvider>
			<GestureHandlerRootView style={{ flex: 1 }}>
				<ActionSheetProvider>
					<Stack screenOptions={{ header: () => null }} />
				</ActionSheetProvider>
			</GestureHandlerRootView>
		</SafeAreaProvider>
	);
}
