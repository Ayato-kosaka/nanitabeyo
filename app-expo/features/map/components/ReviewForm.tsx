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
	Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Star, ChevronRight, Utensils, CircleDollarSign, ThumbsUp, ImagePlus, Camera } from "lucide-react-native";
import { Card } from "@/components/Card";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { PrimaryButton } from "@/components/PrimaryButton";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
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
import { resolveDishCategoryLabel } from "@/features/myDishes/dishCategoryLabel";
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
import { Dimensions } from "react-native";
import { MediaData, selectMedia } from "@/lib/mediaSelection";
import { ExistingDishMediaPicker } from "./ExistingDishMediaPicker";
import { DishCategoryStep } from "./DishCategoryStep";
import { Image } from "expo-image";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useProfileStore } from "@/features/profile/stores/useProfileStore";
import { useEnsureOwnProfileLoaded } from "@/features/profile/hooks/useEnsureOwnProfileLoaded";
import { mapReviewsKey } from "../constants";
import { useDishCategorySelectionStore } from "../stores/useDishCategorySelectionStore";
import { ScrollView } from "react-native-gesture-handler";
import { useRouter } from "expo-router";

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
	/**
	 * #1398 B1 【設計】写真なしでの記録を許可するか（既定 false）。
	 *
	 * true のときだけ `mediaState` が `{ status: "none" }` に到達しうる。到達経路は
	 * 「マウント時に開いたピッカーをキャンセルした」だけで、そのとき画面は閉じずにフォームへ留まる
	 *（B2）。渡さなければ挙動は**完全に従来どおり**であり、`review-from-media`
	 *（prefilledMedia モード）は渡さないので 1 行も変わらない。
	 */
	allowNoMedia?: boolean;
	/**
	 * #1375 実機確認（5 巡目）: メディアの選び方。
	 *
	 * - `"auto"`（既定・従来）… マウント直後に OS のピッカーを開く。
	 *   «写真を選んでからレビューを書く» 前提の画面（店舗フィードからの投稿）はこちら
	 * - `"manual"` … 開かない。**画面の中の «自分で撮影して追加 / ライブラリから選ぶ / スキップ»**
	 *   から人が選ぶ。オーナー指摘「③ は上部に自分で撮影して追加、小さくスキップ、
	 *   下に既存の dish_media」の形にするため、記録フローはこちら。
	 *   いきなり OS のピッカーが立ち上がると «何を選ばされているのか» が分からない
	 */
	mediaPickerMode?: "auto" | "manual";
	/**
	 * #644 【設計】レビュー投稿成功時のコールバック（呼び出し元で画面遷移を制御）
	 *
	 * #1398 B4 写真なしで記録したときは `dishMedia` が null になる。null のとき
	 * `/post/[id]` へ遷移してはいけない（その画面はストアのエントリ前提で、写真なしは
	 * R2 によりストアを通らないためスピナー固着になる）。
	 */
	onSuccess?: (params: { dishMedia: DishMediaEntry["dish_media"] | null; dishReviewId: string }) => void;
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
	allowNoMedia = false,
	mediaPickerMode = "auto",
	onSuccess,
}: ReviewFormProps) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	const { lightImpact, mediumImpact } = useHaptics();
	const insets = useSafeAreaInsets();
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
	/**
	 * #1398 B1 【設計】`{ status: "none" }` = 写真なしで記録する状態。
	 *
	 * `allowNoMedia` が true のときだけ到達しうる（B2 のキャンセル分岐が唯一の入口）。
	 * `success` と違って `media` を持たないので、この状態からの投稿では
	 * アップロードも `POST /v1/dish-media` も走らず、ストア更新も行わない（B4 / R2）。
	 * `none` からプレースホルダをタップすればピッカーを開き直せる（B3）ので、
	 * 「写真なし → 写真あり」へはいつでも戻れる。
	 */
	const [mediaState, setMediaState] = useState<
		| { status: "loading" }
		| { status: "error"; error: string; isPermissionError?: boolean }
		| { status: "success"; media: MediaData }
		| { status: "none" }
	>({ status: "loading" });

	/**
	 * #1127 【修正】メディア選択 effect の「実行世代」。非同期処理が書き戻してよいかの唯一の判定材料。
	 *
	 * 旧実装は cleanup で false を立てるだけの `mountedRef`（再武装なし）がこの役割を兼ねていた。
	 * `onCancel` は呼び出し元（review.tsx）でインライン生成されるため親の再レンダーごとに
	 * effect が cleanup → 再実行され、`mountedRef.current = false` が恒久化して
	 * **選択結果が全部破棄され、ローディングのまま戻ることもできない**状態になっていた。
	 *
	 * ここを `cancelled`（effect ローカルの boolean）と `mountedRef` の 2 本立てで持つと、
	 * cleanup 後に新しい effect が mountedRef を再武装した瞬間に
	 * 「古い世代なのに mounted === true」という食い違いが生まれ、**古い起動の結果で
	 * mediaState を上書きしうる**（React.StrictMode を入れると初回選択が即 error カードになる）。
	 * そのため cleanup でインクリメントする世代カウンタ 1 本へ寄せ、
	 * 「起動時に捕まえた世代 !== 現在の世代」= 無効、で統一する。
	 */
	const mediaGenerationRef = useRef(0);

	/**
	 * #1127 【修正】メディア選択 effect から props / ハンドラの identity を切り離すためのラッチ。
	 *
	 * これらを依存配列へ並べると、親が再レンダーするたびに effect が張り替わる（上記の欠陥）。
	 *
	 * レンダー中に ref へ直接代入すると、コミットされないレンダーの値を書き込みうる。
	 * そのため更新は必ず別の useEffect（= コミット後）で行う。
	 * これらの ref 同期 effect はメディア選択 effect より**前に宣言**してあり、
	 * 同一コミット内では宣言順に実行されるため、選択 effect は必ず最新値を読む。
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
	 * #1375 実機確認（2 巡目）: prefilledMedia モード（食べたを記録）でも **自分の写真に
	 * 差し替えられる**ようにする。true になった時点で prefilled を捨てて通常の
	 * メディア選択フローへ切り替わる（submit も «自分でアップロードする» 分岐を通る）。
	 * 差し替え後にピッカーをキャンセルすると「写真なし」へ落ちる（B2 のキャンセル分岐）。
	 * 元の投稿写真へ戻す UI は持たない — その場合は画面を開き直せばよい。
	 */
	const [useOwnMedia, setUseOwnMedia] = useState(false);
	/**
	 * #1375（5 巡目）「その下に既存のディッシュメディアから選べるように」。
	 *
	 * 選んだものは **親から渡された `prefilledMedia` と同じ扱い**にする（プレビューに出て、
	 * 料理カテゴリーがそのメディアの料理に固定される = `review-from-media` と同じ仕組み）。
	 * 親の prefilledMedia が在るとき（店舗フィードからの記録）はそちらが優先で、
	 * この一覧はそもそも出さない
	 */
	const [pickedExistingMedia, setPickedExistingMedia] = useState<ReviewFormProps["prefilledMedia"]>(undefined);

	/*
	#1375（オーナー指示 7 巡目）**写真の選択を «1 画面» にする。**

	これまでは «写真の選び方» と «コメント・料理・価格・星» が 1 画面に同居しており、
	最初に目に入るものが多すぎた。お店 → 料理カテゴリー と同じ粒度で、
	写真も 1 歩として独立させる。

	`mediaState.status === "none"` は «写真なしで記録する» と «まだ決めていない» の
	両方を表してしまうので、**決めたかどうかは別に持つ**。
	決まったとみなすのは «撮った / 選んだ / 既存から選んだ / «写真なし» を押した» の 4 つ。
	*/
	const [hasDecidedMedia, setHasDecidedMedia] = useState(false);
	const activePrefilledMedia = prefilledMedia ?? pickedExistingMedia;
	/** «画面の中で写真を選ぶ» 見た目を出しているか（高さを固定しない条件。下のコメント参照） */
	const showsManualMediaChooser = mediaPickerMode === "manual" && !activePrefilledMedia;
	/*
	#1629 写真の «作り直し» の入口は 1 つだけにする（下のプレビューのコメント参照）。
	記録フロー（`manual`）は «選び直す»、それ以外（親が写真を決めている画面）は
	«自分の写真に差し替える»。**両方 true になる組み合わせを作らないこと。**
	*/
	const isRecordFlowMedia = mediaPickerMode === "manual" && prefilledMedia === undefined;
	const effectivePrefilledMedia = useOwnMedia ? undefined : activePrefilledMedia;

	const prefilledMediaRef = useRef(effectivePrefilledMedia);
	useEffect(() => {
		prefilledMediaRef.current = effectivePrefilledMedia;
	}, [effectivePrefilledMedia]);
	/**
	 * #1398 B2 `runMediaSelection` は `useCallback([])` で identity を固定してあるため、
	 * 新しい prop も他と同じくラッチ経由で読む（依存配列へ足すと #1127 の欠陥が戻る）。
	 * 上の 3 本（onCancel / lightImpact / logFrontendEvent）と同じ作法で、
	 * `mediaGenerationRef` / `isSelectingMediaRef` / `prefilledMediaRef` には手を入れていない。
	 */
	const mediaPickerModeRef = useRef(mediaPickerMode);
	useEffect(() => {
		mediaPickerModeRef.current = mediaPickerMode;
	}, [mediaPickerMode]);
	const allowNoMediaRef = useRef(allowNoMedia);
	useEffect(() => {
		allowNoMediaRef.current = allowNoMedia;
	}, [allowNoMedia]);

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
	/**
	 * #1127 同一マウント内でメディア選択を何回**起動できた**か（診断ログ用。2 回目以降は本来起きない）。
	 * 同時実行ガードで弾かれた起動はここを消費せず、`review_media_selection_skipped` として別に残す
	 *（start / finished の対応が崩れると「何回走ったか」を後追いできなくなるため）。
	 */
	const mediaSelectionAttemptRef = useRef(0);

	// 料理カテゴリの状態管理
	const [dishCategoryName, setDishCategoryName] = useState(prefilledMedia?.dish.name ?? "");
	const [dishCategoryId, setDishCategoryId] = useState<string | null>(prefilledMedia?.dish.category_id ?? null);
	const [dishCategoryError, setDishCategoryError] = useState<string | null>(null);

	/*
	#1375（6 巡目・オーナー指示）**記録フローは «料理カテゴリー → 写真» の順にする。**

	先に料理が決まっていれば «この店の、その料理の写真» を選ばせられる。
	逆順（5 巡目まで）だと、どの料理か分からないまま写真を探すことになっていた。

	この段階分けは記録フロー（`mediaPickerMode === "manual"`）だけに効かせる。
	店舗フィードからの記録（`prefilledMedia` あり）は料理が既に決まっているし、
	検索動線（auto）は従来どおり写真ありきで始まる。
	*/
	const needsDishCategoryFirst = mediaPickerMode === "manual" && !prefilledMedia && !dishCategoryId;
	/** 料理カテゴリーが決まったあとの «写真を選ぶ» の 1 歩。決めるまでフォームは出さない */
	const needsMediaChoiceFirst =
		mediaPickerMode === "manual" && !prefilledMedia && !needsDishCategoryFirst && !hasDecidedMedia;

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
	 * search/index.tsx の `isSearchingRef`、search/dish-categories.tsx の `isSelectingDishCategoryRef` と同じ方式。
	 */
	const isSubmittingRef = useRef(false);
	/**
	 * #1136 【設計】「レビュー投稿中」であることを表示するための state。
	 *
	 * `isProcessing` は投稿以外（料理カテゴリの新規作成 = `applyTypedDishCategory`）でも立つため、
	 * これをそのままボタンのスピナーに使うと「投稿していないのに投稿中に見える」誤表示になる。
	 * 表示は投稿フロー（`handleSubmit` の try..finally）だけに限定したいので専用の state を持つ。
	 *
	 * 多重実行の判定にはこれも `isProcessing` も使わないこと（レースが残る。`isSubmittingRef` 参照）。
	 * 解除は `handleSubmit` の finally で行うため、成功・失敗のどちらでも必ず落ちる。
	 */
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [price, setPrice] = useState(initialPrice);
	const [reviewText, setReviewText] = useState(initialReviewText);
	const [rating, setRating] = useState(initialRating);

	const { locale } = useLocale();
	const router = useRouter();

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

	/*
	  #1386 【設計】このフォームはもうオーバーレイを 1 つも持たない。

	  以前は 2 つの BlurModal を自分の中に抱えていた。
	  - `DishCategoryModal`（料理カテゴリ選択・**既定 zIndex 1100**）: 親のレビュー投稿モーダルは
	    1200 なので «子の方が数字が小さい» 逆転を抱えていた（#1350 §D）
	  - `LegalDocumentModal`（ガイドライン / 著作権）: #1368 で B 群の他 2 件が
	    `/[locale]/legal/[doc]` ルートへ移った後も、ここだけ移せず引き渡されていた 1 件

	  #1368 が移せなかった理由は 2 つあり、どちらもこのフォームが «portal の中» に描かれていたことに
	  由来する。`Portal.Host` は `<Stack>` を包んでいる（app/[locale]/_layout.tsx）ので、
	  (1) portal の中から法務ルートへ push すると遷移先が下に潜って触れない、
	  (2) かといって push の前に親シートを閉じるとこのフォームごと unmount され、
	  **入力中のレビューと `mediaState`（#1127 の実行世代つき）が丸ごと消える**。

	  #1386 でこのフォームの呼び出し元が 2 つのルート（`review` /`review-from-media`）だけになり、
	  «portal の中» という前提が消えたので、両方とも push へ切り替えた。フォームはスタックに
	  残るため、法務文書を読んで戻っても・カテゴリを選んで戻っても書きかけはそのまま続く。

	  ⚠️ このフォームを再びオーバーレイの中へ入れないこと。入れると上の 2 つの制約が同時に戻る。
	  「呼び出し元が portal を持たない」ことは `__tests__/reviewFormRoutes.test.tsx` が固定している。
	*/

	/**
	 * #1375（5 巡目）既存メディアを選んだら、料理カテゴリーはそのメディアの料理になる
	 * （`review-from-media` と同じ仕組み。マウント時の初期値と同じ経路を後から通す）。
	 * ⚠️ 親から `prefilledMedia` を渡された画面ではこの effect は 1 度も走らない
	 * （`pickedExistingMedia` が undefined のままなので）
	 */
	useEffect(() => {
		if (!pickedExistingMedia) return;
		/*
		#1629【オーナー実機報告】「実際にそれを選ぶと料理カテゴリー選択が **空欄のまま**入っちゃう」。

		表示名に `dish.name` を直に入れていたため、その店での呼び名が空の投稿を選ぶと
		**カテゴリー欄が空のまま**進んでしまっていた（しかも下の行は選び直しを塞いでいたので直せない）。
		表示名は `dishCategoryLabel.ts` の規則で解決する（他の画面と同じ）。
		*/
		setDishCategoryName(
			resolveDishCategoryLabel(pickedExistingMedia.dish.categoryLabels, pickedExistingMedia.dish.name, locale) ?? "",
		);
		setDishCategoryId(pickedExistingMedia.dish.category_id ?? null);
	}, [locale, pickedExistingMedia]);

	/**
	 * #1386 料理カテゴリ選択画面（ルート）からの «戻り値»。
	 *
	 * expo-router に画面の戻り値の仕組みは無いため、1 件だけの受け渡し箱を経由する
	 *（`features/map/stores/useDishCategorySelectionStore.ts`）。読んだら必ず消すこと。
	 */
	const dishCategoryResult = useDishCategorySelectionStore((state) => state.result);

	/**
	 * #1127 【修正】メディア選択の実行本体。マウント時 effect と再試行ボタンで共有する。
	 *
	 * props / ハンドラはすべて ref 経由で読むため依存配列が空になり、identity が安定する。
	 * これにより「親が再レンダーすると effect が張り替わる」経路が根本から無くなる。
	 *
	 * @param origin 起動起点（`"mount"` = マウント時 effect / `"retry"` = 再試行ボタン）
	 * @param generation 起動時点の実行世代（`mediaGenerationRef` の値）。宣言箇所のコメント参照
	 */
	const runMediaSelection = useCallback(
		async (origin: "mount" | "retry", generation: number, source: "library" | "camera" = "library") => {
			/** #1127 この起動が属する世代がもう有効でない（= 張り替え済み / アンマウント済み）か */
			const isStale = () => generation !== mediaGenerationRef.current;

			// #1127 native 側（Android の isPickerOpen）に弾かれる二重起動を JS 側で先に防ぐ。
			// 宣言箇所のコメント参照。ここより後にピッカー起動処理を書くこと
			if (isSelectingMediaRef.current) {
				// #1127 弾いた起動こそが「二重起動が起きた」という一番知りたい事実なので、
				// attempt を消費しない専用イベントとして残す（start/finished の対を崩さないため）
				logFrontendEventRef.current({
					event_name: "review_media_selection_skipped",
					error_level: "warn",
					// #1127 【セキュリティ】メディアの URI や個人情報は payload へ入れないこと
					payload: { origin },
				});
				return;
			}
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
			 * #1127 結果を破棄する経路。旧実装はここで黙って return しており、
			 * 破棄されたこと自体が観測できなかったのでログだけは必ず残す。
			 *
			 * 世代が古い＝「アンマウント済み」か「新しい effect が mediaState の所有権を持っている」の
			 * どちらかなので、**ここから setMediaState してはいけない**（どちらの場合も上書きが誤り）。
			 */
			const discard = (outcome: { success: boolean; error?: string }) => {
				logFinished({ ...outcome, discarded: true });
			};

			try {
				// ⚠️ カメラ起動は **写真のみ**。動画撮影はマイクを掴むが、現行ビルドの Info.plist に
				// NSMicrophoneUsageDescription が無く、iOS はその場でクラッシュする。
				// 権限文言の追加はネイティブビルドが要る（= OTA で届かない）ので、
				// ビルドを流す判断が出るまで動画はライブラリ選択のみとする（#1375 4 巡目）
				const result = await selectMedia(source === "camera" ? ["images"] : ["images", "videos"], {
					shouldGenerateThumbnail: true,
					source,
				});

				// Guard against setState on unmounted / superseded component
				if (isStale()) {
					discard({ success: result.success, error: result.error });
					return;
				}

				if (!result.success || result.media === undefined) {
					// Handle cancellation - close modal automatically
					if (result.error === "cancelled") {
						logFinished({ success: false, error: result.error, discarded: false });
						/**
						 * #1398 B2 【設計】写真なしを許可している画面では、キャンセルで画面を閉じない。
						 *
						 * `allowNoMedia` が true のとき、ピッカーのキャンセルは「写真なしで記録する」という
						 * 意思表示とみなしてフォームに留まる（設計 §4-1）。退出手段は `ScreenHeader` の
						 * 戻るボタンで従来どおり確保されている。
						 * false（既定・`review-from-media` を含む）のときは**従来どおり** `onCancel()` で閉じる。
						 * ここは `runMediaSelection` 内の唯一のキャンセル分岐なので、分岐はこの 1 箇所で閉じる。
						 */
						if (allowNoMediaRef.current) {
							setMediaState({ status: "none" });
							return;
						}
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
						// #1425 HEIC / HEIF はサーバがデコードできないため、選択時点で断る
						case "unsupported_image_format":
							errorMessage = i18n.t("Map.media.unsupportedImageFormat");
							break;
					}

					setMediaState({
						status: "error",
						error: errorMessage,
						// #1375 実機確認（3 巡目）: 権限拒否のときだけ「設定を開く」ボタンを出す。
						// 「設定から許可してください」と文字で言うだけだと、設定アプリの中から
						// このアプリを探させることになる（Linking.openSettings で 1 タップにする）
						isPermissionError: result.error === "permission_denied",
					});
					logFinished({ success: false, error: result.error, discarded: false });
					return;
				}

				// Success - set media and show form
				setMediaState({ status: "success", media: result.media });
				setHasDecidedMedia(true);
				lightImpactRef.current(); // Haptic feedback on success
				logFinished({ success: true, discarded: false });
			} catch (error) {
				if (isStale()) {
					discard({ success: false, error: "exception" });
					return;
				}
				setMediaState({ status: "error", error: i18n.t("Map.media.mediaSelectionError") });
				logFinished({ success: false, error: "exception", discarded: false });
			} finally {
				isSelectingMediaRef.current = false;
			}
		},
		[],
	);

	/**
	 * #1127 【修正】プレビュー専用モードの「中身」だけを取り出した依存キー。
	 *
	 * 呼び出し元のうち review-from-media/[dishMediaId].tsx は `prefilledMedia` を
	 * インラインのオブジェクトリテラルで渡すため、オブジェクト identity をそのまま
	 * 依存配列へ入れると親が再レンダーするたびに下の effect が張り替わり、
	 * `media_type === "image"` のプレビューが毎回 `loading`（スピナー）へ巻き戻る。
	 * 呼び出し側の useMemo だけに頼ると「呼び出し元が identity を安定させている」という
	 * 暗黙の契約に依存し続けるので、ここでコンポーネント内に閉じる。
	 *
	 * 一方、#511 のとおり `mediaUrl` は null（加工中）から後追いで値ありへ変わりうるため
	 * `id` だけをキーにすると今度は反映されなくなる。そのため
	 * **`handleSetMediaState` が実際に読むフィールド**（id / media_type / mediaUrl /
	 * thumbnailImageUrl）を突き合わせる。ここに項目を足したら本キーにも足すこと。
	 */
	const prefilledMediaKey = effectivePrefilledMedia
		? JSON.stringify([
				effectivePrefilledMedia.id,
				effectivePrefilledMedia.media_type,
				// #1629 外部埋め込みかどうかで分岐するので、キーにも含める
				effectivePrefilledMedia.render_type,
				effectivePrefilledMedia.mediaUrl,
				effectivePrefilledMedia.thumbnailImageUrl,
			])
		: null;

	// マウント時にメディア選択を実行
	useEffect(() => {
		// #1127 【修正】この実行の世代を確定する。cleanup（張り替え / アンマウント）で
		// インクリメントされるため、非同期処理はこの値と現在値を比べるだけで生死を判定できる
		const generation = ++mediaGenerationRef.current;
		/** #1127 この実行がもう有効でない（= 張り替え済み / アンマウント済み）か */
		const isStale = () => generation !== mediaGenerationRef.current;

		const handleSetMediaState = async () => {
			// #1127 identity ではなく内容で張り替えるため、オブジェクト本体は ref 経由で読む
			const media = prefilledMediaRef.current;
			if (!media) return;

			/*
			#1629 【修正】**取り込んだ Instagram の投稿から «レビュー» を押すと
			「メディアを読み込み中…」から永久に進まなかった。**

			`render_type='external_embed'` の行は自ストレージに実体を持たないので
			`mediaUrl` は **常に null** である。ところが下の #511 の早期 return は
			「加工中だから、後でもう一度 effect が走れば値が来る」ことを前提にしており、
			`mediaState` を `loading` のまま放置して抜けていた。外部埋め込みでは
			その «後で» が永久に来ないため、スピナーが回り続ける。

			早期 return してよいのは «後から値が来る» 場合だけである。ここで 2 つを分ける。
			- 外部埋め込み … 自前のメディアは最初から無い。サムネイルがあればそれをプレビューに使い、
			  無ければ «写真なし»（none）として画面を使える状態にする
			- それ以外（stored） … 従来どおり早期 return（加工が終われば effect が張り替わる）

			⚠️ ここを «mediaUrl が無ければ none» と一括りにしないこと。stored の加工中を
			   none にすると、出来上がった動画を差し置いて «写真なし» で記録されてしまう。
			*/
			if (media.render_type === "external_embed") {
				const externalThumbnail = media.thumbnailImageUrl ?? undefined;
				if (!externalThumbnail) {
					// サムネイルすら取れない provider。記録自体はできるので «写真なし» で進ませる
					if (isStale()) return;
					setMediaState({ status: "none" });
					return;
				}
				setMediaState({ status: "loading" });
				try {
					await Image.prefetch(externalThumbnail);
				} catch {
					// 外部 CDN の署名切れ等。プレビューが出せないだけで記録は続けられる
					if (isStale()) return;
					setMediaState({ status: "none" });
					return;
				}
				if (isStale()) return;
				setMediaState({
					status: "success",
					media: {
						type: "image",
						uri: externalThumbnail,
						mimeType: "image",
						thumbnailUri: externalThumbnail,
					},
				});
				return;
			}

			// #511 【設計】mediaUrl が null の場合（処理中）は早期 return
			const mediaUrl = media.mediaUrl;
			if (!mediaUrl) return;
			try {
				if (media.media_type === "image") {
					setMediaState({ status: "loading" });
					await Image.prefetch(mediaUrl);
				}
				const thumbnailUrl = media.thumbnailImageUrl ?? undefined;
				thumbnailUrl && (await Image.prefetch(thumbnailUrl));
				// #1127 prefetch 中に張り替え / アンマウントされていたら書き戻さない
				if (isStale()) return;
				// 既存メディアをプレビュー用のMediaDataに変換
				setMediaState({
					status: "success",
					media: {
						type: media.media_type as CreateDishMediaDto["mediaType"],
						uri: mediaUrl,
						// 【設計】prefilledMedia が指定されている場合は、mimeType は利用しないので適当に設定
						mimeType: media.media_type,
						thumbnailUri: thumbnailUrl,
					},
				});
			} catch (error) {
				if (isStale()) return;
				setMediaState({ status: "error", error: i18n.t("Map.media.mediaSelectionError") });
			}
		};

		// #400 【設計】prefilledMedia が指定されている場合は、メディア選択をスキップしてプレビュー専用モードにする
		if (prefilledMediaKey !== null) {
			handleSetMediaState();
		} else if (mediaPickerModeRef.current === "manual") {
			// #1375（5 巡目）manual では OS のピッカーを開かない。
			// «写真なし» の状態から始めて、画面の中のボタンで人が選ぶ。
			// ⚠️ `allowNoMedia` が false のままここへ来ると «写真なしでは投稿できないのに
			// 写真なしで始まる» という詰みになるので、manual は allowNoMedia と対で使うこと
			setMediaState({ status: "none" });
		} else {
			// 通常のメディア選択フロー
			runMediaSelection("mount", generation);
		}

		return () => {
			// #1127 世代を進めて、この実行に属する非同期処理の書き戻しを無効化する
			mediaGenerationRef.current += 1;
		};
		// #1127 依存は 2 つ。
		// - prefilledMediaKey: プレビュー専用モードかどうかと、プレビューの**中身**が変わったか
		//   （オブジェクト identity では張り替えない）
		// - runMediaSelection: useCallback([]) で参照が安定しているので実質不変
		// prefilledMedia 本体 / onCancel / lightImpact / logFrontendEvent は ref 経由で読むため、
		// 親の再レンダーだけでは effect が張り替わらない
		// mediaPickerMode は ref 経由（親の再レンダーで effect を張り替えない。#1127 と同じ作法）
	}, [prefilledMediaKey, runMediaSelection]);

	/**
	 * #1375（5 巡目）写真なしで記録する。
	 *
	 * `allowNoMedia` の画面でだけ出す。`{ status: "none" }` は «写真なしで記録する» 状態で、
	 * ここから «写真あり» へはいつでも戻れる（placeholder は none のときに出ている）。
	 */
	const handleSkipPhoto = useCallback(() => {
		setHasDecidedMedia(true);
		lightImpact();
		setMediaState({ status: "none" });
	}, [lightImpact]);

	// Retry media selection
	const handleRetry = useCallback(() => {
		// #1127 前回の選択がまだ native 側で開いている間は loading へ倒さない。
		// 倒してから同時実行ガードに弾かれると、スピナーのまま固着する。
		// 起動そのものは常に runMediaSelection へ委譲し、弾いた事実は向こうで診断ログに残す
		//（両方の読み取りは同一 JS タスク内で同期的に走るのでレースしない）
		if (!isSelectingMediaRef.current) setMediaState({ status: "loading" });
		// #1127 マウント時 effect と同じ実行本体を使う（ref 経由・同時実行ガード・世代判定を揃える）。
		// 再試行は「いま有効な世代」に属するので現在値をそのまま渡す。
		// アンマウント時は cleanup が世代を進めるため、遅れて返ってきた結果は書き戻されない
		runMediaSelection("retry", mediaGenerationRef.current);
	}, [runMediaSelection]);

	/*
	#1629【オーナー実機報告】**選んだ写真は選び直せる。**

	> メディアを選んだら編集ができなくて困ってます。
	> うどんの刻んだメディアがあるからこれを自分の写真に変えたら再編集ができないか、これ直してほしくて。

	記録フロー（`mediaPickerMode === "manual"`）では «写真を決めた» 時点で選択肢が畳まれ、
	**そこから先はどうやっても写真を変えられなかった**。«この店の写真から選ぶ» で選んだ投稿も、
	«自分の写真に変える» で開いたピッカーも、一度決めたら戻れない。
	戻る道が無いのに、その決定が料理カテゴリー欄まで固定していた（下の `disabled` の行）ので、
	間違えたら画面を閉じてやり直すしかなかった。

	1 歩目（写真の選び方）へ戻すだけで、既存の分岐がそのまま «最初から選び直し» として動く。

	⚠️ 親から `prefilledMedia` を渡された画面（店舗フィードからの記録）には出さない。
	   あちらは «その投稿に対する記録» と決まっていて、写真を差し替える意味が無い
	   （差し替えたいときの入口は従来どおり «自分の写真に変える»）。
	*/
	const handleReselectMedia = useCallback(() => {
		lightImpact();
		setPickedExistingMedia(undefined);
		setUseOwnMedia(false);
		setHasDecidedMedia(false);
		setMediaState({ status: "none" });
	}, [lightImpact]);

	// #1375 4 巡目: 「その場で撮る」導線。ガードの作法は handleRetry と同一に保つ
	const handleShootWithCamera = useCallback(() => {
		if (!isSelectingMediaRef.current) setMediaState({ status: "loading" });
		runMediaSelection("retry", mediaGenerationRef.current, "camera");
	}, [runMediaSelection]);

	// Animated height for InitialMediaPreview
	// 画面全体の高さ - フォーム部分の高さ - ボタン部分の高さ - 同意メッセージ - バッファ
	const mediaHeight = useMemo(() => height - 370 - 60 - 36 - 120, []);

	/*
	#1629【33】**選んだ写真のプレビューには、必ず高さを与える。**

	オーナー実機報告: 「食べたを記録で画像を選ぶとめちゃくちゃ小さく表示される」。

	真因は «プレビューが親の高さにしか依存していないのに、記録フローだけ親に高さが無かった» こと。

	- `InitialMediaPreview` は自分の寸法を一切持たない。`container` が `height: "100%"`、
	  `mediaWrapper` が `height: "100%"` + `aspectRatio: 9/16`、画像そのものは
	  `StyleSheet.absoluteFillObject` である。つまり **祖先が確定した高さを持っていることが前提**で、
	  持っていなければ 100% は auto へ落ち、中身は絶対配置なので内在高さが 0 になる。
	- ところがこの枠は `showsManualMediaChooser`（= 記録フロー: `mediaPickerMode === "manual"` かつ
	  親から prefilledMedia が来ていない）のとき `{ marginTop: 16 }` だけで、**高さを与えていなかった**。
	  しかも外は `ScrollView` なので `previewWrap` の `flex: 1` も伸びる先が無い。
	  結果、選んだ写真は数 px に潰れる。店舗フィードからの記録（prefilledMedia あり）では
	  `height: mediaHeight` の枝を通るので同じ症状が出ず、記録フローだけで起きていた。

	枠の高さを外すのは «写真なしプレースホルダー»（`status === "none"`）のためである。
	そちらは «自分で撮影 / ライブラリ / 既存メディアから選ぶ» が縦に積まれ、内容ぶんだけ
	伸びる必要がある。だから **プレースホルダーを描くときだけ高さを外す**（それ以外は
	従来どおり `mediaHeight` を与える）。寸法は `ReviewForm.test.tsx` が数値で固定している。
	*/
	const showsNoMediaPlaceholder = mediaState.status === "none";
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

	/**
	 * #1386 料理カテゴリ選択画面へ進む。
	 *
	 * 選択中のカテゴリを先に空へ戻すのは BlurModal 時代の `onMount` と同じ挙動
	 *（開いた時点で選び直しになる）。
	 *
	 * ⚠️ `clear()` は «現在の経路からは観測できない» 防御である（#1388 のレビューで判明）。
	 * 下の consume effect が結果を受け取った瞬間に消すので、この行に来る時点で箱は常に空。
	 * 落としてもテストは全緑になる。それでも残すのは、箱に結果が残ったままフォームへ入る
	 * 経路が理屈の上では存在するため（dish-category へ直リンク → 選択 → 履歴が無いので
	 * 親へ replace → フォームは一度も描かれない、の後にフォームを開く）。
	 * ただしその経路は «mount 時の consume» が先に走るので、この行では防げない。
	 * 箱を店舗単位にする等の本対応は #1390 へ切り出した。
	 */
	const handleOpenDishCategory = useCallback(() => {
		setDishCategoryId(null);
		setDishCategoryName("");
		setDishCategoryError(null);
		useDishCategorySelectionStore.getState().clear();
		router.push({
			pathname: "/[locale]/restaurant/[restaurantId]/dish-category",
			params: { locale, restaurantId: restaurant.id },
		});
	}, [router, locale, restaurant.id]);

	// 候補に無い名前を入れて戻ってきたときの処理: 新規カテゴリとして作成し dishCategoryId を確定する
	const applyTypedDishCategory = useCallback(
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
		[createDishCategoryVariant],
	);

	/*
	#1375（6 巡目）記録フローの 1 歩目（DishCategoryStep）から来る 2 つの確定口。
	既存の «別画面へ push して戻り値を受け取る» 経路（下の useEffect）はそのまま残す
	— 店舗フィードからの記録や、決めた後に押し直したときはそちらを使う。
	*/
	const handleSelectDishCategoryInline = useCallback((category: { dishCategoryId: string; label: string }) => {
		setDishCategoryId(category.dishCategoryId);
		setDishCategoryName(category.label);
		setDishCategoryError(null);
	}, []);

	const handleCreateDishCategoryFromName = useCallback(
		(name: string) => {
			setDishCategoryError(null);
			void applyTypedDishCategory(name);
		},
		[applyTypedDishCategory],
	);

	/**
	 * #1386 料理カテゴリ選択画面の «戻り値» を受け取る。
	 *
	 * 読んだら必ず消す（consume）。消すと `dishCategoryResult` は null になり、この effect は
	 * 次の行の早期 return で止まるので二重適用にならない。
	 */
	useEffect(() => {
		if (!dishCategoryResult) return;
		useDishCategorySelectionStore.getState().clear();

		if (dishCategoryResult.status === "selected") {
			setDishCategoryId(dishCategoryResult.dishCategoryId);
			setDishCategoryName(dishCategoryResult.label);
			return;
		}
		// 候補に無い名前 = 新規作成。POST の失敗はインラインエラーで出す（この画面の UI なので
		// 選択画面側では扱えない。ストアのコメント参照）
		applyTypedDishCategory(dishCategoryResult.name);
	}, [dishCategoryResult, applyTypedDishCategory]);

	const handleSubmit = useCallback(async () => {
		// #1398 B4 写真なし（status: "none"）も投稿できる。`isValid`（価格>0 / コメント / ★>0 /
		// カテゴリ確定）は写真の有無に関係なくそのまま必須なので、ここは条件を足すだけに留める
		if (!isValid || isProcessing || (mediaState.status !== "success" && mediaState.status !== "none")) return;

		// #1090 多重投稿の判定は ref で行う（useState の isProcessing はレースが残る。
		// 宣言箇所のコメント参照）。ここより後に投稿処理を書くこと
		if (isSubmittingRef.current) return;
		isSubmittingRef.current = true;

		mediumImpact();
		setIsProcessing(true);
		// #1136 アップロードと 3 本の API 呼び出しで数秒〜数十秒かかりうるため、投稿中を可視化する
		setIsSubmitting(true);
		setDishCategoryError(null);

		try {
			// #400 【設計】メディアなしモード（prefilledMedia指定時）では、新規メディアアップロード処理をスキップする
			/**
			 * #1398 B4 写真なし（`status: "none"`）のときは最後まで null のまま。
			 * この 2 つが null であることが「ストアを触ってはいけない」の唯一の判定材料になる（R2）。
			 */
			let dish_media: DishMediaEntry["dish_media"] | null = null;
			let dish: DishMediaEntry["dish"] | null = null;
			/** レビューを書く対象の dish。写真ありは `dish_media.dish_id`、写真なしは get-or-create の結果 */
			let dishId: string;
			/**
			 * #1560 新規写真投稿では `POST /v1/dish-media` が **同じトランザクションで**
			 * 作ったレビューを返す。その場合 `POST /v1/dish-reviews` は投げない。
			 * null のままなら従来どおり単独で投げる（写真なし / 他人のメディアへの追記）。
			 */
			let createdDishReviewFromMedia: CreateDishMediaResponse["dishReview"] | null = null;
			if (mediaState.status === "none") {
				/**
				 * #1398 (c-2) 写真なしの記録。
				 *
				 * `POST /v1/dishes`（get-or-create）→ `POST /v1/dish-reviews` の **2 本だけ**。
				 * アップロードと `POST /v1/dish-media` は丸ごと飛ばす。dish が無いとレビューが
				 * 書けないので `v1/dishes` だけは写真ありと同じく必要である。
				 */
				const createDishResponse = await callBackend<CreateDishDto, CreateDishResponse>("v1/dishes", {
					method: "POST",
					requestPayload: {
						restaurantId: restaurant.id,
						dishCategoryId: dishCategoryId,
					},
				});
				dishId = createDishResponse.id;
			} else if (!effectivePrefilledMedia) {
				if (mediaState.media.durationSec === undefined && mediaState.media.type === "video") {
					logFrontendEvent({
						event_name: "video_duration_missing",
						error_level: "error",
						payload: { media: mediaState.media },
					});
					throw new Error(i18n.t("Common.errors.videoProcessingFailed"));
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
					// #1375 投稿直後の楽観更新。作成 API はカテゴリの正式表記を返さないので null。
					// 表示は dish.name へ落ちる（`dishCategoryLabel.ts`）ので壊れない。
					// 次に一覧を引き直したときサーバの値で埋まる
					categoryLabels: null,
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
				/*
				#1560 【設計】レビューを **この 1 本に同梱する**。

				以前は `POST /v1/dish-media` の直後に `POST /v1/dish-reviews` を投げていたが、
				1 本目が成功して 2 本目が落ちる（通信断・5xx）と **写真だけが残った**。
				`GET /v1/users/me/dishes` の候補集合は want（reactions）と eaten（dish_reviews）の
				2 系統しか無く dish_media を起点にした系統が無いため、その行は一覧にもピンにも
				出ず、本人が到達する導線が消える。#1513 の「投稿を削除」でも消せない（#1560）。

				サーバーは media と review を同じトランザクションで書くので、部分成功が
				原理的に起きなくなる。アップロードは依然この前に完了させること
				（トランスコーダがアップロード済みオブジェクトを読むため）。
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
							review: {
								comment: reviewText,
								languageCode: locale,
								priceCents: parsedPrice,
								currencyCode: currencyCode ?? undefined,
								rating,
							},
						},
					},
				);
				createdDishReviewFromMedia = createDishMediaResponse.dishReview ?? null;
				dish_media = {
					...createDishMediaResponse,
					isMine: true,
					isSaved: false,
					isLiked: false,
					likeCount: 0,
					mediaUrl: mediaState.media.uri,
					thumbnailImageUrl: mediaState.media.type === "video"
						? // #1375 サムネイル生成に失敗すると `!` で undefined がストアへ入り、投稿直後だけ真っ黒なセルになる
							(mediaState.media.thumbnailUri ?? mediaState.media.uri)
						: mediaState.media.uri,
					// #511 ローカルの uri をセットして読み込むため、処理済み状態にする
					media_processing_status: "completed",
					thumbnail_processing_status: "completed",
				};
				dishId = dish_media.dish_id;
			} else {
				// prefilledMedia が指定されている場合は、それを利用
				dish_media = effectivePrefilledMedia;
				dish = effectivePrefilledMedia.dish;
				dishId = dish_media.dish_id;
			}

			// #1560 メディアと同時に作れていれば 2 本目は投げない（部分成功の窓を作らない）
			const createdDishReview =
				createdDishReviewFromMedia ??
				(await callBackend<CreateDishReviewDto, CreateDishReviewResponse>("/v1/dish-reviews", {
				method: "POST",
				requestPayload: {
					dishId,
					comment: reviewText,
					languageCode: locale,
					priceCents: parsedPrice,
					currencyCode: currencyCode ?? undefined,
					rating,
					// #1398 B4 写真なしのときは `createdDishMediaId` を**送らない**。
					// DTO 上すでに任意で、API は未指定なら `created_dish_media_id` に NULL を書く
					...(dish_media ? { createdDishMediaId: dish_media.id } : {}),
					},
				}));

			/**
			 * #1398 R2 【重要】写真なし（`dish_media === null`）ではストアを 1 つも触らない。
			 *
			 * `useDishMediaEntriesStore` のエントリは `dish_media` が在ることを前提にしており、
			 * 写真なしの記録で `upsertDishMediaEntries` / `updateMediaIdsByKey` を呼ぶと
			 * **不正なエントリが入って全画面 Feed が壊れる**。`updateReviewIdsByKey` も、実体の無い
			 * レビュー id を一覧へ積むだけなので同じ理由で呼ばない。
			 * 写真なしの記録は `/post/[id]` へも遷移しない（呼び出し元が `dishMedia === null` で判断する）ので、
			 * ストアに入っていないことによる不都合は無い。
			 */
			// #460 【設計】レビュー投稿後の即時反映：API から返却された DishReview をストアに反映
			if (dish_media && dish) {
				// let のままコールバックへ渡すと絞り込みが効かないので const へ受け直す
				const createdDishMedia = dish_media;
				const { upsertDishMediaEntries, updateReviewIdsByKey, updateMediaIdsByKey } =
					useDishMediaEntriesStore.getState();
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
								// #1513 いま自分が投稿したレビューなので必ず true。
								// サーバーから引き直したときも同じ値になる（user_id が一致するため）
								isMine: true,
								isLiked: false,
								likeCount: 0,
							},
						],
					},
				]);
				updateReviewIdsByKey("reviews", (prev) => [String(createdDishReview.id), ...prev]);
				if (!prefilledMedia)
					updateMediaIdsByKey(mapReviewsKey(restaurant.id), (prev) => [String(createdDishMedia.id), ...prev]);
			}

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
			// #1136 ローディング表示の解除もここに置くこと。成功・失敗・例外のいずれでも必ず通る唯一の場所で、
			// try 側の各 return 直前に散らすと解除漏れ（スピナー固着で二度と投稿できない）を作る
			isSubmittingRef.current = false;
			setIsProcessing(false);
			setIsSubmitting(false);
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

	/**
	 * #1386 法務ドキュメントは `/[locale]/legal/[doc]` ルートへ push する（#1368 からの引き渡し）。
	 *
	 * 重ねるのをやめても書きかけは消えない。このフォームはスタックに残り、
	 * 読み終えて戻れば入力中のレビューと `mediaState` がそのまま続く。
	 */
	const handleOpenLegalDocument = useCallback(
		(doc: "guidelines" | "copyright") => {
			router.push({ pathname: "/[locale]/legal/[doc]", params: { locale, doc } });
		},
		[router, locale],
	);

	/**
	 * #1441 M-1 【レビュー対応】エラーカードの「閉じる」。
	 *
	 * `allowNoMedia` のときにここで `onCancel()`（= 画面を閉じる）へ倒すと、★・コメント・価格・
	 * カテゴリを入力済みでも「写真を追加」の再選択が失敗しただけで入力が丸ごと消える
	 *（フォーム自体は unmount される）。写真なしはそもそも許可されているモードなので、
	 * `setMediaState({ status: "none" })` でフォームへ戻せば入力は生き残る。
	 * `allowNoMedia` でないとき（既定・`review-from-media` を含む）は従来どおり `onCancel()`。
	 */
	const handleCancel = useCallback(() => {
		if (allowNoMedia) {
			setMediaState({ status: "none" });
			return;
		}
		onCancel();
	}, [allowNoMedia, onCancel]);

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
						{mediaState.isPermissionError ? (
							// 権限拒否は「もう一度」しても同じ結果にしかならない。設定へ直行させる
							<TouchableOpacity
								testID="review-open-settings"
								style={styles.primaryButton}
								onPress={() => {
									void Linking.openSettings();
								}}>
								<Text style={styles.primaryButtonText}>{i18n.t("Map.media.openSettings")}</Text>
							</TouchableOpacity>
						) : (
							<TouchableOpacity style={styles.primaryButton} onPress={handleRetry}>
								<Text style={styles.primaryButtonText}>{i18n.t("Common.retry")}</Text>
							</TouchableOpacity>
						)}
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
				/*
				#1629 オーナー実機報告「レビューで価格入力時にキーボードで隠れる」。

				真因は **キーボード回避が 1 つも効いていなかった**こと。外側の `KeyboardAvoidingView` は
				`behavior` を渡していないため（下の `keyboardAvoidingView` のコメント参照）
				**何もしない**。価格・コメントはフォームの下半分にあるので、そのままキーボードの下へ入る。

				iOS はここで native の UIScrollView にキーボードぶんのインセットを入れさせる。
				`KeyboardAvoidingView` で外枠を縮める手もあるが、そちらは **フォーカスした入力欄まで
				運んでくれない**（縮むだけで、隠れている欄は隠れたまま）。
				`automaticallyAdjustKeyboardInsets` は native 側がインセットと
				«フォーカス中の入力欄までのスクロール» の両方をやる。

				Android は OS が window を縮め（`softwareKeyboardLayoutMode` の既定 = resize）、
				ScrollView が自分でフォーカス中の欄まで運ぶので、こちら側では何もしない
				（`app/[locale]/add-record.tsx` が #1375 3 巡目で同じ判断をして実機で直っている）。
				*/
				automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
				contentContainerStyle={styles.scrollContent}>
				{/* #1375 実機確認（5 巡目）: manual（記録フロー）では **高さを固定しない**。
				    «写真を撮る / ライブラリ / このお店の写真から選ぶ / スキップ» を積むと
				    `mediaHeight` に収まらず、上の見出しと下のスキップが切れた（撮って気づいた）。
				    auto では従来どおり «プレビュー 1 枚» なので固定のままでよい */}
				{/* 1 歩目: 料理カテゴリー。決まるまで写真も他の入力も出さない（DishCategoryStep のヘッダ参照） */}
				{needsDishCategoryFirst ? (
					<View style={styles.dishCategoryStepContainer}>
						<DishCategoryStep
							restaurantId={restaurant.id}
							onSelectExisting={handleSelectDishCategoryInline}
							onSubmitTyped={handleCreateDishCategoryFromName}
							testID="review-dish-category-step"
						/>
						{dishCategoryError && (
							<Text style={styles.errorText} accessibilityLiveRegion="polite">
								{dishCategoryError}
							</Text>
						)}
					</View>
				) : (
					<>
						{/*
						#1629【オーナー指示】**料理カテゴリーは写真の «上» に置く。**

						> 料理カテゴリーを決めた後にメディアを選ぶと思うんですけど…
						> 料理カテゴリー選択は写真の上に持ってきちゃいましょう。

						記録の順番は «お店 → 料理カテゴリー → 写真 → 残りの入力» なので、決めた順に上から
						並んでいるのが読みやすい。以前はコメント欄の下（写真より **後**）に居たため、
						«さっき決めたはずのものが、写真より下に出てくる» 形になっていた。
						*/}
						<View style={styles.dishCategoryRowAbovePhoto}>
						{/* 料理カテゴリ選択 Pressable 行 */}
						{/*
						#1629【オーナー指示】**料理カテゴリーは、ここでは変えられない。**

						> 料理カテゴリは変えれなくして欲しい。店は変えたらその他クリアで良い。

						料理カテゴリーは «お店 → 料理 → 写真» の 2 歩目で決まる。ところがこの行から
						後で変えられたため、**先に決まった料理を前提に選んだ写真**（«この店の写真から選ぶ» は
						その料理で絞り込んでいる）と食い違わせることができた。うどんの写真を選んだあとに
						寿司へ変えれば、うどんの写真が寿司の記録として投稿できてしまう。

						選び直す道が塞がるわけではない。**お店を選び直せば全部やり直しになる**
						（`add-record.tsx` が `key={restaurantId}` でフォームごと作り直すので、
						料理カテゴリーも写真も残らない）。オーナーの «店は変えたらその他クリアで良い» はこれである。

						⚠️ `Pressable` のままにしてあるのは、`disabled` の意味を «押せない» に一本化するため。
						   `View` へ変えると accessibility の役割まで変わる。
						*/}
						<Pressable
							testID="review-dish-category-row"
							style={styles.dishCategorySelectRow}
							onPress={handleOpenDishCategory}
							disabled
							accessibilityRole="text"
							accessibilityLabel={i18n.t("Map.actions.selectDishCategory")}>
							{/* #644 【UX】料理カテゴリラベルにアイコン追加 + prefilledMedia 時は「料理カテゴリ」に変更 */}
							<View style={styles.inputRowLabelWithIcon}>
								<Utensils size={18} color={colors.textSecondary} />
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
								{/* #1629 押せなくなったので «押せる» の記号（>）は出さない */}
							</View>
						</Pressable>
						{dishCategoryError && (
							<Text style={styles.errorText} accessibilityLiveRegion="polite">
								{dishCategoryError}
							</Text>
						)}
						</View>
						<View
							testID="review-media-slot"
							style={
								showsManualMediaChooser && showsNoMediaPlaceholder
									? { marginTop: 16 }
									: { height: mediaHeight, marginTop: 16 }
							}>
							{mediaState.status === "loading" ? (
								<View style={styles.loadingContainer}>
									<LoadingIndicator size="large" />
									<Text style={styles.loadingText}>{i18n.t("Map.media.loadingMedia")}</Text>
								</View>
							) : mediaState.status === "none" ? (
								/**
								 * #1398 B3 【設計】写真なしのプレビュー枠。
								 *
								 * タップで `handleRetry`（= マウント時と同じ `runMediaSelection`）を起動して
								 * ピッカーを開き直せる。つまり `none` は行き止まりではなく、いつでも `success` へ戻れる。
								 * サブラベルは「写真なしが機能欠落ではなく仕様である」ことを示すために置く（設計 §4-1）。
								 */
								/**
								 * #1375 4 巡目: 「ライブラリから選ぶのか、その場で撮るのか」の導線を明示する。
								 * placeholder 全体タップ = ライブラリ（従来挙動・テスト互換）に加え、
								 * カメラ起動のボタンを並べる。写真なしでも記録できる旨は従来どおり言う
								 */
								/**
								 * #1375 実機確認（5 巡目）: 並びをオーナー指定の順にした。
								 * **上に «自分で撮影して追加»（主）→ ライブラリ → 小さくスキップ**。
								 * 4 巡目までは «写真を追加» の見出しの下に 2 択が並び、スキップに当たる
								 * «写真なしでも記録できます» はただの説明文で押せなかった。
								 * 「スキップ」は押せる必要がある（写真なしで記録する、が 1 タップで済むように）。
								 *
								 * ⚠️ placeholder 全体タップ = ライブラリ、は従来挙動なので変えない
								 * （既存テストと実機の指の記憶の両方が乗っている）
								 */
								<Pressable
									testID="review-add-photo-placeholder"
									style={styles.noMediaPlaceholder}
									onPress={handleRetry}
									accessibilityRole="button"
									accessibilityLabel={i18n.t("MyDishes.record.noPhotoTitle")}>
									<ImagePlus size={28} color={colors.textTertiary} style={styles.noMediaIcon} />
									<Text style={styles.noMediaTitle} numberOfLines={1}>
										{i18n.t("MyDishes.record.noPhotoTitle")}
									</Text>
									<View style={styles.mediaSourceColumn}>
										<TouchableOpacity
											testID="review-shoot-with-camera"
											style={[styles.mediaSourceButton, styles.mediaSourceButtonPrimary]}
											onPress={handleShootWithCamera}
											accessibilityRole="button">
											<Camera size={16} color={colors.ctaLabel} />
											<Text style={[styles.mediaSourceLabel, styles.mediaSourceLabelPrimary]}>
												{i18n.t("Map.media.shootWithCamera")}
											</Text>
										</TouchableOpacity>
										<TouchableOpacity
											testID="review-pick-from-library"
											style={styles.mediaSourceButton}
											onPress={handleRetry}
											accessibilityRole="button">
											<ImagePlus size={16} color={colors.textSecondaryStrong} />
											<Text style={styles.mediaSourceLabel}>{i18n.t("Map.media.pickFromLibrary")}</Text>
										</TouchableOpacity>
									</View>
									{/* #1375（5 巡目）「その下に既存のディッシュメディアから選べるように」。
							    親から prefilledMedia が来ている画面（店舗フィードからの記録）では出さない
							    — そちらは «そのメディアの記録» と決まっているため */}
									{needsMediaChoiceFirst && (
										/* #1375（6 巡目）先に決まった料理カテゴリーで絞る。
								   «その料理の、この店の写真» だけが出る（決まっていなければ店全体） */
										<ExistingDishMediaPicker
											restaurantId={restaurant.id}
											dishCategoryId={dishCategoryId}
											onSelect={(media) => {
												setPickedExistingMedia(media);
												setHasDecidedMedia(true);
											}}
										/>
									)}
									{/* スキップ。**小さく**（主導線ではないが、押せる必要がある） */}
									{/* #1375（オーナー指示 7 巡目）写真を «決めたあと» は畳む（入力の邪魔にしない）。
									    ただし auto モード（ピッカーを開いてキャンセルした経路・#1398 B2）では
									    «写真なしでも記録できる» ことを示す唯一の手段なので出し続ける */}
									{allowNoMedia && !(mediaPickerMode === "manual" && hasDecidedMedia) && (
										<TouchableOpacity
											testID="review-skip-photo"
											style={styles.skipPhotoButton}
											onPress={handleSkipPhoto}
											accessibilityRole="button"
											accessibilityLabel={i18n.t("MyDishes.record.skipPhoto")}>
											<Text style={styles.skipPhotoLabel}>{i18n.t("MyDishes.record.skipPhoto")}</Text>
										</TouchableOpacity>
									)}
								</Pressable>
							) : (
								<View style={styles.previewWrap}>
									<InitialMediaPreview media={mediaState.media} />
									{/*
									#1629【オーナー指示】**«選び直す» と «自分の写真に差し替える» を同時に出さない。**

									> 写真を撮り直すと自分の写真に差し替えるが同時に出るパターンってある？
									> なければどちらも右下寄せで

									実際には出ていた（記録フローで «この店の写真から選ぶ» を使った場合）。しかも
									«選び直す» の行き先には «ライブラリから選ぶ» が含まれるので、2 つは機能が重なる。
									そこで **入口で 1 つに決める**:

									| 画面 | 出るボタン |
									| --- | --- |
									| 記録フロー（自分で写真を決める） | «写真を選び直す»（選び方の 1 歩目へ戻る） |
									| 店舗フィードからの記録（写真は親が決めている） | «自分の写真に差し替える» |

									排他になったので、どちらも同じ位置（右下）に置ける。
									*/}
									{isRecordFlowMedia ? (
										<TouchableOpacity
											testID="review-reselect-media"
											style={styles.replacePhotoButton}
											onPress={handleReselectMedia}
											accessibilityRole="button"
											accessibilityLabel={i18n.t("Map.media.reselectPhoto")}>
											<ImagePlus size={14} color={FixedColors.onMedia} />
											<Text style={styles.replacePhotoLabel}>{i18n.t("Map.media.reselectPhoto")}</Text>
										</TouchableOpacity>
									) : null}
									{/* #1375 実機確認（2 巡目）: 食べたを記録（prefilledMedia モード）でも
							    自分で撮った写真に差し替えられる入口を出す */}
									{!isRecordFlowMedia && effectivePrefilledMedia !== undefined && (
										<TouchableOpacity
											testID="review-replace-with-my-photo"
											style={styles.replacePhotoButton}
											onPress={() => {
												lightImpact();
												setUseOwnMedia(true);
											}}
											accessibilityRole="button"
											accessibilityLabel={i18n.t("Map.media.replaceWithMyPhoto")}>
											{/* メディアプレビューの上に載る半透明暗地のボタンなので、テーマに依らず白で固定する */}
											<ImagePlus size={14} color={FixedColors.onMedia} />
											<Text style={styles.replacePhotoLabel}>{i18n.t("Map.media.replaceWithMyPhoto")}</Text>
										</TouchableOpacity>
									)}
								</View>
							)}
						</View>
						{/* #1375（オーナー指示 7 巡目）**写真を決めるまでフォームは出さない。**
						    お店 → 料理カテゴリー → 写真 → 入力、と 1 歩ずつにする。
						    最初から «写真の選び方 + コメント + 料理 + 価格 + 星» が同時に出ていると
						    何をすればよいか読み取れない、というオーナー指摘への対処 */}
						{!needsMediaChoiceFirst && (
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
									placeholderTextColor={colors.textPlaceholder}
									placeholder={i18n.t("Map.placeholders.enterReviewShort")}
									value={reviewText}
									onChangeText={setReviewText}
									multiline
									numberOfLines={4}
									textAlignVertical="top"
									maxLength={100}
								/>
								<Text style={styles.characterCount}>
									{i18n.t("Restaurant.characterCount", { current: reviewText.length, max: 100 })}
								</Text>
							</View>

							{/* 価格入力 行 */}
							<View style={styles.priceInputRow}>
								{/* #644 【UX】価格ラベルにアイコン追加 */}
								<View style={styles.inputRowLabelWithIcon}>
									<CircleDollarSign size={18} color={colors.textSecondary} />
									<Text style={styles.inputRowLabel}>{i18n.t("Map.placeholders.enterPrice")}</Text>
								</View>
								{currencySymbol ? (
									<View style={styles.priceInputContainer}>
										<Text style={styles.currencySymbol}>{currencySymbol}</Text>
										<TextInput
											testID="review-price-input"
											style={[styles.textInput, styles.priceInput]}
											placeholder={"0"}
											placeholderTextColor={colors.textPlaceholder}
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
										placeholderTextColor={colors.textPlaceholder}
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
									<ThumbsUp size={18} color={colors.textSecondary} />
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
														color={isActive ? FixedColors.ratingActive : colors.trackMuted}
														fill={isActive ? FixedColors.ratingActive : "transparent"}
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
								<Text
									testID="review-consent-guidelines-link"
									style={styles.consentLink}
									onPress={() => handleOpenLegalDocument("guidelines")}>
									{i18n.t("Map.consent_review_guidelines")}
								</Text>
								{i18n.t("Map.consent_review_and")}
								<Text
									testID="review-consent-copyright-link"
									style={styles.consentLink}
									onPress={() => handleOpenLegalDocument("copyright")}>
									{i18n.t("Map.consent_review_copyright")}
								</Text>
								{i18n.t("Map.consent_review_suffix")}
							</Text>

							{/*
						#1398 R4 【設計】記録は「非公開の食事ログ」に見えやすいが、実際は公開レビューであり
						店舗の平均評価にも載る（#1375 追補 決定1）。誤解を招く UI のまま出さないため、同意文言の
						直下に 1 行足す。

						#1441 N-2 【レビュー対応】以前は `allowNoMedia` のときだけ描画していたが、
						リーダー判断の R4 は描画画面を限定していない。`review-from-media` 経路（prefilledMedia）
						も同じく公開レビューになるので常時表示へ変更した。
					*/}
							<Text testID="review-public-notice" style={styles.publicNoticeText}>
								{i18n.t("MyDishes.record.publicReviewNotice")}
							</Text>
						</View>
						)}
					</>
				)}
			</ScrollView>

			{/* 投稿ボタン */}
			{!isKeyboardVisible && !needsMediaChoiceFirst && !needsDishCategoryFirst && (
				<View style={[styles.buttonContainer, { paddingBottom: 12 + insets.bottom }]}>
					<PrimaryButton
						testID="review-submit-button"
						label={i18n.t("Common.postReview")}
						onPress={handleSubmit}
						// #1136 【設計】投稿中はボタン内に既存の LoadingIndicator（Lottie）を出す。
						// PrimaryButton 側で loading は disabled も兼ねる（`isDisabled = disabled || loading`）ため、
						// 表示と操作可否がズレない。進捗率は取得できないので不定形スピナーで十分とする
						loading={isSubmitting}
						disabled={isProcessing || !isValid}
						// #1375（5 巡目・デザインレビュー #4）無効時は透過ではなく灰へ。
						// 赤に透過を掛けると白文字が読めなくなる（参照実装の検索画面と同じ手）
						colors={isProcessing || !isValid ? [colors.ctaBackgroundDisabled, colors.ctaBackgroundDisabled] : undefined}
						shadowColor="transparent"
						style={{ marginHorizontal: 16 }}
					/>
				</View>
			)}
		</KeyboardAvoidingView>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
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
			color: c.textMuted,
		},
		errorCard: {
			padding: 24,
			width: "100%",
		},
		errorTitle: {
			fontSize: 20,
			fontWeight: "700",
			color: c.textPrimary,
			marginBottom: 12,
			textAlign: "center",
		},
		errorMessage: {
			fontSize: 16,
			color: c.textSecondary,
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
			backgroundColor: c.brand,
			paddingVertical: 14,
			borderRadius: 12,
			alignItems: "center",
		},
		primaryButtonText: {
			fontSize: 16,
			fontWeight: "600",
			// ブランド色（ライト / ダークで同値）で塗った地の上の文字なので固定でよい
			color: FixedColors.onFilled,
		},
		secondaryButton: {
			flex: 1,
			backgroundColor: c.surfaceSubtle,
			paddingVertical: 14,
			borderRadius: 12,
			alignItems: "center",
		},
		secondaryButtonText: {
			fontSize: 16,
			fontWeight: "600",
			color: c.textSecondary,
		},
		inputLabel: {
			fontSize: 16,
			fontWeight: "600",
			color: c.textStrong,
			marginBottom: 8,
		},
		container: {
			flex: 1,
			backgroundColor: c.surface,
		},
		/*
		#644 【UX】キーボード表示時の位置調整。

		⚠️ #1629: この `KeyboardAvoidingView` は **`behavior` を渡していないので何もしない**
		（RN の既定は undefined ＝ 無効）。回避そのものは ScrollView 側の
		`automaticallyAdjustKeyboardInsets`（iOS）と OS の window リサイズ（Android）が担う。
		ここへ `behavior` を足すと、その 2 つと二重に掛かって縮みすぎるので足さないこと。
		残しているのは «投稿ボタンを ScrollView の外へ置く» ための器としてである。
		*/
		keyboardAvoidingView: {
			flex: 1,
		},
		scrollContent: {
			paddingBottom: 64,
		},
		// #1629 写真の上へ移した料理カテゴリー行。左右の余白は formContainer と揃える
		dishCategoryRowAbovePhoto: {
			paddingHorizontal: 16,
			paddingTop: 16,
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
			color: c.textStrong,
		},
		textArea: {
			height: 100,
			textAlignVertical: "top",
			borderWidth: 1,
			borderColor: c.trackMuted,
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
			color: c.textStrong,
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
		// #1375（5 巡目・デザインレビュー #15）すぐ上のレビュー欄は枠があるのに、
		// ここだけ枠が無く «押せる物» に見えなかった
		priceInputContainer: {
			borderWidth: 1,
			borderColor: c.trackMuted,
			flexDirection: "row",
			alignItems: "center",
			borderRadius: 8,
			minWidth: 120,
			marginRight: 12,
		},
		inputRowLabel: {
			fontSize: 15,
			color: c.textStrong,
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
			borderBottomColor: c.trackMuted,
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
			color: c.textStrong,
			textAlign: "right",
			marginRight: 12,
		},
		currencySymbol: {
			fontSize: 16,
			fontWeight: "600",
			color: c.textMuted,
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
			color: c.danger,
			fontSize: 12,
			paddingHorizontal: 4,
		},
		consentText: {
			fontSize: 12,
			color: c.textSecondary,
			textAlign: "left",
			lineHeight: 18,
		},
		consentLink: {
			// #1375（5 巡目・デザインレビュー #3）パレットに無い青をやめ、下線でリンクと示す
			color: c.textPrimaryAlt,
			textDecorationLine: "underline",
		},
		// #1398 R4 同意文言の直下に置く「公開レビューになる」告知
		publicNoticeText: {
			fontSize: 12,
			color: c.textSecondary,
			textAlign: "left",
			lineHeight: 18,
			marginTop: 8,
		},
		// #1398 B3 写真なし（status: "none"）のプレビュー枠
		// #1441 N-1 【レビュー対応】window 高 667pt（iPhone SE 等）では枠の高さが 81px しか無く、
		// 旧サイズ（アイコン 40 + gap 8 + 16px タイトル + gap 8 + 13px ヒント ≒ 91px）だとはみ出していた。
		// アイコンと余白を縮め、`flexShrink` も添えて小型端末でも収まるようにする
		previewWrap: {
			flex: 1,
		},
		replacePhotoButton: {
			position: "absolute",
			right: 8,
			bottom: 8,
			flexDirection: "row",
			alignItems: "center",
			gap: 4,
			paddingHorizontal: 10,
			paddingVertical: 6,
			borderRadius: 14,
			backgroundColor: "rgba(17,24,39,0.7)",
		},
		replacePhotoLabel: {
			fontSize: 11,
			fontWeight: "700",
			// メディアプレビューの上に載る半透明暗地のボタンなので、テーマに依らず白で固定する
			color: FixedColors.onMedia,
		},
		noMediaPlaceholder: {
			flex: 1,
			flexShrink: 1,
			justifyContent: "center",
			alignItems: "center",
			gap: 4,
			// 中身（見出し・ボタン・既存メディア・スキップ）が枠に接しないようにする。
			// 以前は 0 で、manual のときスキップが破線の枠へ重なって見えた
			paddingVertical: 14,
			marginHorizontal: 16,
			borderRadius: 12,
			borderWidth: 1,
			borderStyle: "dashed",
			borderColor: c.trackMuted,
			backgroundColor: c.surfaceFaint,
		},
		noMediaIcon: {
			flexShrink: 1,
		},
		noMediaTitle: {
			fontSize: 14,
			fontWeight: "600",
			color: c.textSecondaryStrong,
			flexShrink: 1,
		},
		noMediaHint: {
			fontSize: 12,
			color: c.textSecondary,
			flexShrink: 1,
		},
		// #1375 5 巡目: 縦に積む（上が «自分で撮影して追加» の主導線）。
		// 4 巡目は横並びで «どちらが主か» が読めなかった
		mediaSourceColumn: {
			gap: 8,
			marginTop: 12,
			marginBottom: 4,
			alignSelf: "stretch",
			paddingHorizontal: 24,
		},
		mediaSourceButton: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: 6,
			paddingHorizontal: 14,
			paddingVertical: 10,
			borderRadius: 12,
			backgroundColor: c.surfaceSubtle,
		},
		// «自分で撮影して追加» はこの領域の主導線。濃灰で埋める
		// （赤は画面に 1 つの主 CTA = «投稿する» に譲る。docs/design-guidelines.md §1）
		// #1509 ライトの «濃灰の地に白文字» はダークでは沈むので、反転する CTA トークンで受ける
		// （ctaBackground/ctaLabel はダークで «明るい地に暗い文字» へ入れ替わる）
		mediaSourceButtonPrimary: {
			backgroundColor: c.ctaBackground,
		},
		mediaSourceLabelPrimary: {
			color: c.ctaLabel,
		},
		// スキップは «小さく»（オーナー指定）。押せるが主導線ではない
		skipPhotoButton: {
			marginTop: 4,
			paddingHorizontal: 10,
			paddingVertical: 6,
		},
		skipPhotoLabel: {
			fontSize: 12,
			fontWeight: "600",
			color: c.textSecondary,
			textDecorationLine: "underline",
		},
		mediaSourceLabel: {
			fontSize: 13,
			fontWeight: "700",
			color: c.textSecondaryStrong,
		},
		characterCount: {
			fontSize: 12,
			color: c.textSecondary,
			textAlign: "right",
			marginTop: 4,
		},
		// #1375（6 巡目）記録フローの 1 歩目（料理カテゴリー）の器。左右余白は下のフォームと揃える
		dishCategoryStepContainer: {
			marginTop: 16,
			paddingHorizontal: 16,
			gap: 8,
		},
		// #1375 実機確認: Android のジェスチャーナビゲーションでは画面下端に system inset があり、
		// この投稿ボタンがその下に潜って押せなかった。呼び出し側の 2 画面（review.tsx /
		// review-from-media）はどちらも SafeAreaView を持たないので、下端の確保はここで行う。
		// `paddingBottom` は描画時に `insets.bottom` を足して上書きする
		buttonContainer: {
			paddingTop: 12,
			paddingBottom: 12,
			borderTopWidth: 1,
			borderTopColor: c.border,
			backgroundColor: c.surface,
		},
	});
