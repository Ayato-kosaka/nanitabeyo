import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
	View,
	Text,
	TextInput,
	StyleSheet,
	TouchableOpacity,
	Platform,
	Pressable,
	ActivityIndicator,
	KeyboardAvoidingView,
} from "react-native";
import { Star, ChevronRight, UtensilsCrossed, CircleDollarSign } from "lucide-react-native";
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
import { SafeAreaView } from "react-native-safe-area-context";
import { mapReviewsKey } from "../constants";
import { ScrollView } from "react-native-gesture-handler";

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
			// #511 【設計】mediaUrl が null の場合（処理中）は早期 return
			const mediaUrl = prefilledMedia.mediaUrl;
			if (!mediaUrl) return;
			try {
				if (prefilledMedia.media_type === "image") {
					setMediaState({ status: "loading" });
					await Image.prefetch(mediaUrl);
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
	const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

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
					// #511 ローカルの uri をセットして読み込むため、処理済み状態にする
					media_processing_status: "completed",
					thumbnail_processing_status: "completed",
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
			const { upsertDishMediaEntries, updateReviewIdsByKey, updateMediaIdsByKey } = useDishMediaEntriesStore.getState();
			upsertDishMediaEntries([
				{
					restaurant,
					dish,
					dish_media,
					dish_reviews: [
						{
							...createdDishReview,
							// #467 【設計】プロフィールストアから display_name を取得（プロフィール画面を開かなくても利用可能）
							username: profile?.display_name ?? "me",
							isLiked: false,
							likeCount: 0,
						},
					],
				},
			]);
			updateReviewIdsByKey("reviews", (prev) => [String(createdDishReview.id), ...prev]);
			if (!prefilledMedia)
				updateMediaIdsByKey(mapReviewsKey(restaurant.id), (prev) => [String(dish_media.id), ...prev]);

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
						<TouchableOpacity style={styles.secondaryButton} onPress={handleCancel}>
							<Text style={styles.secondaryButtonText}>{i18n.t("Common.close")}</Text>
						</TouchableOpacity>
						<TouchableOpacity style={styles.primaryButton} onPress={handleRetry}>
							<Text style={styles.primaryButtonText}>{i18n.t("Common.retry")}</Text>
						</TouchableOpacity>
					</View>
				</Card>
			</View>
		);
	}

	return (
		<KeyboardAvoidingView
			style={styles.keyboardAvoidingView}
			behavior={Platform.OS === "ios" ? "padding" : "height"}
			keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}>
			<ScrollView
				style={styles.container}
				keyboardShouldPersistTaps="handled"
				contentContainerStyle={styles.scrollContent}>
				<View style={{ height: mediaHeight, marginTop: 16 }}>
					{mediaState.status === "loading" ? (
						<View style={styles.loadingContainer}>
							<ActivityIndicator size="large" color="#007AFF" />
							<Text style={styles.loadingText}>{i18n.t("Map.media.loadingMedia")}</Text>
						</View>
					) : (
						<InitialMediaPreview media={mediaState.media} />
					)}
				</View>
				<View style={styles.formContainer}>
					{/* 
					#644 【設計】レビュー入力フィールド仕様
					- 既存メディアに対するテキストレビュー追加モード
					- 短文 placeholder（豚骨スープが...）を使用
					- 100文字制限を適用
					- 文字数カウンタを表示
				*/}
					<View>
						<TextInput
							style={[styles.textInput, styles.textArea]}
							placeholderTextColor="#A0A0A0"
							placeholder={i18n.t("Map.placeholders.enterReviewShort")}
							value={reviewText}
							onChangeText={setReviewText}
							multiline
							numberOfLines={4}
							textAlignVertical="top"
							maxLength={100}
						/>
						<Text style={styles.characterCount}>
							{i18n.t("Review.characterCount", { current: reviewText.length, max: 100 })}
						</Text>
					</View>

					{/* 料理カテゴリ選択 Pressable 行 */}
					<Pressable
						style={styles.dishCategorySelectRow}
						onPress={openDishCategoryModal}
						disabled={!!prefilledMedia} // #400 【設計】prefilledMedia が指定されている場合は、料理カテゴリ選択を無効化
						accessibilityRole="button"
						accessibilityLabel={i18n.t("Map.actions.selectDishCategory")}>
						{/* #644 【UX】料理カテゴリラベルにアイコン追加 + prefilledMedia 時は「料理カテゴリ」に変更 */}
						<View style={styles.inputRowLabelWithIcon}>
							<UtensilsCrossed size={18} color="#6B7280" />
							<Text style={styles.inputRowLabel}>
								{prefilledMedia ? i18n.t("Map.labels.dishCategory") : i18n.t("Map.actions.selectDishCategory")}
							</Text>
						</View>
						<View style={styles.dishCategorySelectContent}>
							{dishCategoryName && (
								<Text style={styles.inputRowLabel}>{dishCategoryName || i18n.t("Map.actions.selectDishCategory")}</Text>
							)}
							{!prefilledMedia && <ChevronRight size={20} color="#666" />}
						</View>
					</Pressable>
					{dishCategoryError && (
						<Text style={styles.errorText} accessibilityLiveRegion="polite">
							{dishCategoryError}
						</Text>
					)}

					{/* 価格入力 行 */}
					<View style={styles.priceInputRow}>
						{/* #644 【UX】価格ラベルにアイコン追加 */}
						<View style={styles.inputRowLabelWithIcon}>
							<CircleDollarSign size={18} color="#6B7280" />
							<Text style={styles.inputRowLabel}>{i18n.t("Map.placeholders.enterPrice")}</Text>
						</View>
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

					{/* 評価入力 行 */}
					<View style={styles.ratingInputRow}>
						{/* #644 【UX】オススメ度ラベルにアイコン追加 */}
						<View style={styles.inputRowLabelWithIcon}>
							<Star size={18} color="#6B7280" />
							<Text style={styles.inputRowLabel}>{i18n.t("Map.placeholders.enterReview")}</Text>
						</View>
						{/* 星評価コンポーネント */}
						<View style={styles.ratingContainer}>
							<View style={styles.ratingInput}>
								{[1, 2, 3, 4, 5].map((star) => {
									// #644 【UX】未選択時の星アイコン外枠を灰色に変更
									const isActive = star <= rating;
									return (
										<TouchableOpacity key={star} onPress={() => setRating(star)}>
											<Star
												size={36}
												color={isActive ? "#FFD700" : "#D1D5DB"}
												fill={isActive ? "#FFD700" : "transparent"}
											/>
										</TouchableOpacity>
									);
								})}
							</View>
							<Text style={styles.ratingText} accessibilityLiveRegion="polite">
								{rating}
							</Text>
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
				</View>
			</ScrollView>

			{/* 投稿ボタン */}
			{/* #644 【UX】ボタンはフォーム外に配置して、キーボード表示時にも隠れないようにする */}
			<View style={styles.buttonContainer}>
				<PrimaryButton
					label={i18n.t("Common.postReview")}
					onPress={handleSubmit}
					disabled={isProcessing || !isValid}
					style={{ marginHorizontal: 16 }}
				/>
			</View>

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
		</KeyboardAvoidingView>
	);
}

const styles = StyleSheet.create({
	centeredContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 24,
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
		width: "100%",
	},
	errorTitle: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 12,
		textAlign: "center",
	},
	errorMessage: {
		fontSize: 16,
		color: "#6B7280",
		lineHeight: 24,
		marginBottom: 24,
		textAlign: "center",
	},
	errorButtons: {
		flexDirection: "row",
		gap: 12,
	},
	primaryButton: {
		flex: 1,
		backgroundColor: "#5EA2FF",
		paddingVertical: 14,
		borderRadius: 12,
		alignItems: "center",
	},
	primaryButtonText: {
		fontSize: 16,
		fontWeight: "600",
		color: "#FFFFFF",
	},
	secondaryButton: {
		flex: 1,
		backgroundColor: "#F3F4F6",
		paddingVertical: 14,
		borderRadius: 12,
		alignItems: "center",
	},
	secondaryButtonText: {
		fontSize: 16,
		fontWeight: "600",
		color: "#6B7280",
	},
	inputLabel: {
		fontSize: 16,
		fontWeight: "600",
		color: "#000",
		marginBottom: 8,
	},
	container: {
		flex: 1,
		backgroundColor: "#FFFFFF",
	},
	// #644 【UX】KeyboardAvoidingView でキーボード表示時の位置調整
	keyboardAvoidingView: {
		flex: 1,
	},
	scrollContent: {
		paddingBottom: 80, // ボタン分のスペースを確保
	},
	formContainer: {
		paddingHorizontal: 16,
		paddingTop: 16,
		paddingBottom: 24,
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
		borderWidth: 1,
		borderColor: "#D1D5DB",
		marginBottom: 8,
	},
	dishCategorySelectRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		height: 48,
		marginTop: 16,
	},
	dishCategorySelectContent: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		marginRight: 12,
	},
	priceInputRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		marginTop: 16,
		height: 48,
	},
	priceInputContainer: {
		flexDirection: "row",
		alignItems: "center",
		borderRadius: 8,
		minWidth: 120,
		marginRight: 12,
	},
	inputRowLabel: {
		fontSize: 15,
		color: "#000",
		flex: 1,
	},
	// #644 【UX】ラベルにアイコンを追加するための横並びコンテナ
	inputRowLabelWithIcon: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		flex: 1,
	},
	ratingInputRow: {
		flexDirection: "column",
		marginTop: 16,
		marginBottom: 24,
	},
	ratingContainer: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		borderBottomWidth: 1,
		borderBottomColor: "#D1D5DB",
		paddingBottom: 0,
	},
	ratingInput: {
		flexDirection: "row",
		alignItems: "center",
		marginVertical: 8,
		gap: 16,
	},
	ratingText: {
		fontSize: 32,
		color: "#000",
		textAlign: "right",
		marginRight: 12,
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
	characterCount: {
		fontSize: 12,
		color: "#6B7280",
		textAlign: "right",
		marginTop: 4,
	},
	buttonContainer: {
		paddingVertical: 12,
		borderTopWidth: 1,
		borderTopColor: "#E5E7EB",
		backgroundColor: "#FFFFFF",
	},
});
