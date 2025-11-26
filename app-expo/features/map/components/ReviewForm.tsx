import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
	View,
	Text,
	TextInput,
	StyleSheet,
	TouchableOpacity,
	Platform,
	Keyboard,
	Pressable,
	Animated,
	ActivityIndicator,
} from "react-native";
import { Star, ChevronRight } from "lucide-react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { SupabaseRestaurants } from "@shared/converters/convert_restaurants";
import { InitialMediaPreview } from "./InitialMediaPreview";
import {
	getCurrencyCodeFromRestaurant,
	parseAmountString,
	resolveCurrencySymbol,
	toMinorAmountInteger,
} from "@/lib/googlePlaces";
import { useLocale } from "@/hooks/useLocale";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useAPICall } from "@/hooks/useAPICall";
import { useDishCategorySearch } from "@/hooks/useDishCategorySearch";
import { CreateDishDto, type CreateDishMediaDto, type CreateDishReviewDto } from "@shared/api/v1/dto";
import { useFileUploader } from "@/hooks/useFileUploader";
import type {
	CreateDishMediaResponse,
	CreateDishResponse,
	CreateDishReviewResponse,
	DishMediaEntry,
} from "@shared/api/v1/res";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { LegalDocument } from "@/features/settings/components/LegalDocument";
import { Dimensions } from "react-native";
import { MediaData, selectMedia } from "@/lib/mediaSelection";
import { DishCategorySearchForm } from "./DishCategorySearchForm";
import { Image } from "expo-image";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useProfileStore } from "@/features/profile/stores/useProfileStore";
import { useEnsureOwnProfileLoaded } from "@/features/profile/hooks/useEnsureOwnProfileLoaded";

interface ReviewFormProps {
	restaurant: SupabaseRestaurants;
	/** Initial price value */
	initialPrice?: string;
	/** Initial review text */
	initialReviewText?: string;
	/** Initial rating value */
	initialRating?: number;
	/** Called when user cancels */
	onCancel: () => void;
	/** Pre-filled media data (for no-media mode from Feed) */
	prefilledMedia?: DishMediaEntry["dish_media"] & { dish: DishMediaEntry["dish"] };
}

const { height } = Dimensions.get("window");

/**
 * Review form component that manages its own internal state to prevent
 * Japanese IME composition issues. Only communicates final values back to parent.
 *
 * Media selection is handled internally on mount:
 * - Shows loading spinner while selecting media
 * - Automatically closes modal on cancellation
 * - Shows error UI with retry button on failure
 */
export function ReviewForm({
	restaurant,
	initialPrice = "",
	initialReviewText = "",
	initialRating = 0,
	onCancel,
	prefilledMedia,
}: ReviewFormProps) {
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { uploadFile: mediaUploadFile } = useFileUploader();
	const { uploadFile: thumbnailUploadFile } = useFileUploader();
	const { createDishCategoryVariant } = useDishCategorySearch();
	const { showSnackbar } = useSnackbar();

	// #467 【設計】プロフィールをストアから取得（プロフィール画面を開かなくても利用可能）
	useEnsureOwnProfileLoaded();
	const profile = useProfileStore((state) => state.profile);

	// Media selection state
	const [mediaState, setMediaState] = useState<
		{ status: "loading" } | { status: "error"; error: string } | { status: "success"; media: MediaData }
	>({ status: "loading" });
	const mountedRef = useRef(true);

	// 料理カテゴリの状態管理
	const [dishCategoryName, setDishCategoryName] = useState(prefilledMedia?.dish.name ?? "");
	const [dishCategoryId, setDishCategoryId] = useState<string | null>(prefilledMedia?.dish.category_id ?? null);
	const [dishCategoryError, setDishCategoryError] = useState<string | null>(null);

	// Internal state - isolated from parent re-renders
	const [isProcessing, setIsProcessing] = useState(false);
	const [price, setPrice] = useState(initialPrice);
	const [reviewText, setReviewText] = useState(initialReviewText);
	const [rating, setRating] = useState(initialRating);
	const [selectedLegalDocument, setSelectedLegalDocument] = useState<"guidelines" | "copyright" | null>(null);

	const locale = useLocale();

	const currencyCode = useMemo(() => getCurrencyCodeFromRestaurant(restaurant), [restaurant]);
	const currencySymbol = useMemo(() => resolveCurrencySymbol(currencyCode, locale), [currencyCode, locale]);
	// price は、小数点を含めた文字列として管理しているため、対象通貨での minorUnit(桁数) に基づいて整数変換を行う
	const parsedPrice = useMemo(
		() => parseAmountString(price) && toMinorAmountInteger(parseAmountString(price), currencyCode),
		[price, currencyCode],
	);

	const isValid =
		Number.isFinite(parsedPrice) &&
		parsedPrice > 0 &&
		reviewText.trim() &&
		rating > 0 &&
		dishCategoryName.trim() &&
		!!dishCategoryId;

	// useBlurModal for dish category selection
	const {
		BlurModal: DishCategoryModal,
		open: openDishCategoryModal,
		close: closeDishCategoryModal,
	} = useBlurModal({
		keyboardVerticalOffset: Platform.OS === "ios" ? 0 : 0,
		dismissKeyboardFirst: true,
	});

	// useBlurModal for legal documents
	const {
		BlurModal: LegalDocumentModal,
		open: openLegalDocumentModal,
		close: closeLegalDocumentModal,
	} = useBlurModal({ intensity: 100 });

	// マウント時にメディア選択を実行
	useEffect(() => {
		const handleSetMediaState = async () => {
			if (!prefilledMedia || !mountedRef.current) return;
			try {
				const mediaUrl = prefilledMedia.mediaUrl;
				if (prefilledMedia.media_type === "image") {
					setMediaState({ status: "loading" });
					mediaUrl && (await Image.prefetch(mediaUrl));
				}
				const thumbnailUrl = prefilledMedia.thumbnailImageUrl;
				thumbnailUrl && (await Image.prefetch(thumbnailUrl));
				// 既存メディアをプレビュー用のMediaDataに変換
				setMediaState({
					status: "success",
					media: {
						type: prefilledMedia.media_type as CreateDishMediaDto["mediaType"],
						uri: mediaUrl,
						// 【設計】prefilledMedia が指定されている場合は、mimeType は利用しないので適当に設定
						mimeType: prefilledMedia.media_type,
						thumbnailUri: thumbnailUrl,
					},
				});
			} catch (error) {
				setMediaState({ status: "error", error: i18n.t("Map.media.mediaSelectionError") });
			}
		};

		let cancelled = false;

		const handleMediaSelection = async () => {
			try {
				const result = await selectMedia(["images", "videos"], { shouldGenerateThumbnail: true });

				// Guard against setState on unmounted component
				if (cancelled || !mountedRef.current) return;

				if (!result.success || result.media === undefined) {
					// Handle cancellation - close modal automatically
					if (result.error === "cancelled") {
						onCancel();
						return;
					}

					// Handle other errors
					let errorMessage = i18n.t("Map.media.mediaSelectionError");
					switch (result.error) {
						case "permission_denied":
							errorMessage = i18n.t("Map.media.permissionDenied");
							break;
						case "video_too_long":
							errorMessage = i18n.t("Map.media.videoTooLong");
							break;
						case "thumbnail_failed":
							errorMessage = i18n.t("Map.media.thumbnailFailed");
							break;
					}

					setMediaState({ status: "error", error: errorMessage });
					return;
				}

				// Success - set media and show form
				setMediaState({ status: "success", media: result.media });
				lightImpact(); // Haptic feedback on success
			} catch (error) {
				if (cancelled || !mountedRef.current) return;
				setMediaState({ status: "error", error: i18n.t("Map.media.mediaSelectionError") });
			}
		};

		// #400 【設計】prefilledMedia が指定されている場合は、メディア選択をスキップしてプレビュー専用モードにする
		if (prefilledMedia) {
			handleSetMediaState();
			return () => {
				mountedRef.current = false;
			};
		} else {
			// 通常のメディア選択フロー
			handleMediaSelection();
			return () => {
				cancelled = true;
				mountedRef.current = false;
			};
		}
	}, [onCancel, lightImpact, prefilledMedia]);

	// Retry media selection
	const handleRetry = useCallback(() => {
		setMediaState({ status: "loading" });
		// Trigger re-selection by updating a key or re-running the effect
		// Since we can't easily re-trigger the effect, we'll call the function directly
		const retrySelection = async () => {
			try {
				const result = await selectMedia(["images", "videos"], { shouldGenerateThumbnail: true });

				if (!mountedRef.current) return;

				if (!result.success || result.media === undefined) {
					if (result.error === "cancelled") {
						onCancel();
						return;
					}

					let errorMessage = i18n.t("Map.media.mediaSelectionError");
					switch (result.error) {
						case "permission_denied":
							errorMessage = i18n.t("Map.media.permissionDenied");
							break;
						case "video_too_long":
							errorMessage = i18n.t("Map.media.videoTooLong");
							break;
						case "thumbnail_failed":
							errorMessage = i18n.t("Map.media.thumbnailFailed");
							break;
					}

					setMediaState({ status: "error", error: errorMessage });
					return;
				}

				setMediaState({ status: "success", media: result.media });
				lightImpact();
			} catch (error) {
				if (!mountedRef.current) return;
				setMediaState({ status: "error", error: i18n.t("Map.media.mediaSelectionError") });
			}
		};

		retrySelection();
	}, [onCancel, lightImpact]);

	// Animated height for InitialMediaPreview
	// 画面全体の高さ - フォーム部分の高さ - ボタン部分の高さ - 同意メッセージ - バッファ
	const mediaHeight = useMemo(() => height - 370 - 60 - 36 - 120, []);
	const mediaHeightAnim = useRef(new Animated.Value(mediaHeight)).current;
	const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

	// Keyboard event handlers for animation
	useEffect(() => {
		const keyboardShowListener = Keyboard.addListener(
			Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
			() => {
				setIsKeyboardVisible(true);
				Animated.timing(mediaHeightAnim, {
					toValue: 100, // Reduced height
					duration: 250,
					useNativeDriver: false,
				}).start();
			},
		);

		const keyboardHideListener = Keyboard.addListener(
			Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
			() => {
				setIsKeyboardVisible(false);
				Animated.timing(mediaHeightAnim, {
					toValue: mediaHeight,
					duration: 250,
					useNativeDriver: false,
				}).start();
			},
		);

		return () => {
			keyboardShowListener.remove();
			keyboardHideListener.remove();
		};
	}, [mediaHeightAnim]);

	// DishCategoryModal が開かれたときの初期化処理
	const onDishCategoryModalMount = useCallback(() => {
		setDishCategoryId(null);
		setDishCategoryName("");
		setDishCategoryError(null);
	}, []);

	// DishCategoryModal が閉じられたときの処理: dishCategoryNameを受け取り、存在しなければ新規作成
	const onDishCategoryModalUnmmount = useCallback(
		async (dishCategoryName: string) => {
			if (!dishCategoryName.trim()) return;
			setIsProcessing(true);
			try {
				const createdCategory = await createDishCategoryVariant(dishCategoryName.trim());
				setDishCategoryId(createdCategory.id);
			} catch (error: any) {
				// POSTエラー時はインラインエラー表示
				const errorMessage = i18n.t("Map.errors.dishCategoryNotFound");
				setDishCategoryError(errorMessage);
				return;
			} finally {
				setDishCategoryName(dishCategoryName.trim());
				setIsProcessing(false);
			}
		},
		[dishCategoryName, createDishCategoryVariant],
	);

	// DishCategoryAutocomplete 候補選択時のハンドラ: dishCategoryIdを設定
	const handleDishCategorySelect = useCallback(
		(suggestion: { dishCategoryId: string; label: string }) => {
			setDishCategoryId(suggestion.dishCategoryId);
			setDishCategoryName(suggestion.label);
			logFrontendEvent({
				event_name: "dish_category_selected",
				error_level: "log",
				payload: { dishCategoryId: suggestion.dishCategoryId, label: suggestion.label },
			});
			closeDishCategoryModal();
		},
		[logFrontendEvent, closeDishCategoryModal],
	);

	const handleSubmit = useCallback(async () => {
		if (!isValid || isProcessing || mediaState.status !== "success") return;

		mediumImpact();
		setIsProcessing(true);
		setDishCategoryError(null);

		try {
			// #400 【設計】メディアなしモード（prefilledMedia指定時）では、新規メディアアップロード処理をスキップする
			let dish_media: DishMediaEntry["dish_media"];
			let dish: DishMediaEntry["dish"];
			if (!prefilledMedia) {
				if (mediaState.media.durationSec === undefined && mediaState.media.type === "video") {
					logFrontendEvent({
						event_name: "video_duration_missing",
						error_level: "error",
						payload: { media: mediaState.media },
					});
					throw new Error(i18n.t("errors.videoProcessingFailed"));
				}

				const createDishResponse = await callBackend<CreateDishDto, CreateDishResponse>("v1/dishes", {
					method: "POST",
					requestPayload: {
						restaurantId: restaurant.id,
						dishCategoryId: dishCategoryId,
					},
				});
				dish = {
					...createDishResponse,
					reviewCount: 1,
					averageRating: rating,
				};

				// dish-media.media_path をアップロード
				const mediaPath = await mediaUploadFile(mediaState.media.uri, {
					mimeType: mediaState.media.mimeType,
					baseFileName: `${dish.id}-media`,
				});
				// dish-media.thumbnail_path をアップロード
				let thumbnailPath = mediaPath; // 画像の場合は mediaPath と同じにする
				if (mediaState.media.type === "video") {
					if (!mediaState.media.thumbnailUri) throw new Error("Missing thumbnail for video");
					thumbnailPath = await thumbnailUploadFile(mediaState.media.thumbnailUri, {
						mimeType: "image/jpeg",
						baseFileName: `${dish.id}-thumbnail`,
					});
				}

				/**
				 * Video のアップロードが完了してからでないと、
				 * transcoer API が失敗する可能性があるため、直列で実行する
				 */
				const createDishMediaResponse = await callBackend<CreateDishMediaDto, CreateDishMediaResponse>(
					"v1/dish-media",
					{
						method: "POST",
						requestPayload: {
							dishId: dish.id,
							mediaPath,
							thumbnailPath,
							mediaType: mediaState.media.type,
							videoDurationMs: mediaState.media.durationSec ? mediaState.media.durationSec * 1000 : undefined,
						},
					},
				);
				dish_media = {
					...createDishMediaResponse,
					isMine: true,
					isSaved: false,
					isLiked: false,
					likeCount: 0,
					mediaUrl: mediaState.media.uri,
					thumbnailImageUrl: mediaState.media.type === "video" ? mediaState.media.thumbnailUri! : mediaState.media.uri,
				};
			} else {
				// prefilleMedia が指定されている場合は、それを利用
				dish_media = prefilledMedia;
				dish = prefilledMedia.dish;
			}

			const createdDishReview = await callBackend<CreateDishReviewDto, CreateDishReviewResponse>("/v1/dish-reviews", {
				method: "POST",
				requestPayload: {
					dishId: dish_media.dish_id,
					comment: reviewText,
					languageCode: locale,
					priceCents: parsedPrice,
					currencyCode: currencyCode ?? undefined,
					rating,
					createdDishMediaId: dish_media.id,
				},
			});

			// #460 【設計】レビュー投稿後の即時反映：API から返却された DishReview をストアに反映
			const { upsertDishMediaEntries, updateReviewIdsByKey } = useDishMediaEntriesStore.getState();
			upsertDishMediaEntries([
				{
					restaurant,
					dish,
					dish_media,
					dish_reviews: [
						{
							...createdDishReview,
							// #467 【設計】プロフィールストアから username を取得（プロフィール画面を開かなくても利用可能）
							username: profile?.username ?? "me",
							isLiked: false,
							likeCount: 0,
						},
					],
				},
			]);
			updateReviewIdsByKey("reviews", (prev) => [String(createdDishReview.id), ...prev]);

			logFrontendEvent({
				event_name: "dish_review_submitted",
				error_level: "log",
				payload: { restaurantId: restaurant?.id, rating, parsedPrice },
			});

			showSnackbar(i18n.t("Map.alerts.reviewSuccess"));
			onCancel();
		} catch (error: any) {
			logFrontendEvent({
				event_name: "dish_review_submission_failed",
				error_level: "error",
				payload: { restaurantId: restaurant?.id, error: error?.message },
			});
			showSnackbar(i18n.t("Map.errors.reviewSubmitFailed"));
		} finally {
			setIsProcessing(false);
		}
	}, [
		reviewText,
		isValid,
		isProcessing,
		rating,
		mediaState,
		dishCategoryId,
		dishCategoryName,
		createDishCategoryVariant,
		callBackend,
		logFrontendEvent,
		onCancel,
		restaurant,
		locale,
		currencyCode,
		mediaUploadFile,
		thumbnailUploadFile,
		mediumImpact,
		prefilledMedia,
		showSnackbar,
	]);

	// Legal ドキュメント表示用のハンドラ
	const handleOpenLegalDocument = useCallback(
		(documentType: "guidelines" | "copyright") => {
			setSelectedLegalDocument(documentType);
			openLegalDocumentModal();
		},
		[openLegalDocumentModal],
	);

	const handleCancel = useCallback(() => {
		onCancel();
	}, [onCancel]);

	// Error state
	if (mediaState.status === "error") {
		return (
			<View style={styles.centeredContainer}>
				<Card style={styles.errorCard}>
					<Text style={styles.errorTitle}>{i18n.t("Map.media.mediaSelectionFailed")}</Text>
					<Text style={styles.errorMessage}>{mediaState.error}</Text>
					<View style={styles.errorButtons}>
						<PrimaryButton label={i18n.t("Common.retry")} onPress={handleRetry} style={{ flex: 1 }} borderRadius={8} />
						<PrimaryButton
							label={i18n.t("Common.close")}
							onPress={handleCancel}
							style={{ flex: 1, backgroundColor: "#6B7280" }}
							borderRadius={8}
						/>
					</View>
				</Card>
			</View>
		);
	}

	return (
		<>
			<Animated.View style={{ height: mediaHeightAnim }}>
				{mediaState.status === "loading" ? (
					<View style={styles.loadingContainer}>
						<ActivityIndicator size="large" color="#007AFF" />
						<Text style={styles.loadingText}>{i18n.t("Map.media.loadingMedia")}</Text>
					</View>
				) : (
					<InitialMediaPreview media={mediaState.media} />
				)}
			</Animated.View>
			<Card style={{ gap: 16 }}>
				{/* レビュー入力 */}
				<TextInput
					style={[styles.textInput, styles.textArea]}
					placeholder={i18n.t("Map.placeholders.enterReview")}
					value={reviewText}
					onChangeText={setReviewText}
					multiline
					numberOfLines={4}
					textAlignVertical="top"
				/>

				{/* 価格入力 行 */}
				<View style={styles.inputRow}>
					<Text style={styles.inputRowLabel}>{i18n.t("Map.placeholders.enterPrice")}</Text>
					{currencySymbol ? (
						<View style={styles.priceInputContainer}>
							<Text style={styles.currencySymbol}>{currencySymbol}</Text>
							<TextInput
								style={[styles.textInput, styles.priceInput]}
								placeholder={"0"}
								value={price}
								onChangeText={setPrice}
								keyboardType="numeric"
							/>
						</View>
					) : (
						<TextInput
							style={[styles.textInput, styles.priceInputSmall]}
							placeholder={"0"}
							value={price}
							onChangeText={setPrice}
							keyboardType="numeric"
						/>
					)}
				</View>

				{/* 料理カテゴリ選択 Pressable 行 */}
				<Pressable
					style={styles.selectRow}
					onPress={openDishCategoryModal}
					disabled={!!prefilledMedia} // #400 【設計】prefilledMedia が指定されている場合は、料理カテゴリ選択を無効化
					accessibilityRole="button"
					accessibilityLabel={i18n.t("Map.actions.selectDishCategory")}>
					<Text style={[styles.selectRowText, dishCategoryName ? { color: "#000", fontWeight: "600" } : {}]}>
						{dishCategoryName || i18n.t("Map.actions.selectDishCategory")}
					</Text>
					<ChevronRight size={20} color="#666" />
				</Pressable>
				{dishCategoryError && (
					<Text style={styles.errorText} accessibilityLiveRegion="polite">
						{dishCategoryError}
					</Text>
				)}

				{/* 評価入力 行 */}
				<View style={styles.inputRow}>
					<Text style={styles.inputRowLabel}>{i18n.t("Map.placeholders.enterReview")}</Text>
					<View style={styles.ratingInput}>
						{[1, 2, 3, 4, 5].map((star) => (
							<TouchableOpacity key={star} onPress={() => setRating(star)}>
								<Star size={24} color="#FFD700" fill={star <= rating ? "#FFD700" : "transparent"} />
							</TouchableOpacity>
						))}
					</View>
				</View>

				{/* 同意メッセージ */}
				<Text style={styles.consentText}>
					{i18n.t("Map.consent_review_prefix")}
					<Text style={styles.consentLink} onPress={() => handleOpenLegalDocument("guidelines")}>
						{i18n.t("Map.consent_review_guidelines")}
					</Text>
					{i18n.t("Map.consent_review_and")}
					<Text style={styles.consentLink} onPress={() => handleOpenLegalDocument("copyright")}>
						{i18n.t("Map.consent_review_copyright")}
					</Text>
					{i18n.t("Map.consent_review_suffix")}
				</Text>
			</Card>

			<PrimaryButton
				label={i18n.t("Common.post")}
				onPress={handleSubmit}
				disabled={isProcessing || !isValid}
				style={{ marginHorizontal: 16 }}
			/>

			{/* DishCategoryAutocomplete Modal */}
			<DishCategoryModal>
				<DishCategorySearchForm
					onSuggestionSelect={handleDishCategorySelect}
					onMount={onDishCategoryModalMount}
					onUnmount={onDishCategoryModalUnmmount}
					testID="dish-category-search"
				/>
			</DishCategoryModal>

			{/* Legal ドキュメントモーダル */}
			<LegalDocumentModal>
				{selectedLegalDocument && <LegalDocument documentType={selectedLegalDocument} />}
			</LegalDocumentModal>
		</>
	);
}

const styles = StyleSheet.create({
	centeredContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		padding: 16,
		minHeight: 400,
	},
	loadingContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	loadingText: {
		marginTop: 16,
		fontSize: 16,
		color: "#666",
	},
	errorCard: {
		padding: 24,
		alignItems: "center",
		gap: 16,
		width: "100%",
	},
	errorTitle: {
		fontSize: 18,
		fontWeight: "600",
		color: "#DC2626",
		textAlign: "center",
	},
	errorMessage: {
		fontSize: 14,
		color: "#666",
		textAlign: "center",
		lineHeight: 20,
	},
	errorButtons: {
		flexDirection: "row",
		gap: 12,
		width: "100%",
		marginTop: 8,
	},
	inputLabel: {
		fontSize: 16,
		fontWeight: "600",
		color: "#000",
		marginBottom: 8,
	},
	textInput: {
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
	selectRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		height: 48,
	},
	selectRowText: {
		fontSize: 14,
		color: "#666",
		flex: 1,
	},
	inputRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		height: 48,
	},
	inputRowLabel: {
		fontSize: 14,
		color: "#666",
		flex: 1,
	},
	ratingInput: {
		flexDirection: "row",
		gap: 4,
		alignItems: "center",
	},
	priceInputContainer: {
		flexDirection: "row",
		alignItems: "center",
		borderRadius: 8,
		minWidth: 120,
	},
	currencySymbol: {
		fontSize: 16,
		fontWeight: "600",
		color: "#666",
		minWidth: 24,
		paddingLeft: 8,
	},
	priceInput: {
		flex: 1,
		paddingLeft: 4,
		paddingRight: 12,
		width: 80,
		textAlign: "right",
	},
	priceInputSmall: {
		minWidth: 120,
		paddingHorizontal: 12,
		paddingVertical: 8,
		textAlign: "right",
	},
	errorText: {
		color: "#DC2626",
		fontSize: 12,
		paddingHorizontal: 4,
	},
	consentText: {
		fontSize: 12,
		color: "#6B7280",
		textAlign: "left",
		lineHeight: 18,
	},
	consentLink: {
		color: "#2563EB",
		textDecorationLine: "underline",
	},
});
