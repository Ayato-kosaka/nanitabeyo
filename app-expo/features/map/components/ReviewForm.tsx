import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
	View,
	Text,
	TextInput,
	StyleSheet,
	TouchableOpacity,
	Platform,
	Pressable,
	KeyboardAvoidingView,
	Keyboard,
} from "react-native";
import { Star, ChevronRight, Utensils, CircleDollarSign, ThumbsUp } from "lucide-react-native";
import { Card } from "@/components/Card";
import { LoadingIndicator } from "@/components/LoadingIndicator";
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
import type { CreateDishDto, CreateDishMediaDto, CreateDishReviewDto } from "@shared/api/v1/dto";
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
	// #644 【設計】レビュー投稿成功時のコールバック（呼び出し元で画面遷移を制御）
	onSuccess?: (params: { dishMedia: DishMediaEntry["dish_media"]; dishReviewId: string }) => void;
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
	onSuccess,
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

	/**
	 * #1127 【修正】メディア選択 effect から props / ハンドラの identity を切り離すためのラッチ。
	 *
	 * 旧実装はマウント時のメディア選択 effect の依存配列に `onCancel` / `lightImpact` を並べていた。
	 * `onCancel` は呼び出し元（review.tsx）でインライン生成されるため、親が再レンダーするたびに
	 * effect が cleanup → 再実行され、cleanup の `mountedRef.current = false` が恒久化して
	 * **選択結果が全部破棄され、ローディングのまま戻ることもできない**状態になっていた。
	 *
	 * レンダー中に ref へ直接代入すると、コミットされないレンダーの値を書き込みうる。
	 * そのため更新は必ず別の useEffect（= コミット後）で行う。
	 */
	const onCancelRef = useRef(onCancel);
	useEffect(() => {
		onCancelRef.current = onCancel;
	}, [onCancel]);
	const lightImpactRef = useRef(lightImpact);
	useEffect(() => {
		lightImpactRef.current = lightImpact;
	}, [lightImpact]);
	const logFrontendEventRef = useRef(logFrontendEvent);
	useEffect(() => {
		logFrontendEventRef.current = logFrontendEvent;
	}, [logFrontendEvent]);

	/**
	 * #1127 【修正】メディア選択の同時実行を防ぐ同期ガード。
	 *
	 * expo-image-picker の Android 実装（ImagePickerModule.kt）は
	 * `if (isPickerOpen) return ImagePickerResponse(canceled = true)` を持っており、
	 * 2 発目は **ピッカーを開かずに即 canceled** を返す。JS 側がそれを「ユーザーがキャンセルした」と
	 * 誤認すると、写真を選んでいる最中に画面が閉じる。ref への代入は同期的に確定するため、
	 * 同一 JS タスク内の連続呼び出しでもレースしない（isSubmittingRef と同じ方式）。
	 */
	const isSelectingMediaRef = useRef(false);
	/** #1127 同一マウント内でメディア選択を何回起動したか（診断ログ用。2 回目以降は本来起きない） */
	const mediaSelectionAttemptRef = useRef(0);

	// 料理カテゴリの状態管理
	const [dishCategoryName, setDishCategoryName] = useState(prefilledMedia?.dish.name ?? "");
	const [dishCategoryId, setDishCategoryId] = useState<string | null>(prefilledMedia?.dish.category_id ?? null);
	const [dishCategoryError, setDishCategoryError] = useState<string | null>(null);

	// Internal state - isolated from parent re-renders
	const [isProcessing, setIsProcessing] = useState(false);
	/**
	 * #1090 【修正】投稿の多重実行を防ぐ同期ガード。
	 *
	 * `isProcessing`（useState）は **ボタンを disabled にする表示用途**であって、
	 * 多重実行の判定には使えない。React が再レンダリングをコミットする前に 2 発目の
	 * 押下が処理されると、両方が `isProcessing === false` を読んで通過しうるためで、
	 * 通過すると `v1/dishes` の POST とメディアアップロードが二重に走り、
	 * **同じレビューが 2 件登録される**。
	 *
	 * ref への代入は同期的に確定するため、同一 JS タスク内の連続呼び出しでもレースしない。
	 * search/index.tsx の `isSearchingRef`、search/topics.tsx の `isSelectingTopicRef` と同じ方式。
	 */
	const isSubmittingRef = useRef(false);
	const [price, setPrice] = useState(initialPrice);
	const [reviewText, setReviewText] = useState(initialReviewText);
	const [rating, setRating] = useState(initialRating);
	const [selectedLegalDocument, setSelectedLegalDocument] = useState<"guidelines" | "copyright" | null>(null);

	const { locale } = useLocale();

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

	/**
	 * #1127 【修正】メディア選択の実行本体。マウント時 effect と再試行ボタンで共有する。
	 *
	 * props / ハンドラはすべて ref 経由で読むため依存配列が空になり、identity が安定する。
	 * これにより「親が再レンダーすると effect が張り替わる」経路が根本から無くなる。
	 *
	 * @param origin 起動起点（`"mount"` = マウント時 effect / `"retry"` = 再試行ボタン）
	 * @param isCancelled この起動が属する effect が既に片付けられたかを返す関数
	 */
	const runMediaSelection = useCallback(async (origin: "mount" | "retry", isCancelled: () => boolean) => {
		// #1127 native 側（Android の isPickerOpen）に弾かれる二重起動を JS 側で先に防ぐ。
		// 宣言箇所のコメント参照。ここより後にピッカー起動処理を書くこと
		if (isSelectingMediaRef.current) return;
		isSelectingMediaRef.current = true;

		const attempt = (mediaSelectionAttemptRef.current += 1);
		logFrontendEventRef.current({
			event_name: "review_media_selection_start",
			// #1127 同一マウント内の 2 回目以降は本来起きない起動なので、後追いできるよう warn で残す
			error_level: attempt > 1 ? "warn" : "log",
			// #1127 【セキュリティ】メディアの URI や個人情報は payload へ入れないこと
			payload: { attempt, origin },
		});

		/** #1127 診断ログの終端。結果を破棄したかどうかまで含めて 1 イベントで見えるようにする */
		const logFinished = (outcome: { success: boolean; error?: string; discarded: boolean }) => {
			logFrontendEventRef.current({
				event_name: "review_media_selection_finished",
				error_level: outcome.discarded || attempt > 1 ? "warn" : "log",
				payload: { attempt, origin, ...outcome },
			});
		};

		/**
		 * #1127 結果を破棄する経路。**マウントされたままなら loading に置き去りにしない**。
		 * 旧実装はここで黙って return しており、スピナーのまま戻ることもできない手詰まりになっていた。
		 */
		const discard = (outcome: { success: boolean; error?: string }) => {
			logFinished({ ...outcome, discarded: true });
			if (mountedRef.current) {
				setMediaState({ status: "error", error: i18n.t("Map.media.mediaSelectionError") });
			}
		};

		try {
			const result = await selectMedia(["images", "videos"], { shouldGenerateThumbnail: true });

			// Guard against setState on unmounted component
			if (isCancelled() || !mountedRef.current) {
				discard({ success: result.success, error: result.error });
				return;
			}

			if (!result.success || result.media === undefined) {
				// Handle cancellation - close modal automatically
				if (result.error === "cancelled") {
					logFinished({ success: false, error: result.error, discarded: false });
					onCancelRef.current();
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
				logFinished({ success: false, error: result.error, discarded: false });
				return;
			}

			// Success - set media and show form
			setMediaState({ status: "success", media: result.media });
			lightImpactRef.current(); // Haptic feedback on success
			logFinished({ success: true, discarded: false });
		} catch (error) {
			if (isCancelled() || !mountedRef.current) {
				discard({ success: false, error: "exception" });
				return;
			}
			setMediaState({ status: "error", error: i18n.t("Map.media.mediaSelectionError") });
			logFinished({ success: false, error: "exception", discarded: false });
		} finally {
			isSelectingMediaRef.current = false;
		}
	}, []);

	// マウント時にメディア選択を実行
	useEffect(() => {
		// #1127 【修正】cleanup で落とされた mountedRef をここで再武装する。
		// これが無いと effect が一度でも張り替わった時点で false が恒久化し、
		// 以降すべての選択結果が破棄され続ける（宣言箇所のコメント参照）
		mountedRef.current = true;

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

		// #400 【設計】prefilledMedia が指定されている場合は、メディア選択をスキップしてプレビュー専用モードにする
		if (prefilledMedia) {
			handleSetMediaState();
			return () => {
				mountedRef.current = false;
			};
		} else {
			// 通常のメディア選択フロー
			runMediaSelection("mount", () => cancelled);
			return () => {
				cancelled = true;
				mountedRef.current = false;
			};
		}
		// #1127 依存は prefilledMedia（= モードの切り替え）だけに絞る。
		// onCancel / lightImpact は ref 経由で読むため、親の再レンダーで effect が張り替わらない
	}, [prefilledMedia, runMediaSelection]);

	// Retry media selection
	const handleRetry = useCallback(() => {
		// #1127 前回の選択がまだ native 側で開いている間の再試行は無視する。
		// ここで loading へ倒してから同時実行ガードに弾かれると、スピナーのまま固着する
		if (isSelectingMediaRef.current) return;
		setMediaState({ status: "loading" });
		// #1127 マウント時 effect と同じ実行本体を使う（ref 経由・同時実行ガード・mountedRef の扱いを揃える）
		runMediaSelection("retry", () => false);
	}, [runMediaSelection]);

	// Animated height for InitialMediaPreview
	// 画面全体の高さ - フォーム部分の高さ - ボタン部分の高さ - 同意メッセージ - バッファ
	const mediaHeight = useMemo(() => height - 370 - 60 - 36 - 120, []);
	const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
	useEffect(() => {
		const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
		const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

		const showSub = Keyboard.addListener(showEvent, () => {
			setIsKeyboardVisible(true);
		});
		const hideSub = Keyboard.addListener(hideEvent, () => {
			setIsKeyboardVisible(false);
		});

		return () => {
			showSub.remove();
			hideSub.remove();
		};
	}, []);

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

		// #1090 多重投稿の判定は ref で行う（useState の isProcessing はレースが残る。
		// 宣言箇所のコメント参照）。ここより後に投稿処理を書くこと
		if (isSubmittingRef.current) return;
		isSubmittingRef.current = true;

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

			// #644 【設計】成功時、DishMedia をコールバック経由で親に渡す（画面遷移は呼び出し元が担当）
			if (onSuccess) {
				onSuccess({ dishMedia: dish_media, dishReviewId: String(createdDishReview.id) });
			} else {
				// #644 【設計】onSuccess が指定されていない場合は従来通りの挙動（onCancel 呼び出し）
				onCancel();
			}
		} catch (error: any) {
			logFrontendEvent({
				event_name: "dish_review_submission_failed",
				error_level: "error",
				payload: { restaurantId: restaurant?.id, error: error?.message },
			});
			showSnackbar(i18n.t("Map.errors.reviewSubmitFailed"));
		} finally {
			// #1090 失敗時に再投稿できるよう、表示用 state と同じタイミングで同期ガードも解除する
			isSubmittingRef.current = false;
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
		onSuccess,
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
		<KeyboardAvoidingView style={styles.keyboardAvoidingView}>
			<ScrollView
				style={styles.container}
				keyboardShouldPersistTaps="handled"
				showsVerticalScrollIndicator={false}
				contentContainerStyle={styles.scrollContent}>
				<View style={{ height: mediaHeight, marginTop: 16 }}>
					{mediaState.status === "loading" ? (
						<View style={styles.loadingContainer}>
							<LoadingIndicator size="large" />
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
							testID="review-comment-input"
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
						testID="review-dish-category-row"
						style={styles.dishCategorySelectRow}
						onPress={openDishCategoryModal}
						disabled={!!prefilledMedia} // #400 【設計】prefilledMedia が指定されている場合は、料理カテゴリ選択を無効化
						accessibilityRole="button"
						accessibilityLabel={i18n.t("Map.actions.selectDishCategory")}>
						{/* #644 【UX】料理カテゴリラベルにアイコン追加 + prefilledMedia 時は「料理カテゴリ」に変更 */}
						<View style={styles.inputRowLabelWithIcon}>
							<Utensils size={18} color="#6B7280" />
							<Text style={styles.inputRowLabel}>
								{prefilledMedia ? i18n.t("Map.labels.dishCategory") : i18n.t("Map.actions.selectDishCategory")}
							</Text>
						</View>
						<View style={styles.dishCategorySelectContent}>
							{dishCategoryName && (
								<Text style={styles.dishCategoryValueText} numberOfLines={1} ellipsizeMode="tail">
									{dishCategoryName}
								</Text>
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
									testID="review-price-input"
									style={[styles.textInput, styles.priceInput]}
									placeholder={"0"}
									placeholderTextColor="#A0A0A0"
									value={price}
									onChangeText={setPrice}
									keyboardType="numeric"
								/>
							</View>
						) : (
							<TextInput
								testID="review-price-input"
								style={[styles.textInput, styles.priceInputSmall]}
								placeholder={"0"}
								placeholderTextColor="#A0A0A0"
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
							<ThumbsUp size={18} color="#6B7280" />
							<Text style={styles.inputRowLabel}>{i18n.t("Map.placeholders.enterReview")}</Text>
						</View>
						{/* 星評価コンポーネント */}
						<View style={styles.ratingContainer}>
							<View style={styles.ratingInput}>
								{[1, 2, 3, 4, 5].map((star) => {
									// #644 【UX】未選択時の星アイコン外枠を灰色に変更
									const isActive = star <= rating;
									return (
										<TouchableOpacity key={star} testID={`review-star-${star}`} onPress={() => setRating(star)}>
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
			{!isKeyboardVisible && (
				<View style={styles.buttonContainer}>
					<PrimaryButton
						testID="review-submit-button"
						label={i18n.t("Common.postReview")}
						onPress={handleSubmit}
						disabled={isProcessing || !isValid}
						shadowColor="transparent"
						style={{ marginHorizontal: 16 }}
					/>
				</View>
			)}

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
		backgroundColor: "#F05537",
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
		paddingBottom: 64,
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
		flexShrink: 1,
	},
	dishCategoryValueText: {
		fontSize: 15,
		color: "#000",
		textAlign: "right",
		maxWidth: 160,
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
		borderTopColor: "#C9C9C9",
		backgroundColor: "#FFFFFF",
	},
});
