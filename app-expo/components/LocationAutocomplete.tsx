import React, { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Keyboard } from "react-native";
import { useLocationSearch, type LocationSearchStatus } from "@/hooks/useLocationSearch";
import { useHaptics } from "@/hooks/useHaptics";
import i18n from "@/lib/i18n";
import { type AutocompleteLocation } from "@shared/api/v1/res";
import { isFoodAndDrinkPlaceForUser } from "@shared/utils/google_places_restaurant_type";
import { MapPin, Utensils, X, History, Trash2, Check, AlertCircle } from "lucide-react-native";
import type { LocationDetailsResponse } from "@shared/api/v1/res";
import { LoadingIndicator } from "./LoadingIndicator";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

// #932 【設計】現在地取得の失敗時、呼び出し元(検索画面)から「手入力を促すフォーカス移動」を
// 行うための最小限の命令的ハンドル
export interface LocationAutocompleteHandle {
	focus: () => void;
}

/**
 * #953 【仕様】details API のレスポンスから viewport を除いたもの＋検索画面の表示用文字列。
 * 「最近使った場所」として再選択した際に details API を呼び直さず復元できる形にする。
 */
export type RecentLocation = Omit<LocationDetailsResponse, "viewport"> & {
	locationQuery: string;
};

interface LocationAutocompleteProps {
	/** Current value of the input */
	value: string;
	/** Called when text changes */
	onChangeText: (text: string) => void;
	/** Called when a suggestion is selected */
	onSelectSuggestion: (location: AutocompleteLocation) => void;
	/** Called when clear button is pressed */
	onClear?: () => void;
	/** Placeholder text for the input */
	placeholder?: string;
	/** Optional right-side icon or element */
	renderInputRight?: React.ReactNode;
	/** Whether to auto focus the input when mounted */
	autofocus?: boolean;
	/** Whether to auto clear input on focus */
	autoClearOnFocus?: boolean;
	/** Test ID for testing */
	testID?: string;
	/** #953 未入力でのフォーカス時に「最近使った場所」として提示する候補(最大5件) */
	recentLocations?: RecentLocation[];
	/** #953 「最近使った場所」の1件が選択されたときのハンドラ */
	onSelectRecentLocation?: (location: RecentLocation) => void;
	/** #953 「最近使った場所」を全件クリアするハンドラ。未指定なら消去ボタンを出さない */
	onClearRecentLocations?: () => void;
	/**
	 * #1502 【設計】候補選択後、details API(緯度経度の取得)が完了するまでの状態。
	 * 検索候補一覧の状態(searchLocations由来)とは別の非同期処理なので独立して持つ。
	 * 未指定/nullなら何も表示しない(現在地・最近使った場所からの選択は details を待たず
	 * 確定するため、呼び出し元がこの状態を経由させるかどうかを選べるようにしてある)。
	 *
	 * 【案A・#1502】成功は文章で語らない。confirming は入力欄右端の小さなスピナー、
	 * confirmed は右端に ✓ を一瞬出すだけ(値の正式地名への置き換えは呼び出し元が行う)。
	 * error だけが言葉(赤の1行+再試行)を持つ。
	 */
	confirmationStatus?: "confirming" | "confirmed" | "error" | null;
	/** #1502 confirmationStatus が "error" のときの再試行ハンドラ */
	onRetryConfirmation?: () => void;
}

// ===== Tunables (ベストプラクティス的にマジックナンバーを定数化) =====
const MIN_SEARCH_LENGTH = 1;
const DEBOUNCE_DELAY_MS = 300;
const BLUR_SUGGESTION_HIDE_DELAY_MS = 150;
const BLUR_AFTER_SELECT_DELAY_MS = 100;
const AUTOFOCUS_DELAY_MS = 100;
/**
 * #1502 【設計】確定 ✓ を入力欄右端に出しておく時間。
 * Android の Toast.LENGTH_SHORT(2000ms)に合わせた。✓ は文章を読ませる表示ではないので
 * LENGTH_LONG(3500ms)は長すぎ、1秒未満だと「入力欄の値が正式地名に置き換わった理由」を
 * 掴む前に消えてしまう。加えて Detox の同期機構は 1.5 秒以下のタイマーを idle 待ちの
 * 対象にするため、1.5 秒以下にすると E2E の可視待ちがタイマー完了(=✓が消えた後)まで
 * 進まず「✓ を観測できない」ことになる。2000ms はその閾値も超えている。
 */
const CONFIRMED_BADGE_DURATION_MS = 2000;

/**
 * #991 【修正】web でサジェストパネル内の mousedown の既定動作(TextInput からのフォーカス移動)を
 * 抑止する props。抑止しないと mousedown → 即 blur → 150ms 後にパネル非表示が予約され、
 * mousedown→mouseup が 150ms を超える人間の普通のクリックでは「押し終わる前に行が消えて
 * onPress(=mouseup 時)が発火しない」= 選択が成立しない不具合になる(タッチ操作では blur の
 * 発生順序が異なるため起きず、デスクトップのマウス操作でのみ発生していた)。
 * react-native-web は未知の props をそのまま DOM へ forward するため onMouseDown を直接渡せる
 * (#935 の onKeyDown と同じパターン)。native には mouse イベントが存在しないため影響しない。
 */
const preventFocusStealOnWeb = {
	onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault(),
} as Record<string, unknown>;

/**
 * Unified location autocomplete component that combines text input and suggestions.
 * Handles debouncing, API calls, keyboard navigation, and accessibility.
 */
export const LocationAutocomplete = forwardRef<LocationAutocompleteHandle, LocationAutocompleteProps>(
	function LocationAutocomplete(
		{
			value,
			onChangeText,
			onSelectSuggestion,
			onClear,
			placeholder = i18n.t("Search.currentLocation"),
			autoClearOnFocus = false,
			autofocus = false,
			renderInputRight,
			testID = "location-autocomplete",
			recentLocations = [],
			onSelectRecentLocation,
			onClearRecentLocations,
			confirmationStatus = null,
			onRetryConfirmation,
		},
		ref,
	) {
		// #1509 地点入力は検索フォームの主役なので、基盤と同じ PR でテーマ対応する
		const { colors } = useAppTheme();
		const styles = useThemedStyles(createStyles);
		const [showSuggestions, setShowSuggestions] = useState(false);
		const [isFocused, setIsFocused] = useState(false);
		// #931 【設計】デバウンス待機中(=まだAPIを呼んでいない)かどうかはHookの外側(このコンポーネント)でしか
		// 分からないため、ローカルで保持しHookの status と合成して表示状態を決定する。
		const [isDebouncing, setIsDebouncing] = useState(false);
		const inputRef = useRef<TextInput>(null);
		const debounceRef = useRef<number | null>(null);
		// #931 【設計】ブラーによる遅延非表示タイマー。フォーカスが戻った場合はキャンセルする必要がある
		// (例: 再試行ボタン押下でクリック直後に blur→非表示が予約された後、focus() で復帰するケース)
		const blurTimeoutRef = useRef<number | null>(null);
		// #931 【設計】エラー時の再試行ボタンで直前のクエリを再実行するために保持
		const lastQueryRef = useRef("");

		const { suggestions, status, searchLocations, clearSuggestions } = useLocationSearch();
		const { lightImpact } = useHaptics();

		// #1502 【設計・案A】確定 ✓ は「一瞬」だけ出す。confirmationStatus 自体は呼び出し元が
		// confirmed のまま保持し続ける(次の操作まで有効な状態)ため、表示の寿命だけを
		// ここでローカルに持つ。confirmed 以外へ遷移したら即座に消す。
		const [showConfirmedBadge, setShowConfirmedBadge] = useState(false);
		useEffect(() => {
			if (confirmationStatus !== "confirmed") {
				setShowConfirmedBadge(false);
				return;
			}
			setShowConfirmedBadge(true);
			const timer = setTimeout(() => setShowConfirmedBadge(false), CONFIRMED_BADGE_DURATION_MS);
			return () => clearTimeout(timer);
		}, [confirmationStatus]);

		// #932 【設計】現在地取得の失敗時に呼び出し元から手入力へ誘導できるよう focus() を公開する
		useImperativeHandle(ref, () => ({
			focus: () => inputRef.current?.focus(),
		}));

		// Auto focus on mount if requested
		useEffect(() => {
			if (!autofocus) return;

			const timer = setTimeout(() => {
				inputRef.current?.focus();
			}, AUTOFOCUS_DELAY_MS);

			return () => clearTimeout(timer);
		}, [autofocus]);

		// Handle text changes with debouncing
		const handleTextChange = useCallback(
			(text: string) => {
				onChangeText(text);

				const trimmed = text.trim();
				const hasEnoughChars = trimmed.length >= MIN_SEARCH_LENGTH;

				// Clear previous debounce timer
				if (debounceRef.current) {
					clearTimeout(debounceRef.current);
				}

				// Show suggestions if there's text and input is focused
				setShowSuggestions(trimmed.length > 0 && isFocused);

				// #931 【修正】検索条件を満たさない場合は Hook 側の候補も破棄する。
				// 従来は表示フラグを畳むだけで suggestions が残存し、再入力の1文字目で
				// 直前の(無関係な)候補が一瞬再表示されるバグがあった。
				if (!hasEnoughChars) {
					setIsDebouncing(false);
					clearSuggestions();
					return;
				}

				// #931 【設計】デバウンス待機中フラグを立てる。この間は "debouncing" として
				// ローディング表示のみ行い、0件文言のフラッシュを防ぐ。
				setIsDebouncing(true);

				// Debounce the API call
				debounceRef.current = setTimeout(() => {
					setIsDebouncing(false);
					lastQueryRef.current = trimmed;
					searchLocations(trimmed).catch((error) => {
						console.warn("Location search failed:", error);
					});
				}, DEBOUNCE_DELAY_MS) as unknown as number;
			},
			[onChangeText, searchLocations, isFocused, clearSuggestions],
		);

		// Handle input focus
		const handleFocus = useCallback(() => {
			// #931 【修正】直前の blur による遅延非表示予約が残っている場合はキャンセルする。
			// キャンセルしないと、再フォーカス直後に表示した結果パネルが遅れて閉じてしまう
			// (再試行ボタン押下 → blur予約 → focus復帰 → 予約がそのまま発火、という不具合があった)
			if (blurTimeoutRef.current) {
				clearTimeout(blurTimeoutRef.current);
				blurTimeoutRef.current = null;
			}

			setIsFocused(true);

			if (autoClearOnFocus && value.length > 0) {
				// クリアボタンと同じ順序に揃える
				onChangeText("");
				onClear?.();

				// #931 【修正】自動クリア時も Hook 側の候補・状態を初期化し、
				// 直後の入力で無関係な旧候補が再表示されないようにする
				if (debounceRef.current) {
					clearTimeout(debounceRef.current);
				}
				setIsDebouncing(false);
				clearSuggestions();

				// 自動クリアしたときは一旦サジェスト閉じる
				setShowSuggestions(false);
				return;
			}

			// 通常時はそのまま
			setShowSuggestions(value.trim().length > 0);
		}, [autoClearOnFocus, value, onChangeText, onClear]);

		// Handle input blur
		const handleBlur = useCallback(() => {
			// Delay hiding suggestions to allow for suggestion selection
			blurTimeoutRef.current = setTimeout(() => {
				setIsFocused(false);
				setShowSuggestions(false);
				blurTimeoutRef.current = null;
			}, BLUR_SUGGESTION_HIDE_DELAY_MS) as unknown as number;
		}, []);

		// Handle suggestion selection
		const handleSuggestionPress = useCallback(
			(suggestion: AutocompleteLocation) => {
				lightImpact();
				// #528 【設計】キーボードを閉じる責務は子（＝候補を押されたこのコンポーネント）が持つ。
				// 以前は親の BlurModal がタップ**開始**時に閉じており、レイアウト再計算で候補リストが
				// unmount されて onPress が潰れていた。onPress まで来ていればタップは成立済みなので、
				// ここで閉じても選択は失われない。
				Keyboard.dismiss();
				onSelectSuggestion(suggestion);
				setShowSuggestions(false);

				// Delay blur to allow parent state update to complete
				// （web では Keyboard.dismiss が実質何もしないため、blur はこちらで担保する）
				setTimeout(() => {
					inputRef.current?.blur();
				}, BLUR_AFTER_SELECT_DELAY_MS);
			},
			[onSelectSuggestion, lightImpact],
		);

		// #953 【仕様】最近使った場所は details API を呼び直さず、保存済みの location をそのまま復元する
		const handleRecentLocationPress = useCallback(
			(recent: RecentLocation) => {
				lightImpact();
				// #528 候補と同じく、閉じるのは押下成立後（onPress）にこの子が自分で行う
				Keyboard.dismiss();
				onSelectRecentLocation?.(recent);
				setIsFocused(false);

				setTimeout(() => {
					inputRef.current?.blur();
				}, BLUR_AFTER_SELECT_DELAY_MS);
			},
			[onSelectRecentLocation, lightImpact],
		);

		// Handle clear button press
		const handleClear = useCallback(() => {
			lightImpact();
			onChangeText("");
			setShowSuggestions(false);

			// #931 【修正】クリア操作では query だけでなく Hook 側の候補・状態も同時初期化する
			// (座標や選択状態の初期化は onClear 経由で呼び出し元の handleLocationClear が担う)
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}
			setIsDebouncing(false);
			clearSuggestions();

			if (onClear) {
				onClear();
			}
			inputRef.current?.focus();
		}, [onChangeText, onClear, lightImpact, clearSuggestions]);

		// Cleanup debounce timer on unmount
		useEffect(() => {
			return () => {
				if (debounceRef.current) {
					clearTimeout(debounceRef.current);
				}
				if (blurTimeoutRef.current) {
					clearTimeout(blurTimeoutRef.current);
				}
			};
		}, []);

		// #931 【設計】検索失敗時の再試行。直前に実際に投げたクエリ(lastQueryRef)を再送する。
		// 再試行ボタンはTextInputの外側にあるため押下でblurが発生し結果パネルが閉じてしまう。
		// 明示的に再フォーカスして handleFocus 側のキャンセル処理でパネルを開いたままにする。
		const handleRetry = useCallback(() => {
			if (!lastQueryRef.current) return;
			inputRef.current?.focus();
			searchLocations(lastQueryRef.current).catch((error) => {
				console.warn("Location search retry failed:", error);
			});
		}, [searchLocations]);

		const trimmedValueLength = value.trim().length;
		const hasEnoughCharsForSearch = trimmedValueLength >= MIN_SEARCH_LENGTH;

		// #931 【設計】デバウンス待機中はHookの検索がまだ始まっていないため、ローカルの isDebouncing を
		// 優先した合成ステータスを画面表示に使う。これにより「デバウンス中に0件文言が一瞬出る」バグを防ぐ。
		const displayStatus: LocationSearchStatus | "idle" = !hasEnoughCharsForSearch
			? "idle"
			: isDebouncing
				? "debouncing"
				: status;

		// #953 【仕様】未入力でフォーカスしたときだけ「最近使った場所」を出す。文字入力が始まったら
		// 通常の検索候補(showSuggestions)に切り替わるため、両者は同時に表示されない。
		const showRecentLocations = isFocused && trimmedValueLength === 0 && recentLocations.length > 0;

		return (
			<View style={styles.container}>
				<View style={styles.locationInputContainer}>
					{/* Text Input */}
					<TextInput
						ref={inputRef}
						style={[styles.input, isFocused && styles.inputFocused]}
						value={value}
						onChangeText={handleTextChange}
						onFocus={handleFocus}
						onBlur={handleBlur}
						placeholder={placeholder}
						placeholderTextColor={colors.textSecondary}
						autoComplete="off"
						autoCorrect={false}
						autoCapitalize="words"
						keyboardType="default"
						returnKeyType="search"
						accessibilityLabel={i18n.t("Search.sections.location")}
						accessibilityHint={i18n.t("Search.accessibility.locationInputHint")}
						testID={`${testID}-input`}
					/>
					{/* #1502 【案A】地点確認の進行・成功は入力欄の右端で黙って伝える。
					    確認中: 小さなスピナー(文言なし)。確定: ✓ を一瞬(CONFIRMED_BADGE_DURATION_MS)だけ
					    表示し、あとは値の正式地名への置き換え自体に語らせる。
					    flexDirection:"row" は RTL(ar)で自動反転するため、方向依存の margin を
					    持たせなければ「右端」は行末(RTLでは左端)に正しく追従する */}
					{confirmationStatus === "confirming" && (
						<View style={styles.inputStatusIcon} testID={`${testID}-confirmation-confirming`}>
							<LoadingIndicator size="small" />
						</View>
					)}
					{showConfirmedBadge && (
						<View style={styles.inputStatusIcon} testID={`${testID}-confirmation-confirmed`}>
							<Check size={16} color={colors.success} />
						</View>
					)}
					{/* Clear button */}
					{value.length > 0 && (
						<TouchableOpacity
							style={styles.clearButton}
							onPress={handleClear}
							hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
							accessibilityRole="button"
							accessibilityLabel={i18n.t("Search.accessibility.clearLocation")}
							testID={`${testID}-clear`}>
							<X size={16} color={colors.textSecondary} />
						</TouchableOpacity>
					)}
					{renderInputRight}
				</View>

				{/* #1502 【設計・案A】地点確認でエラーだけが言葉を持つ(現行どおり赤の1行+再試行)。
				    確認中/確定は入力欄右端のアイコンで表現しており、ここには何も出さない。
				    選択直後は handleSuggestionPress が showSuggestions を false にする(#528)ため、
				    候補一覧・最近使った場所パネルとは同時に表示されない */}
				{confirmationStatus === "error" && (
					<View
						style={styles.confirmationErrorContainer}
						{...preventFocusStealOnWeb}
						testID={`${testID}-confirmation-error`}>
						<View style={styles.confirmationContainer}>
							<AlertCircle size={16} color={colors.danger} />
							<Text style={[styles.confirmationText, styles.confirmationTextError]}>
								{i18n.t("Search.locationConfirmation.error")}
							</Text>
						</View>
						<TouchableOpacity
							style={styles.retryButton}
							onPress={onRetryConfirmation}
							accessibilityRole="button"
							accessibilityLabel={i18n.t("Common.retry")}
							testID={`${testID}-confirmation-retry`}>
							<Text style={styles.retryButtonText}>{i18n.t("Common.retry")}</Text>
						</TouchableOpacity>
					</View>
				)}

				{/* #953 最近使った場所 */}
				{showRecentLocations && (
					<View style={styles.suggestionsContainer} {...preventFocusStealOnWeb}>
						<View style={styles.recentLocationsHeader}>
							<Text style={styles.recentLocationsTitle}>{i18n.t("Search.recentLocations.title")}</Text>
							{onClearRecentLocations && (
								<TouchableOpacity
									onPress={onClearRecentLocations}
									hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
									accessibilityRole="button"
									accessibilityLabel={i18n.t("Search.recentLocations.clear")}
									testID={`${testID}-recent-locations-clear`}>
									<Trash2 size={16} color={colors.textTertiary} />
								</TouchableOpacity>
							)}
						</View>
						<ScrollView
							keyboardShouldPersistTaps="handled"
							showsVerticalScrollIndicator={false}
							style={styles.suggestionsList}
							testID={`${testID}-recent-locations`}>
							{recentLocations.map((recent, index) => (
								<TouchableOpacity
									key={`${recent.location.latitude},${recent.location.longitude}`}
									style={[styles.suggestionItem, index === recentLocations.length - 1 && styles.lastSuggestionItem]}
									onPress={() => handleRecentLocationPress(recent)}
									accessibilityRole="button"
									accessibilityLabel={recent.locationQuery}
									accessibilityHint={i18n.t("Search.accessibility.selectLocation")}
									testID={`${testID}-recent-location-${index}`}>
									<History size={16} color={colors.textSecondary} />
									<View style={styles.suggestionText}>
										<Text style={styles.suggestionMainText} numberOfLines={1}>
											{recent.locationQuery}
										</Text>
									</View>
								</TouchableOpacity>
							))}
						</ScrollView>
					</View>
				)}

				{/* #931 Loading indicator: デバウンス待機中とAPI呼び出し中の両方で表示する */}
				{(displayStatus === "debouncing" || displayStatus === "searching") && (
					<View style={styles.loadingContainer}>
						<LoadingIndicator size="small" />
						<Text style={styles.loadingText}>{i18n.t("Search.loading")}</Text>
					</View>
				)}

				{/* Suggestions List */}
				{showSuggestions && displayStatus === "success" && suggestions.length > 0 && (
					<View style={styles.suggestionsContainer} {...preventFocusStealOnWeb}>
						<ScrollView
							keyboardShouldPersistTaps="handled"
							showsVerticalScrollIndicator={false}
							style={styles.suggestionsList}
							testID={`${testID}-suggestions`}>
							{suggestions.map((suggestion, index) => (
								<TouchableOpacity
									key={suggestion.place_id || index}
									style={[styles.suggestionItem, index === suggestions.length - 1 && styles.lastSuggestionItem]}
									onPress={() => handleSuggestionPress(suggestion)}
									accessibilityRole="button"
									accessibilityLabel={suggestion.text}
									accessibilityHint={i18n.t("Search.accessibility.selectLocation")}
									testID={`${testID}-suggestion-${index}`}>
									{isFoodAndDrinkPlaceForUser(suggestion) ? (
										<Utensils size={16} color={colors.textSecondary} />
									) : (
										<MapPin size={16} color={colors.textSecondary} />
									)}
									<View style={styles.suggestionText}>
										<Text style={styles.suggestionMainText}>{suggestion.mainText}</Text>
										{suggestion.secondaryText && (
											<Text style={styles.suggestionSecondaryText}>{suggestion.secondaryText}</Text>
										)}
									</View>
								</TouchableOpacity>
							))}
						</ScrollView>
					</View>
				)}

				{/* #931 No results message: 0件が確定した(status === "empty")ときのみ表示し、
			    デバウンス待機中/検索中に一瞬フラッシュしないようにする */}
				{showSuggestions && displayStatus === "empty" && (
					<View style={styles.noResultsContainer}>
						<Text style={styles.noResultsText}>{i18n.t("Search.noLocationsFound")}</Text>
					</View>
				)}

				{/* #931 Error message: 0件(=正常応答)とは別文言で表示し、再試行を提供する */}
				{/* #991 再試行ボタンも同じフォーカス移動起因の競合(#931)を持つため mousedown を抑止する */}
				{showSuggestions && displayStatus === "error" && (
					<View style={styles.noResultsContainer} {...preventFocusStealOnWeb}>
						<Text style={styles.noResultsText}>{i18n.t("Search.errors.searchFailed")}</Text>
						<TouchableOpacity
							style={styles.retryButton}
							onPress={handleRetry}
							accessibilityRole="button"
							accessibilityLabel={i18n.t("Common.retry")}
							testID={`${testID}-retry`}>
							<Text style={styles.retryButtonText}>{i18n.t("Common.retry")}</Text>
						</TouchableOpacity>
					</View>
				)}
			</View>
		);
	},
);

// #1509 【設計】テーマ依存のスタイルはファクトリで組む（`contexts/ThemeProvider.tsx` の useThemedStyles）。
// 値はすべて main のリテラルをそのまま `constants/Palette.ts` の light へ写したもので、ライトの見た目は変わらない。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: { flex: 1 },
		locationInputContainer: {
			flexDirection: "row",
			alignItems: "center",
			borderRadius: 16,
			backgroundColor: c.surface,
			borderWidth: 1,
			borderColor: c.border,
		},
		input: {
			flex: 1,
			paddingHorizontal: 20,
			paddingVertical: 16,
			fontSize: 16,
			color: c.textPrimary,
		},
		inputFocused: {},
		// #1502 【案A】入力欄右端の状態アイコン(スピナー/✓)の置き場。方向依存の margin を
		// 使わないことで RTL(ar) でも行末に正しく寄る
		inputStatusIcon: {
			paddingHorizontal: 4,
			justifyContent: "center",
			alignItems: "center",
		},
		// #1502 confirmation* は error(赤の1行+再試行)専用。確認中/確定は inputStatusIcon 側
		confirmationContainer: {
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
			marginTop: 8,
			paddingHorizontal: 4,
		},
		confirmationText: {
			fontSize: 13,
			color: c.textSecondary,
		},
		confirmationTextError: {
			color: c.danger,
			fontWeight: "600",
		},
		confirmationErrorContainer: {
			marginTop: 8,
			paddingHorizontal: 4,
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
		},
		clearButton: {
			padding: 12,
			marginRight: 4,
		},
		loadingContainer: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			paddingVertical: 20,
			marginTop: 12,
			// #1509 `#FFF` は `surface` の `#FFFFFF` と同一色（表記だけを揃えており見た目は変わらない）
			backgroundColor: c.surface,
			borderRadius: 16,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.1,
			shadowRadius: 24,
			elevation: 4,
		},
		loadingText: {
			marginLeft: 8,
			fontSize: 14,
			color: c.textSecondary,
		},
		suggestionsContainer: {
			marginTop: 12,
			// #1509 `#FFF` は `surface` の `#FFFFFF` と同一色（表記だけを揃えており見た目は変わらない）
			backgroundColor: c.surface,
			borderRadius: 16,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.1,
			shadowRadius: 24,
			elevation: 4,
		},
		suggestionsList: {},
		recentLocationsHeader: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			paddingHorizontal: 20,
			paddingTop: 14,
			paddingBottom: 4,
		},
		recentLocationsTitle: {
			fontSize: 12,
			fontWeight: "600",
			color: c.textTertiary,
		},
		suggestionItem: {
			flexDirection: "row",
			alignItems: "center",
			paddingHorizontal: 20,
			paddingVertical: 16,
			borderBottomWidth: 0.5,
			borderBottomColor: c.divider,
		},
		lastSuggestionItem: {
			borderBottomWidth: 0,
		},
		suggestionText: {
			marginLeft: 16,
			flex: 1,
		},
		suggestionMainText: {
			fontSize: 16,
			color: c.textPrimary,
			fontWeight: "600",
		},
		suggestionSecondaryText: {
			fontSize: 14,
			color: c.textSecondary,
			marginTop: 4,
		},
		noResultsContainer: {
			minHeight: 60,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.surface,
			borderRadius: 12,
			marginTop: 12,
			paddingVertical: 20,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.1,
			shadowRadius: 24,
			elevation: 4,
		},
		noResultsText: {
			fontSize: 14,
			color: c.textSecondary,
		},
		retryButton: {
			marginTop: 12,
			backgroundColor: c.brand,
			paddingHorizontal: 20,
			paddingVertical: 10,
			borderRadius: 20,
		},
		retryButtonText: {
			// #1509 ブランド色の上に載る文字はテーマ非追従
			color: FixedColors.onFilled,
			fontWeight: "600",
			fontSize: 14,
		},
	});
