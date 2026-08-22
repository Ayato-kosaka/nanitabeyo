/*
このファイルの責務
- SNS の URL から 1 件を取り込む画面。**入口は 2 つ、着地は 1 つ**である。
    1. OS の共有シート（`lib/sharedTextSource.*` → `lib/snsShareIntake.ts` → `?url=`）
    2. my-dishes の ＋ ボタン（`?url=` 無しで開く。ここで貼り付ける）
- 上部タブで「食べたを記録」（＝既存のレビュー投稿導線）へ切り替えられる。

## ログイン不要である（#1375 実機確認）

取り込んだ `dish_media` の投稿者は **アプリのユーザーではない**（SNS 側の投稿者）ので
`user_id` は NULL のままにし、ユーザーとの紐付けは `reactions(save)` が持つ。匿名ユーザーも
実 user id を持ち save は書けるので、ここにフルログインを要求する理由が無い。
API 側も `AuthAnonGuard`（匿名可）にしてある。
**「食べたを記録」だけは公開レビューの投稿なのでログインが要る**（切替時に判定する）。

## ルートである理由（BlurModal ではない）
`Portal.Host` は `<Stack>` を包んでいる（`app/[locale]/_layout.tsx`）ので、オーバーレイを開いたまま
push すると遷移先が下に潜る（#1364 で実測）。加えて共有からの着地は
**「アプリ未起動 → 起動 → ここ」** という経路を持ち、URL だけで再現できる必要がある。
`scripts/assert-legacy-blur-modal-boundary.mjs` が `Portal` の import を禁じており、
`__tests__/snsImportRoute.test.tsx` が「この画面は Portal を 1 つも描かない」を固定している。

## `url` は必ず `resolveSnsShareIntakeView()` を通してから使う
`lib/snsShareIntake.ts` が canonical / expand URL だけをクエリへ載せるが、この画面は
URL 直叩きでも開けるし、貼り付け欄からは任意の文字列が入る。**生の値を画面に出さない。**

## 候補は «出れば嬉しい» もので、**出なくても保存できる**

⚠️ ここが一度壊れていた。`resolve` は **`lat` / `lng` / `radius` が渡されたときだけ**店舗候補を
探す（`dish-media-imports.service.ts` の `area_not_provided`）。エリアを送っていなかったので
**店舗候補は構造的に必ず 0 件**で、候補からしか選べない UI だったため保存に到達できなかった。

直し方は 2 つセットでないと意味が無い。

1. **エリアを送る** … 現在地を best-effort で取り、`lat` / `lng` / `radius` を付ける。
   取れなくてもエラーにしない（権限拒否は普通に起きる）
2. **手入力へ縮退する口を常に出す** … 候補が 0 件でも、店名検索（自前 `restaurants`）と
   料理カテゴリ検索から選べる。設計の「完全自動確定を前提にしない」がこれである。
   Instagram はサーバから取れるメタデータが無い（`metadata_provider_unsupported`）ので、
   **候補が 0 件になるのは異常系ではなく想定内の主要経路**である

## サーバへ渡すのは «貼られた文字列» そのもの
provider や externalContentId をクライアントで組み立てて送らない。サーバ側（`resolve` /
`imports`）が同じ `shared/utils/snsUrl.ts` で解釈し直すので、判定を 2 箇所に持たない。
*/
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useAPICall } from "@/hooks/useAPICall";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import i18n from "@/lib/i18n";
import { resolveSnsShareIntakeView } from "@/lib/snsShareIntake";
import { getCurrentLocationPosition } from "@/hooks/useCurrentLocationPosition";
import { useDishCategorySearch } from "@/hooks/useDishCategorySearch";
import { RestaurantNameSearch } from "@/features/restaurantPicker/components/RestaurantNameSearch";
import type { QueryRestaurantsResponse } from "@shared/api/v1/res";
import type { Region } from "react-native-maps";
import type { SnsProvider } from "@shared/utils/snsUrl";
import type { CreateDishMediaImportDto, ResolveDishMediaImportDto } from "@shared/api/v1/dto";
import type { CreateDishMediaImportResponse, ResolveDishMediaImportResponse } from "@shared/api/v1/res";

/**
 * provider の表示名。**固有名詞なので翻訳しない**（8 ロケールへ同じ値を 3 つずつ置くと、
 * 表記ゆれが入る余地だけが増える）。文章に混ざる形の文言は locale ファイル側に置いてある。
 */
const PROVIDER_LABELS: Record<SnsProvider, string> = {
	instagram: "Instagram",
	tiktok: "TikTok",
	youtube: "YouTube Shorts",
};

/**
 * 店舗候補を探す半径（m）。
 *
 * SNS の URL には座標が無いので、エリアは «いまユーザーが居る場所» を使うほかない
 * （設計 骨子 Q-3）。5km は「その辺で見つけた店を取り込む」に効く広さで、
 * これ以上広げても照合対象の上限（200 件）で頭打ちになるだけ精度が上がらない。
 */
const RESOLVE_RADIUS_M = 5000;

/** 上部タブ。`sns` が既定（＝ ＋ ボタンの基本導線） */
const TABS = ["sns", "eaten"] as const;
type Tab = (typeof TABS)[number];

export default function SnsImportScreen() {
	useScreenTrace("SnsImport");
	const { lightImpact } = useHaptics();
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { showSnackbar } = useSnackbar();
	const { user } = useAuth();
	const { url: urlParam } = useLocalSearchParams<{ url?: string }>();

	const sharedUrl = typeof urlParam === "string" ? urlParam : null;

	const [tab, setTab] = useState<Tab>("sns");
	/** 貼り付け欄。共有から来たときは初期値が入る */
	const [input, setInput] = useState<string>(sharedUrl ?? "");
	const [resolved, setResolved] = useState<ResolveDishMediaImportResponse | null>(null);
	const [isResolving, setIsResolving] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [dishCategoryId, setDishCategoryId] = useState<string | null>(null);
	const [restaurantId, setRestaurantId] = useState<string | null>(null);
	/** 選択済みの表示名。候補からでも手入力からでも、選んだものが見えるようにする */
	const [dishCategoryLabel, setDishCategoryLabel] = useState<string | null>(null);
	const [restaurantName, setRestaurantName] = useState<string | null>(null);

	/**
	 * 店舗候補・店名検索に使うエリア。**取れなくても止めない**（権限拒否は普通に起きる）。
	 * 既定は日本の中心付近で、店名検索は全国から拾えないので現在地が取れたときだけ意味を持つ。
	 */
	const regionRef = useRef<Region>({
		latitude: 35.6812,
		longitude: 139.7671,
		latitudeDelta: 0.05,
		longitudeDelta: 0.05,
	});
	const [area, setArea] = useState<{ lat: number; lng: number } | null>(null);
	useEffect(() => {
		let cancelled = false;
		getCurrentLocationPosition()
			.then(({ latitude, longitude }) => {
				if (cancelled) return;
				regionRef.current = { latitude, longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 };
				setArea({ lat: latitude, lng: longitude });
			})
			// 権限拒否・タイムアウトはここでは何も出さない。候補が減るだけで、手入力へ縮退できる
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	// 料理カテゴリの手入力（候補が 0 件でも選べるようにするための口）
	const { suggestions: dishCategorySuggestions, searchDishCategories } = useDishCategorySearch();
	const [dishCategoryQuery, setDishCategoryQuery] = useState("");

	// 共有から来たときの入力欄の初期値。`?url=` は起動経路によって遅れて届くことがある
	useEffect(() => {
		if (sharedUrl) setInput(sharedUrl);
	}, [sharedUrl]);

	/**
	 * 貼られた文字列の «見た目» の判定。API を叩く前にここで弾けるものは弾く。
	 * ⚠️ これは表示のための判定で、**取り込みの可否を決めるのはサーバ**である。
	 */
	const view = useMemo(() => resolveSnsShareIntakeView(input.trim() || null), [input]);

	const handleBack = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "sns_import_screen_back_pressed",
			error_level: "log",
			payload: { state: view.state },
		});
		// 共有からの着地は履歴が無いことがある（ログイン往復の replace / コールドスタート）。
		// その場合は my-dishes（取り込んだものが並ぶ場所）へ倒す
		if (router.canGoBack()) {
			router.back();
			return;
		}
		router.replace(`/${locale}/my-dishes`);
	}, [lightImpact, locale, logFrontendEvent, view.state]);

	/**
	 * 「食べたを記録」タブ。こちらは **公開レビューの投稿**なのでログインが要る
	 * （`dish_reviews` を書く経路であり、取り込みとは別物である）。
	 */
	const handleSelectTab = useCallback(
		(next: Tab) => {
			if (next === tab) return;
			lightImpact();
			if (next === "eaten") {
				if (isGuestUser(user)) {
					router.push({
						pathname: "/[locale]/auth/login",
						params: { locale, next: `/${locale}/my-dishes/select-restaurant` },
					});
					return;
				}
				router.push({ pathname: "/[locale]/(tabs)/my-dishes/select-restaurant", params: { locale } });
				return;
			}
			setTab(next);
		},
		[lightImpact, locale, tab, user],
	);

	const handleResolve = useCallback(async () => {
		const url = input.trim();
		if (!url || isResolving) return;
		lightImpact();
		setIsResolving(true);
		setResolved(null);
		setDishCategoryId(null);
		setRestaurantId(null);
		setDishCategoryLabel(null);
		setRestaurantName(null);
		try {
			// ⚠️ **エリアを必ず付ける。** `lat` / `lng` / `radius` が揃っていないとサーバは
			// 店舗候補を 1 件も探さない（`area_not_provided`）。取れなかったときは付けずに投げ、
			// 候補ゼロのまま手入力へ縮退させる（エラーにはしない）
			const response = await callBackend<ResolveDishMediaImportDto, ResolveDishMediaImportResponse>(
				"v1/dish-media/imports/resolve",
				{
					method: "POST",
					requestPayload: area ? { url, lat: area.lat, lng: area.lng, radius: RESOLVE_RADIUS_M } : { url },
				},
			);
			setResolved(response);
			// 閾値を超えた候補があれば初期選択に使う。**それでもユーザーが直せる状態で見せる**
			setDishCategoryId(response.prefill.dishCategoryId);
			setRestaurantId(response.prefill.restaurantId);
			setDishCategoryLabel(
				response.candidates.dishCategories.find((c) => c.dishCategoryId === response.prefill.dishCategoryId)?.labelEn ??
					null,
			);
			setRestaurantName(
				response.candidates.restaurants.find((c) => c.restaurantId === response.prefill.restaurantId)?.name ?? null,
			);
			logFrontendEvent({
				event_name: "sns_import_resolved",
				error_level: "log",
				// URL そのものは payload に入れない（#1403 の「個人を特定しうる値を入れない」に従う）
				payload: {
					status: response.status,
					reason: response.reason,
					provider: response.source.provider,
					dishCategoryCandidateCount: response.candidates.dishCategories.length,
					restaurantCandidateCount: response.candidates.restaurants.length,
				},
			});
		} catch {
			showSnackbar(i18n.t("Common.errors.unexpected"));
		} finally {
			setIsResolving(false);
		}
	}, [area, callBackend, input, isResolving, lightImpact, logFrontendEvent, showSnackbar]);

	/** 店名検索（自前 `restaurants`）から選んだ。候補が 0 件でもここから必ず選べる */
	const handleSelectRestaurantFromSearch = useCallback(
		(result: QueryRestaurantsResponse[number]) => {
			lightImpact();
			setRestaurantId(result.restaurant.id);
			setRestaurantName(result.restaurant.name);
		},
		[lightImpact],
	);

	/** 料理カテゴリ検索から選んだ。同上 */
	const handleSelectDishCategoryFromSearch = useCallback(
		(suggestion: { dishCategoryId: string; label: string }) => {
			lightImpact();
			setDishCategoryId(suggestion.dishCategoryId);
			setDishCategoryLabel(suggestion.label);
			setDishCategoryQuery("");
		},
		[lightImpact],
	);

	const handleSave = useCallback(async () => {
		const url = input.trim();
		if (!url || !dishCategoryId || !restaurantId || isSaving) return;
		lightImpact();
		setIsSaving(true);
		try {
			const response = await callBackend<CreateDishMediaImportDto, CreateDishMediaImportResponse>(
				"v1/dish-media/imports",
				{ method: "POST", requestPayload: { url, dishCategoryId, restaurantId } },
			);
			logFrontendEvent({
				event_name: "sns_import_completed",
				error_level: "log",
				payload: { created: response.created, saved: response.saved },
			});
			showSnackbar(i18n.t("SnsImport.save.done"));
			// 取り込んだものが並ぶ場所へ送る。戻るで取り込み画面へ戻らないよう replace する
			router.replace(`/${locale}/my-dishes`);
		} catch {
			showSnackbar(i18n.t("SnsImport.save.failed"));
		} finally {
			setIsSaving(false);
		}
	}, [callBackend, dishCategoryId, input, isSaving, lightImpact, locale, logFrontendEvent, restaurantId, showSnackbar]);

	const canSave = dishCategoryId !== null && restaurantId !== null && !isSaving;

	return (
		<SafeAreaView edges={["bottom"]} style={styles.container} testID="sns-import-screen">
			<ScreenHeader title={i18n.t("SnsImport.title")} onPressBack={handleBack} testID="sns-import-screen" />

			{/* #1375 実機確認: ＋ の基本導線は SNS 取り込み。上部タブで「食べた」の追加へ切り替える */}
			<View style={styles.tabRow}>
				{TABS.map((t) => (
					<TouchableOpacity
						key={t}
						testID={`sns-import-tab-${t}`}
						onPress={() => handleSelectTab(t)}
						accessibilityRole="button"
						accessibilityState={{ selected: tab === t }}
						style={[styles.tab, tab === t && styles.tabActive]}>
						<Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>{i18n.t(`SnsImport.tabs.${t}`)}</Text>
					</TouchableOpacity>
				))}
			</View>

			<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
				<Text style={styles.label}>{i18n.t("SnsImport.input.label")}</Text>
				<TextInput
					testID="sns-import-url-input"
					value={input}
					onChangeText={setInput}
					placeholder={i18n.t("SnsImport.input.placeholder")}
					autoCapitalize="none"
					autoCorrect={false}
					multiline
					style={styles.input}
				/>

				{/* 見た目の判定でも «非対応» と分かるものは、API を叩く前に言う */}
				{input.trim().length > 0 && view.state === "unsupported" && (
					<Text testID="sns-import-unsupported-description" style={styles.hint}>
						{i18n.t("SnsImport.unsupported.description")}
					</Text>
				)}
				{view.state === "expandPending" && (
					<Text testID="sns-import-expand-pending" style={styles.hint}>
						{i18n.t("SnsImport.expandPending.description")}
					</Text>
				)}

				<PrimaryButton
					testID="sns-import-resolve-button"
					onPress={handleResolve}
					label={i18n.t("SnsImport.actions.resolve")}
					loading={isResolving}
					disabled={input.trim().length === 0}
					style={styles.resolveButton}
				/>

				{isResolving && <ActivityIndicator style={styles.spinner} />}

				{resolved && (
					<View testID="sns-import-result">
						{resolved.status === "unsupported" || resolved.status === "unavailable" ? (
							<Text testID="sns-import-result-error" style={styles.hint}>
								{i18n.t(`SnsImport.reasons.${resolved.reason}`, {
									defaultValue: i18n.t("SnsImport.unsupported.description"),
								})}
							</Text>
						) : (
							<>
								{!!resolved.source.provider && (
									<Text style={styles.provider} testID="sns-import-provider">
										{PROVIDER_LABELS[resolved.source.provider]}
									</Text>
								)}
								{!!resolved.metadata.title && (
									<Text style={styles.metaTitle} numberOfLines={3}>
										{resolved.metadata.title}
									</Text>
								)}

								{/* ⚠️ 候補は «出れば嬉しい» もの。**0 件でも下の検索から必ず選べる**ようにしてある。
								    Instagram はサーバから取れるメタデータが無いので、候補 0 件は想定内の主要経路である */}
								<Text style={styles.sectionTitle}>{i18n.t("SnsImport.sections.dishCategory")}</Text>
								{resolved.candidates.dishCategories.length > 0 && (
									<View style={styles.chipRow}>
										{resolved.candidates.dishCategories.map((candidate) => (
											<TouchableOpacity
												key={candidate.dishCategoryId}
												testID={`sns-import-dish-category-${candidate.dishCategoryId}`}
												onPress={() => {
													lightImpact();
													setDishCategoryId(candidate.dishCategoryId);
													setDishCategoryLabel(
														candidate.labels?.[locale.split("-")[0]] ?? candidate.labelEn ?? candidate.dishCategoryId,
													);
												}}
												accessibilityRole="button"
												accessibilityState={{ selected: dishCategoryId === candidate.dishCategoryId }}
												style={[styles.chip, dishCategoryId === candidate.dishCategoryId && styles.chipSelected]}>
												<Text
													style={[
														styles.chipLabel,
														dishCategoryId === candidate.dishCategoryId && styles.chipLabelSelected,
													]}>
													{candidate.labels?.[locale.split("-")[0]] ?? candidate.labelEn ?? candidate.dishCategoryId}
												</Text>
											</TouchableOpacity>
										))}
									</View>
								)}

								{/* 料理カテゴリの手入力。候補の有無に関わらず常に出す */}
								<TextInput
									testID="sns-import-dish-category-search-input"
									value={dishCategoryQuery}
									onChangeText={(text) => {
										setDishCategoryQuery(text);
										void searchDishCategories(text);
									}}
									placeholder={i18n.t("SnsImport.sections.dishCategorySearchPlaceholder")}
									autoCapitalize="none"
									style={styles.searchInput}
								/>
								{dishCategorySuggestions.length > 0 && (
									<View style={styles.chipRow}>
										{dishCategorySuggestions.map((suggestion) => (
											<TouchableOpacity
												key={suggestion.dishCategoryId}
												testID={`sns-import-dish-category-suggestion-${suggestion.dishCategoryId}`}
												onPress={() => handleSelectDishCategoryFromSearch(suggestion)}
												accessibilityRole="button"
												style={styles.chip}>
												<Text style={styles.chipLabel}>{suggestion.label}</Text>
											</TouchableOpacity>
										))}
									</View>
								)}
								{!!dishCategoryLabel && (
									<Text style={styles.selectedValue} testID="sns-import-selected-dish-category">
										{i18n.t("SnsImport.sections.selected", { value: dishCategoryLabel })}
									</Text>
								)}

								<Text style={styles.sectionTitle}>{i18n.t("SnsImport.sections.restaurant")}</Text>
								{resolved.candidates.restaurants.length > 0 && (
									<View style={styles.chipRow}>
										{resolved.candidates.restaurants.map((candidate) => (
											<TouchableOpacity
												key={candidate.restaurantId}
												testID={`sns-import-restaurant-${candidate.restaurantId}`}
												onPress={() => {
													lightImpact();
													setRestaurantId(candidate.restaurantId);
													setRestaurantName(candidate.name);
												}}
												accessibilityRole="button"
												accessibilityState={{ selected: restaurantId === candidate.restaurantId }}
												style={[styles.chip, restaurantId === candidate.restaurantId && styles.chipSelected]}>
												<Text
													style={[
														styles.chipLabel,
														restaurantId === candidate.restaurantId && styles.chipLabelSelected,
													]}>
													{candidate.name}
												</Text>
											</TouchableOpacity>
										))}
									</View>
								)}

								{/* 店名検索（自前 `restaurants` テーブル。Google Places Text Search /
								    Autocomplete は呼ばない）。候補の有無に関わらず常に出す */}
								<RestaurantNameSearch
									regionRef={regionRef}
									onSelectRestaurant={handleSelectRestaurantFromSearch}
									testID="sns-import-restaurant-search"
								/>
								{!!restaurantName && (
									<Text style={styles.selectedValue} testID="sns-import-selected-restaurant">
										{i18n.t("SnsImport.sections.selected", { value: restaurantName })}
									</Text>
								)}

								<PrimaryButton
									testID="sns-import-save-button"
									onPress={handleSave}
									label={i18n.t("SnsImport.actions.save")}
									loading={isSaving}
									disabled={!canSave}
									style={styles.saveButton}
								/>
								{!canSave && !isSaving && (
									<Text style={styles.hint}>{i18n.t("SnsImport.actions.saveRequirement")}</Text>
								)}
							</>
						)}
					</View>
				)}
			</ScrollView>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#FFFFFF",
	},
	tabRow: {
		flexDirection: "row",
		gap: 8,
		paddingHorizontal: 16,
		paddingBottom: 8,
	},
	tab: {
		flex: 1,
		paddingVertical: 10,
		borderRadius: 8,
		backgroundColor: "#F3F4F6",
		alignItems: "center",
	},
	tabActive: {
		backgroundColor: "#FDE7E1",
	},
	tabLabel: {
		fontSize: 13,
		color: "#6B7280",
	},
	tabLabelActive: {
		color: "#F05537",
		fontWeight: "700",
	},
	content: {
		paddingHorizontal: 16,
		paddingBottom: 24,
	},
	label: {
		marginTop: 12,
		fontSize: 13,
		color: "#6B7280",
	},
	input: {
		marginTop: 6,
		minHeight: 72,
		borderWidth: 1,
		borderColor: "#E5E7EB",
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 10,
		fontSize: 14,
		color: "#111827",
		textAlignVertical: "top",
	},
	resolveButton: {
		marginTop: 16,
	},
	saveButton: {
		marginTop: 20,
	},
	spinner: {
		marginTop: 16,
	},
	provider: {
		marginTop: 20,
		fontSize: 14,
		fontWeight: "700",
		color: "#F05537",
	},
	metaTitle: {
		marginTop: 4,
		fontSize: 14,
		lineHeight: 20,
		color: "#374151",
	},
	sectionTitle: {
		marginTop: 20,
		fontSize: 14,
		fontWeight: "700",
		color: "#1A1A1A",
	},
	searchInput: {
		marginTop: 8,
		borderWidth: 1,
		borderColor: "#E5E7EB",
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 10,
		fontSize: 14,
		color: "#111827",
	},
	selectedValue: {
		marginTop: 8,
		fontSize: 13,
		fontWeight: "700",
		color: "#F05537",
	},
	chipRow: {
		marginTop: 8,
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 8,
	},
	chip: {
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 16,
		backgroundColor: "#F3F4F6",
	},
	chipSelected: {
		backgroundColor: "#FDE7E1",
	},
	chipLabel: {
		fontSize: 13,
		color: "#374151",
	},
	chipLabelSelected: {
		color: "#F05537",
		fontWeight: "700",
	},
	hint: {
		marginTop: 12,
		fontSize: 13,
		lineHeight: 19,
		color: "#6B7280",
	},
});
