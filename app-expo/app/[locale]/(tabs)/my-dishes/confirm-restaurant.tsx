// app-expo/app/[locale]/(tabs)/my-dishes/confirm-restaurant.tsx
//
// #1671 【設計】**Google の値をそのまま自社データにしない。ユーザーが確認した値を保存する。**
//
// オーナー判断（2026-08-28 / 2026-09-04）:
//
// > 店名・座標はユーザーに 1 タップで確認してもらって自社データにする。
// > **座標もワンタップ確認させて DB に保存しましょう。住所や国コードも。**
// > **ダイアログじゃなくてページにしたほうが良いと思う。**
//
// ## なぜダイアログではなくページなのか
//
// 確認する項目が 4 つ（店名・座標・住所・国）あり、座標は地図で見せる必要がある。
// `useDialog().prompt` は **文字列を 1 つ聞く**ための道具なので、そもそも載らない。
//
// ## なぜ «下読み» を挟むのか
//
// 住所・国・座標は、これまで `POST /v1/restaurants` の**中で**サーバが Google から
// 取っていた。確認ページに出すには取得と保存を分ける必要があるため、
// `POST /v1/restaurants/draft`（保存しない）を先に呼ぶ。
//
// ⚠️ **Google Places の呼び出し回数は増えない。** 従来 create が行っていた 2 回が
// 下読みへ前倒しされるだけで、確定時は 1 回も叩かない（→ `restaurant-draft.token.ts`）。
//
// ## 座標は «見て確認する»。ドラッグで動かさない
//
// オーナーの言葉が「**ワンタップ**確認」なので、ピンを動かして微調整する作りは範囲外と
// 解釈した。地図に位置を出して、合っていれば進む。ずれている場合の直し方が要ると
// 分かったら、その時に別途出す。

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, ScrollView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
// ⚠️ **`Marker` は `react-native-maps` から直接 import しないこと。**
// web では `MapView.web.tsx` の `Marker`（@react-google-maps/api のラッパ）へ
// 解決される必要がある。`react-native-maps` から取るとネイティブ専用の実体が
// 混ざり、web で画面ごと落ちる（実際にプレビューが真っ白になった）。
import MapView, { Marker } from "@/components/MapView";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import type { Palette } from "@/constants/Palette";
import { useAPICall, type ApiError } from "@/hooks/useAPICall";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useLocale } from "@/hooks/useLocale";
import i18n from "@/lib/i18n";
import { useRestaurantStore } from "@/stores/useRestaurantStore";
import { usePickedRestaurantStore } from "@/features/restaurantPicker/stores/usePickedRestaurantStore";
import { ErrorCode, type CreateRestaurantDraftResponse, type CreateRestaurantResponse } from "@shared/api/v1/res";
import type { CreateRestaurantDraftDto, CreateRestaurantDto } from "@shared/api/v1/dto";

/** 地図の見せ方。店 1 軒を確認するだけなので、はじめから寄せておく */
const CONFIRM_MAP_DELTA = 0.003;

type Draft = CreateRestaurantDraftResponse["draft"];

export default function ConfirmRestaurantScreen() {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const insets = useSafeAreaInsets();
	const { callBackend } = useAPICall();
	const { showSnackbar } = useSnackbar();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

	const params = useLocalSearchParams<{ googlePlaceId?: string; pick?: string }>();
	const googlePlaceId = params.googlePlaceId ?? "";
	const isPickMode = params.pick === "1";

	const [draft, setDraft] = useState<Draft | null>(null);
	const [draftToken, setDraftToken] = useState<string>("");
	const [name, setName] = useState("");
	const [address, setAddress] = useState("");
	const [isLoading, setIsLoading] = useState(true);
	const [isSubmitting, setIsSubmitting] = useState(false);

	/* ------------------------------------------------------------------ */
	/* 下読み（保存しない）                                                */
	/* ------------------------------------------------------------------ */
	useEffect(() => {
		let cancelled = false;

		const loadDraft = async () => {
			if (!googlePlaceId) {
				showSnackbar(i18n.t("Common.errors.unexpected"));
				router.back();
				return;
			}
			try {
				const response = await callBackend<CreateRestaurantDraftDto, CreateRestaurantDraftResponse>(
					"v1/restaurants/draft",
					{ method: "POST", requestPayload: { googlePlaceId } },
				);
				if (cancelled) return;
				setDraft(response.draft);
				setDraftToken(response.draftToken);
				setName(response.draft.name);
				setAddress(response.draft.address);
			} catch (rawError: unknown) {
				if (cancelled) return;
				const error = rawError as ApiError;

				// 飲食店ではない Place / 見つからない Place は、店を作らずに戻る
				if (error.status === 422 && error.errorCode === ErrorCode.PLACE_NOT_FOOD_AND_DRINK) {
					showSnackbar(i18n.t("Map.errors.placeNotRestaurant"));
				} else if (error.status === 404) {
					showSnackbar(i18n.t("Map.errors.placeNotFound"));
				} else if (error.code === "network_error" || error.status === 0) {
					showSnackbar(i18n.t("Common.errors.network"));
				} else {
					showSnackbar(i18n.t("Common.errors.unexpected"));
				}

				logFrontendEvent({
					event_name: "confirm_restaurant_draft_error",
					error_level: "error",
					payload: { error, googlePlaceId },
				});
				router.back();
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		};

		void loadDraft();
		return () => {
			cancelled = true;
		};
		// googlePlaceId が変わることは無い（1 画面 1 店）
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [googlePlaceId]);

	/* ------------------------------------------------------------------ */
	/* 確定（ここで初めて店ができる）                                       */
	/* ------------------------------------------------------------------ */
	const handleConfirm = useCallback(async () => {
		if (!draft || !draftToken || isSubmitting) return;
		// ⚠️ 空の店名で作らせない。ボタンの disabled «だけ» に頼らないこと
		//    （見た目の無効化は押下経路を 1 つ塞ぐだけで、不変条件の担保にはならない）
		const trimmedName = name.trim();
		if (trimmedName.length === 0) return;
		lightImpact();
		setIsSubmitting(true);
		try {
			const response = await callBackend<CreateRestaurantDto, CreateRestaurantResponse>("v1/restaurants", {
				method: "POST",
				requestPayload: {
					googlePlaceId: draft.googlePlaceId,
					draftToken,
					name: trimmedName,
					latitude: draft.latitude,
					longitude: draft.longitude,
					address: address.trim(),
					...(draft.countryCode ? { countryCode: draft.countryCode } : {}),
				},
			});

			if (isPickMode) {
				// pick モード: 選択として返して戻るだけ。詳細画面へは行かない
				usePickedRestaurantStore.getState().setPicked({
					restaurantId: response.restaurant.id,
					name: response.restaurant.name,
					restaurant: response.restaurant,
				});
				// 確認ページ自身も畳んで、呼び出し元（店選択）まで戻す
				router.back();
				return;
			}

			useRestaurantStore.getState().upsert({ restaurant: response.restaurant, meta: response.meta });

			// ⚠️ push ではなく replace。戻るで «確認ページ» に戻ると、
			//    既に作られた店をもう一度作ろうとすることになる
			router.replace({
				pathname: "/[locale]/restaurant/[restaurantId]",
				params: { locale, restaurantId: response.restaurant.id },
			});
		} catch (rawError: unknown) {
			const error = rawError as ApiError;

			// 下読みから時間が経ってトークンが失効した場合など
			if (error.status === 400) {
				showSnackbar(i18n.t("SelectRestaurant.confirmPage.expired"));
			} else if (error.code === "network_error" || error.status === 0) {
				showSnackbar(i18n.t("Common.errors.network"));
			} else {
				showSnackbar(i18n.t("Common.errors.unexpected"));
			}

			logFrontendEvent({
				event_name: "confirm_restaurant_create_error",
				error_level: "error",
				payload: { error, googlePlaceId: draft.googlePlaceId },
			});
		} finally {
			setIsSubmitting(false);
		}
	}, [
		draft,
		draftToken,
		isSubmitting,
		name,
		address,
		isPickMode,
		locale,
		lightImpact,
		callBackend,
		showSnackbar,
		logFrontendEvent,
	]);

	const handleBack = useCallback(() => {
		lightImpact();
		router.back();
	}, [lightImpact]);

	const region = useMemo(
		() =>
			draft
				? {
						latitude: draft.latitude,
						longitude: draft.longitude,
						latitudeDelta: CONFIRM_MAP_DELTA,
						longitudeDelta: CONFIRM_MAP_DELTA,
					}
				: null,
		[draft],
	);

	// 店名が空のままでは作らせない（NOT NULL 列であり、空の店は誰の役にも立たない）
	const canSubmit = name.trim().length > 0 && !isSubmitting && draft !== null;

	return (
		<View style={[styles.container, { paddingBottom: insets.bottom }]} testID="confirm-restaurant-screen">
			<ScreenHeader
				title={i18n.t("SelectRestaurant.confirmPage.title")}
				onPressBack={handleBack}
				testID="confirm-restaurant-header"
			/>

			{isLoading || !draft || !region ? (
				<View style={styles.loadingContainer} testID="confirm-restaurant-loading">
					<LoadingIndicator />
				</View>
			) : (
				<>
					<ScrollView
						style={styles.scroll}
						contentContainerStyle={styles.scrollContent}
						keyboardShouldPersistTaps="handled">
						<Text style={styles.lead}>{i18n.t("SelectRestaurant.confirmPage.lead")}</Text>

						{/* ---------------- 店名 ---------------- */}
						<Text style={styles.label}>{i18n.t("SelectRestaurant.confirmPage.nameLabel")}</Text>
						<TextInput
							style={styles.input}
							value={name}
							onChangeText={setName}
							placeholder={i18n.t("SelectRestaurant.confirmPage.namePlaceholder")}
							// #1629 ダークで既定色のまま地に埋もれるため、テーマのトークンを明示する
							placeholderTextColor={colors.textSecondary}
							maxLength={200}
							testID="confirm-restaurant-name"
						/>

						{/* ---------------- 位置 ---------------- */}
						<Text style={styles.label}>{i18n.t("SelectRestaurant.confirmPage.locationLabel")}</Text>
						<Text style={styles.hint}>{i18n.t("SelectRestaurant.confirmPage.locationHint")}</Text>
						<View style={styles.mapWrapper} testID="confirm-restaurant-map">
							<MapView
								style={styles.map}
								initialRegion={region}
								// 確認するだけの地図なので操作させない（動かせると «直せる» と誤解させる）
								scrollEnabled={false}
								zoomEnabled={false}
								rotateEnabled={false}
								pitchEnabled={false}
								pointerEvents="none">
								<Marker coordinate={{ latitude: draft.latitude, longitude: draft.longitude }} />
							</MapView>
						</View>

						{/* ---------------- 住所 ---------------- */}
						<Text style={styles.label}>{i18n.t("SelectRestaurant.confirmPage.addressLabel")}</Text>
						<TextInput
							style={[styles.input, styles.inputMulti]}
							value={address}
							onChangeText={setAddress}
							placeholder={i18n.t("SelectRestaurant.confirmPage.addressPlaceholder")}
							placeholderTextColor={colors.textSecondary}
							maxLength={500}
							multiline
							testID="confirm-restaurant-address"
						/>

						{/* ---------------- 国 ---------------- */}
						<Text style={styles.label}>{i18n.t("SelectRestaurant.confirmPage.countryLabel")}</Text>
						<Text style={styles.readonlyValue} testID="confirm-restaurant-country">
							{/* 国コード（JP）だけを見せても «確認» にならないので、表示名を優先する */}
							{draft.countryName ?? draft.countryCode ?? i18n.t("SelectRestaurant.confirmPage.countryUnknown")}
						</Text>
					</ScrollView>

					<View style={styles.footer}>
						<PrimaryButton
							label={i18n.t("SelectRestaurant.confirmPage.submit")}
							onPress={handleConfirm}
							loading={isSubmitting}
							disabled={!canSubmit}
							testID="confirm-restaurant-submit"
						/>
					</View>
				</>
			)}
		</View>
	);
}

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		container: { flex: 1, backgroundColor: colors.background },
		loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
		scroll: { flex: 1 },
		scrollContent: { padding: 16, paddingBottom: 24 },
		lead: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 20 },
		label: { color: colors.textPrimary, fontSize: 14, fontWeight: "600", marginBottom: 6 },
		hint: { color: colors.textSecondary, fontSize: 12, marginBottom: 8 },
		input: {
			backgroundColor: colors.surfaceSubtle,
			borderRadius: 10,
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: colors.border,
			color: colors.textPrimary,
			fontSize: 16,
			paddingHorizontal: 12,
			paddingVertical: Platform.OS === "ios" ? 12 : 8,
			marginBottom: 20,
		},
		inputMulti: { minHeight: 72, textAlignVertical: "top" },
		readonlyValue: { color: colors.textPrimary, fontSize: 16, marginBottom: 20 },
		mapWrapper: {
			height: 180,
			borderRadius: 10,
			overflow: "hidden",
			borderWidth: StyleSheet.hairlineWidth,
			borderColor: colors.border,
			marginBottom: 20,
		},
		map: { flex: 1 },
		footer: {
			padding: 16,
			borderTopWidth: StyleSheet.hairlineWidth,
			borderTopColor: colors.border,
			backgroundColor: colors.background,
		},
	});
