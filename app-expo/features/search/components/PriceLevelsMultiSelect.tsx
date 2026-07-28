import React from "react";
import { View, StyleSheet, StyleProp, ViewStyle } from "react-native";
import { priceLevelOptions } from "@/features/search/constants";
import { useHaptics } from "@/hooks/useHaptics";
import { SelectableChip } from "@/features/search/components/SelectableChip";
import i18n from "@/lib/i18n";

interface PriceLevelsMultiSelectProps {
	selectedPriceLevels: (typeof priceLevelOptions)[number]["value"][];
	onPriceLevelsChange: (priceLevels: (typeof priceLevelOptions)[number]["value"][]) => void;
	customStyles?: {
		chipGrid?: StyleProp<ViewStyle>;
	};
	/** #934 【設計】チップ群のグループラベル(スクリーンリーダー向け。画面側のセクション見出しと合わせる) */
	groupAccessibilityLabel?: string;
}

export function PriceLevelsMultiSelect({
	selectedPriceLevels,
	onPriceLevelsChange,
	customStyles,
	groupAccessibilityLabel,
}: PriceLevelsMultiSelectProps) {
	const { lightImpact } = useHaptics();

	const togglePriceLevel = (priceLevel: (typeof priceLevelOptions)[number]["value"]) => {
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
			{/* #934 【設計】複数選択チップのグループ。RN の AccessibilityRole に group 相当が無いため
			    accessibilityLabel のみでグループの意味付けを行う(各チップ自体は role="checkbox" を持つ) */}
			<View style={[customStyles?.chipGrid]} accessibilityLabel={groupAccessibilityLabel}>
				{priceLevelOptions.map((option) => {
					const isSelected = selectedPriceLevels.includes(option.value);
					return (
						<SelectableChip
							key={option.value}
							role="checkbox"
							selected={isSelected}
							label={i18n.t(option.label)}
							onPress={() => togglePriceLevel(option.value)}
							testID={`search-price-level-${option.value}`}
						/>
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
