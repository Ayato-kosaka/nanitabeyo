import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActionSheetProvider } from "@expo/react-native-action-sheet";

export default function RootLayout() {
	return (
		<SafeAreaProvider>
			<ActionSheetProvider>
				<Stack screenOptions={{ header: () => null }} />
			</ActionSheetProvider>
		</SafeAreaProvider>
	);
}
