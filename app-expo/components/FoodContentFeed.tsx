import React, { useState, useRef, useEffect } from "react";
import { StyleSheet, Animated, Dimensions } from "react-native";
import { PanGestureHandler } from "react-native-gesture-handler";
import FoodContentScreen from "./FoodContentScreen";
import { useHaptics } from "@/hooks/useHaptics";
import { DishMediaEntry } from "@shared/api/v1/res";

const { height } = Dimensions.get("window");

interface FoodContentFeedProps {
	items: DishMediaEntry[];
	initialIndex?: number;
	onIndexChange?: (index: number) => void;
}

export default function FoodContentFeed({ items, initialIndex = 0, onIndexChange }: FoodContentFeedProps) {
	const [currentIndex, setCurrentIndex] = useState(initialIndex);
	const translateY = useRef(new Animated.Value(0)).current;
	const { selectionChanged } = useHaptics();

	const updateIndex = (newIndex: number) => {
		selectionChanged();
		setCurrentIndex(newIndex);
		onIndexChange?.(newIndex);
	};

	const onGestureEvent = Animated.event([{ nativeEvent: { translationY: translateY } }], { useNativeDriver: true });

	const onHandlerStateChange = (event: any) => {
		if (event.nativeEvent.oldState === 4) {
			const { translationY } = event.nativeEvent;

			if (translationY < -height * 0.2 && currentIndex < items.length - 1) {
				updateIndex(currentIndex + 1);
			} else if (translationY > height * 0.2 && currentIndex > 0) {
				updateIndex(currentIndex - 1);
			}

			Animated.timing(translateY, {
				toValue: 0,
				useNativeDriver: true,
			}).start();
		}
	};

	const currentItem = items[currentIndex];

	if (!currentItem) {
		return null;
	}

	return (
		<PanGestureHandler onGestureEvent={onGestureEvent} onHandlerStateChange={onHandlerStateChange}>
			<Animated.View
				style={[
					styles.container,
					{
						transform: [{ translateY }],
					},
				]}>
				<FoodContentScreen item={currentItem} />
			</Animated.View>
		</PanGestureHandler>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#000",
	},
});
