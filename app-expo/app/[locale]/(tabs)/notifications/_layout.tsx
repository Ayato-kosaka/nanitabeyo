import { Stack } from "expo-router";
import { useThemedStackScreenOptions } from "@/hooks/useThemedStackScreenOptions";

export default function NotificationStackLayout() {
	// #1629【27】遷移中・モーダル背後に react-navigation 既定の明るいグレーが出るのを防ぐ
	const screenOptions = useThemedStackScreenOptions({ headerShown: false });
	return <Stack screenOptions={screenOptions} />;
}
