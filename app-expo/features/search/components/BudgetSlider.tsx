import React from "react";
import { View, Text, PanResponder } from "react-native";
import { budgetOptions } from "@/features/search/constants";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";

// Slider component to choose budget range
export function BudgetSlider({
	budgetMin,
	budgetMax,
	setBudgetMin,
	setBudgetMax,
}: {
	budgetMin: number | null;
	budgetMax: number | null;
	setBudgetMin: (value: number | null) => void;
	setBudgetMax: (value: number | null) => void;
}) {
	const { selectionChanged } = useHaptics();

	const minIndex = budgetMin === null ? 0 : budgetOptions.findIndex((o) => o.value === budgetMin);
	const maxIndex =
		budgetMax === null ? budgetOptions.length - 1 : budgetOptions.findIndex((o) => o.value === budgetMax);

	const sliderWidth = 280;
	const thumbWidth = 24;
	const trackWidth = sliderWidth - thumbWidth;

	const minThumbPosition = (minIndex / (budgetOptions.length - 1)) * trackWidth;
	const maxThumbPosition = (maxIndex / (budgetOptions.length - 1)) * trackWidth;

	const createPanResponder = (isMin: boolean) =>
		PanResponder.create({
			onStartShouldSetPanResponder: () => true,
			onMoveShouldSetPanResponder: () => true,
			onPanResponderMove: (evt, gestureState) => {
				const newPosition = Math.max(0, Math.min(trackWidth, gestureState.moveX - 50));
				const newIndex = Math.round((newPosition / trackWidth) * (budgetOptions.length - 1));

				if (isMin) {
					if (newIndex <= maxIndex && newIndex >= 0 && newIndex !== minIndex) {
						selectionChanged();
						setBudgetMin(budgetOptions[newIndex].value);
					}
				} else {
					if (newIndex >= minIndex && newIndex < budgetOptions.length && newIndex !== maxIndex) {
						selectionChanged();
						setBudgetMax(budgetOptions[newIndex].value);
					}
				}
			},
		});

	const minPanResponder = createPanResponder(true);
	const maxPanResponder = createPanResponder(false);

	return (
		<View style={styles.sliderContainer}>
			<View style={styles.sliderTrack}>
				<View
					style={[
						styles.rangeTrack,
						{
							left: minThumbPosition,
							width: maxThumbPosition - minThumbPosition + thumbWidth,
						},
					]}
				/>
				<View
					style={[styles.sliderThumb, styles.rangeThumbMin, { left: minThumbPosition }]}
					{...minPanResponder.panHandlers}
				/>
				<View
					style={[styles.sliderThumb, styles.rangeThumbMax, { left: maxThumbPosition }]}
					{...maxPanResponder.panHandlers}
				/>
			</View>
			<View style={styles.sliderLabels}>
				<Text style={styles.sliderLabelLeft}>{i18n.t("Search.BudgetSlider.cheap")}</Text>
				<Text style={styles.sliderLabelRight}>{i18n.t("Search.BudgetSlider.expensive")}</Text>
			</View>
		</View>
	);
}

// Styles mirror the ones in the original screen
const styles = {
	sliderContainer: {
		width: 300,
		justifyContent: "center",
	},
	sliderTrack: {
		height: 6,
		backgroundColor: "#E5E7EB",
		borderRadius: 3,
		position: "relative",
		marginHorizontal: 16,
	},
	sliderThumb: {
		position: "absolute",
		width: 28,
		height: 28,
		backgroundColor: "#5EA2FF",
		borderRadius: 14,
		top: -11,
		borderWidth: 3,
		borderColor: "#FFFFFF",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.15,
		shadowRadius: 8,
		elevation: 6,
	},
	rangeTrack: {
		position: "absolute",
		height: 6,
		backgroundColor: "#5EA2FF",
		borderRadius: 3,
		top: 0,
	},
	rangeThumbMin: {
		backgroundColor: "#5EA2FF",
	},
	rangeThumbMax: {
		backgroundColor: "#5EA2FF",
	},
	sliderLabels: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginTop: 12,
		paddingHorizontal: 16,
	},
	sliderLabelLeft: {
		fontSize: 13,
		color: "#6B7280",
		fontWeight: "500",
	},
	sliderLabelRight: {
		fontSize: 13,
		color: "#6B7280",
		fontWeight: "500",
	},
} as const;
