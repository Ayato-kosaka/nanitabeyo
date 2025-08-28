import React, { useState, useCallback } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from "react-native";
import { Star } from "lucide-react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";

interface ReviewFormProps {
	/** Initial price value */
	initialPrice?: string;
	/** Initial review text */
	initialReviewText?: string;
	/** Initial rating value */
	initialRating?: number;
	/** Called when user submits the form */
	onSubmit: (data: { price: string; reviewText: string; rating: number }) => void;
	/** Called when user cancels */
	onCancel: () => void;
	/** Whether form is processing */
	isProcessing?: boolean;
}

/**
 * Review form component that manages its own internal state to prevent
 * Japanese IME composition issues. Only communicates final values back to parent.
 */
export function ReviewForm({
	initialPrice = "",
	initialReviewText = "",
	initialRating = 5,
	onSubmit,
	onCancel,
	isProcessing = false,
}: ReviewFormProps) {
	// Internal state - isolated from parent re-renders
	const [price, setPrice] = useState(initialPrice);
	const [reviewText, setReviewText] = useState(initialReviewText);
	const [rating, setRating] = useState(initialRating);

	const handleSubmit = useCallback(() => {
		onSubmit({ price, reviewText, rating });
	}, [price, reviewText, rating, onSubmit]);

	const handleCancel = useCallback(() => {
		onCancel();
	}, [onCancel]);

	const isValid = price.trim() && reviewText.trim();

	return (
		<>
			<Card>
				<Text style={styles.inputLabel}>{i18n.t("Map.inputs.price")}</Text>
				<TextInput
					style={styles.textInput}
					placeholder={i18n.t("Map.placeholders.enterPrice")}
					value={price}
					onChangeText={setPrice}
					keyboardType="numeric"
				/>
			</Card>

			<Card>
				<Text style={styles.inputLabel}>{i18n.t("Map.inputs.rating")}</Text>
				<View style={styles.ratingInput}>
					{[1, 2, 3, 4, 5].map((star) => (
						<TouchableOpacity key={star} onPress={() => setRating(star)}>
							<Star size={32} color="#FFD700" fill={star <= rating ? "#FFD700" : "transparent"} />
						</TouchableOpacity>
					))}
				</View>
			</Card>

			<Card>
				<Text style={styles.inputLabel}>{i18n.t("Map.inputs.comment")}</Text>
				<TextInput
					style={[styles.textInput, styles.textArea]}
					placeholder={i18n.t("Map.placeholders.enterReview")}
					value={reviewText}
					onChangeText={setReviewText}
					multiline
					numberOfLines={4}
					textAlignVertical="top"
				/>
			</Card>

			<PrimaryButton
				label={i18n.t("Common.post")}
				onPress={handleSubmit}
				disabled={isProcessing || !isValid}
				style={{ marginHorizontal: 16 }}
			/>
		</>
	);
}

const styles = StyleSheet.create({
	inputLabel: {
		fontSize: 16,
		fontWeight: "600",
		color: "#000",
		marginBottom: 8,
	},
	textInput: {
		borderWidth: 1,
		borderColor: "#E5E5E5",
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 12,
		fontSize: 16,
		color: "#000",
	},
	textArea: {
		height: 100,
		textAlignVertical: "top",
	},
	ratingInput: {
		flexDirection: "row",
		gap: 8,
	},
});
