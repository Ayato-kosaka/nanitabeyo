import React from "react";
import { View, Text, TouchableOpacity, TextStyle } from "react-native";
import { priceLevelOptions } from "@/features/search/constants";
import { useHaptics } from "@/hooks/useHaptics";
import { StyleSheet } from "react-native";
import { StyleProp } from "react-native";
import { ViewStyle } from "react-native";

interface PriceLevelsMultiSelectProps {
	selectedPriceLevels: number[];
	onPriceLevelsChange: (priceLevels: number[]) => void;
	customStyles?: {
		chipGrid?: StyleProp<ViewStyle>;
		chip?: StyleProp<ViewStyle>;
		selectedChip?: StyleProp<ViewStyle>;
		chipEmoji?: StyleProp<TextStyle>;
		chipText?: StyleProp<TextStyle>;
		selectedChipText?: StyleProp<TextStyle>;
	};
}

export function PriceLevelsMultiSelect({
	selectedPriceLevels,
	onPriceLevelsChange,
	customStyles,
}: PriceLevelsMultiSelectProps) {
	const { lightImpact } = useHaptics();

	const togglePriceLevel = (priceLevel: number) => {
		lightImpact();
		const isSelected = selectedPriceLevels.includes(priceLevel);
		if (isSelected) {
			// Remove if already selected
			onPriceLevelsChange(selectedPriceLevels.filter((level) => level !== priceLevel));
		} else {
			// Add if not selected
			onPriceLevelsChange([...selectedPriceLevels, priceLevel].sort());
		}
	};

	return (
		<View style={styles.container}>
			<View style={[customStyles?.chipGrid]}>
				{priceLevelOptions.map((option) => {
					const isSelected = selectedPriceLevels.includes(option.value);
					return (
						<TouchableOpacity
							key={option.value}
							style={[customStyles?.chip, isSelected && customStyles?.selectedChip]}
							onPress={() => togglePriceLevel(option.value)}>
							<Text style={[customStyles?.chipEmoji]}>{option.icon}</Text>
						</TouchableOpacity>
					);
				})}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		width: "100%",
	},
});
