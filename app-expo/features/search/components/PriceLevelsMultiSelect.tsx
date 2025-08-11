import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { priceLevelOptions } from "@/features/search/constants";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";

interface PriceLevelsMultiSelectProps {
	selectedPriceLevels: number[];
	onPriceLevelsChange: (priceLevels: number[]) => void;
}

export function PriceLevelsMultiSelect({ selectedPriceLevels, onPriceLevelsChange }: PriceLevelsMultiSelectProps) {
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
			<View style={styles.chipGrid}>
				{priceLevelOptions.map((option) => {
					const isSelected = selectedPriceLevels.includes(option.value);
					return (
						<TouchableOpacity
							key={option.value}
							style={[styles.chip, isSelected && styles.selectedChip]}
							onPress={() => togglePriceLevel(option.value)}>
							<Text style={styles.chipEmoji}>{option.icon}</Text>
							<Text style={[styles.chipText, isSelected && styles.selectedChipText]}>{i18n.t(option.label)}</Text>
						</TouchableOpacity>
					);
				})}
			</View>
		</View>
	);
}

const styles = {
	container: {
		width: "100%",
	},
	chipGrid: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 12,
		justifyContent: "center",
	},
	chip: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#F8F9FA",
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 24,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.1,
		shadowRadius: 4,
		elevation: 1,
		minWidth: 80,
		justifyContent: "center",
	},
	selectedChip: {
		backgroundColor: "#5EA2FF",
		shadowColor: "#5EA2FF",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 8,
		elevation: 4,
	},
	chipEmoji: {
		fontSize: 14,
		marginRight: 4,
	},
	chipText: {
		fontSize: 13,
		color: "#6B7280",
		fontWeight: "500",
		textAlign: "center",
	},
	selectedChipText: {
		color: "#FFF",
		fontWeight: "600",
	},
} as const;
