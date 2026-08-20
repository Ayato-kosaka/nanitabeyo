import React, { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import { sceneOptions, timeSlots } from "@/features/search/constants";
import i18n from "@/lib/i18n";
import {
	DEFAULT_MY_DISHES_FILTER,
	isRatingFilterEnabled,
	useMyDishesFilterStore,
	type MyDishStatus,
	type MyDishesFilter,
	type MyDishesSort,
} from "@/features/myDishes/stores/useMyDishesFilterStore";

/**
 * #1396 my-dishes のフィルタ編集画面（設計書 (2/2) §8-5）。
 *
 * ⚠️ **BlurModal（旧オーバーレイ）を使わず、ルートにする。**
 * `Portal.Host` が `<Stack>` を包んでいるため、オーバーレイを開いたまま push すると
 * 遷移先が下に潜る（#1364 で実測）。`__tests__/myDishesFiltersRoute.test.tsx` が
 * この画面がオーバーレイを 1 つも持たないことを固定している。
 *
 * ## 編集はドラフトに対して行い、「適用」でだけ store を書く
 *
 * チップを押すたびに store を書くと、押すたびに `queryKey` が変わり、
 * 押した回数だけ約 964MB の `dish_reviews` へクエリが飛ぶ（#1395 §0(A)）。
 * ここではローカル state（ドラフト）を編集し、**「適用」で 1 回だけ `patch` する**。
 *
 * ## エリアはこの画面では編集しない
 *
 * エリアの確定は Map の「このエリアで再検索」（`commitArea`、PR4）だけが行う。
 * この画面は確定済みエリアの表示と解除に留める（設計書 (2/2) §3-2）。
 */

const RATING_CHOICES = [5, 4, 3, 2, 1] as const;

const SORT_CHOICES: { sort: MyDishesSort; labelKey: string }[] = [
	{ sort: "-occurredAt", labelKey: "MyDishes.filters.sort.occurredAtDesc" },
	{ sort: "occurredAt", labelKey: "MyDishes.filters.sort.occurredAtAsc" },
	{ sort: "-rating", labelKey: "MyDishes.filters.sort.ratingDesc" },
	{ sort: "distance", labelKey: "MyDishes.filters.sort.distance" },
	// #1396 確定B: 時間帯・シチュエーションは絞り込みではなく**並び替え**として出す
	{ sort: "-timeSlotScore", labelKey: "MyDishes.filters.sort.timeSlotScoreDesc" },
	{ sort: "-sceneScore", labelKey: "MyDishes.filters.sort.sceneScoreDesc" },
];

function Chip({
	label,
	selected,
	disabled,
	onPress,
	testID,
}: {
	label: string;
	selected: boolean;
	disabled?: boolean;
	onPress: () => void;
	testID?: string;
}) {
	return (
		<TouchableOpacity
			testID={testID}
			onPress={onPress}
			disabled={disabled}
			accessibilityRole="button"
			accessibilityState={{ selected, disabled: !!disabled }}
			style={[styles.chip, selected && styles.chipSelected, disabled && styles.chipDisabled]}>
			<Text style={[styles.chipLabel, selected && styles.chipLabelSelected, disabled && styles.chipLabelDisabled]}>
				{label}
			</Text>
		</TouchableOpacity>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<View style={styles.section}>
			<Text style={styles.sectionTitle}>{title}</Text>
			<View style={styles.chipRow}>{children}</View>
		</View>
	);
}

export default function MyDishesFiltersScreen() {
	useScreenTrace("MyDishesFilters");
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const filter = useMyDishesFilterStore((s) => s.filter);
	const patch = useMyDishesFilterStore((s) => s.patch);
	const clearArea = useMyDishesFilterStore((s) => s.clearArea);

	const [draft, setDraft] = useState<MyDishesFilter>(filter);

	const patchDraft = useCallback((partial: Partial<MyDishesFilter>) => {
		setDraft((prev) => ({ ...prev, ...partial }));
	}, []);

	// #1395 m-4: want 行は rating を持たないため、status に want を含む間は評価フィルタを不活性にする。
	// ここを外すと「★4以上」を押した瞬間に食べたいが全消しになる。
	const ratingEnabled = useMemo(() => isRatingFilterEnabled(draft), [draft]);

	const toggleStatus = useCallback(
		(status: MyDishStatus) => {
			lightImpact();
			setDraft((prev) => {
				const next = prev.status.includes(status)
					? prev.status.filter((s) => s !== status)
					: [...prev.status, status];
				// status が want を含む（[] = 両方も含む）状態では評価で絞れないので、選択済みの評価は落とす
				const nextFilter: MyDishesFilter = { ...prev, status: next };
				return isRatingFilterEnabled(nextFilter) ? nextFilter : { ...nextFilter, minRating: null, ratings: [] };
			});
		},
		[lightImpact],
	);

	const selectMinRating = useCallback(
		(rating: number) => {
			lightImpact();
			patchDraft({ minRating: draft.minRating === rating ? null : rating });
		},
		[draft.minRating, lightImpact, patchDraft],
	);

	const selectSort = useCallback(
		(sort: MyDishesSort) => {
			lightImpact();
			setDraft((prev) => {
				const next: MyDishesFilter = { ...prev, sort };
				// sort の同伴パラメータ（sceneKey / timeSlotKey）が未選択なら既定値を入れておく。
				// 未選択のまま送ると QueryMyDishesDto の ValidateIf で 400 になる（#1395 §4-3）
				if (sort === "-sceneScore" && !next.sceneKey) next.sceneKey = sceneOptions[0].id;
				if (sort === "-timeSlotScore" && !next.timeSlotKey) next.timeSlotKey = timeSlots[0].id;
				return next;
			});
		},
		[lightImpact],
	);

	const handleClearArea = useCallback(() => {
		lightImpact();
		// 確定済みエリアの解除は即時に store へ反映する（Map 側の表示と食い違わせない）
		clearArea();
		setDraft((prev) => ({
			...prev,
			area: null,
			sort: prev.sort === "distance" ? DEFAULT_MY_DISHES_FILTER.sort : prev.sort,
		}));
	}, [clearArea, lightImpact]);

	const handleClearPeriod = useCallback(() => {
		lightImpact();
		patchDraft({ from: null, to: null });
	}, [lightImpact, patchDraft]);

	const handleReset = useCallback(() => {
		lightImpact();
		// エリアは Map で確定したものなので、リセットでも保持する（意図せず全国検索に戻さない）
		setDraft({ ...DEFAULT_MY_DISHES_FILTER, area: draft.area });
	}, [draft.area, lightImpact]);

	const handleApply = useCallback(() => {
		lightImpact();
		// #1396 【設計】ここが唯一 store を書く場所。queryKey が変わったビューだけが取り直す（§3-3）
		patch(draft);
		logFrontendEvent({
			event_name: "my_dishes_filter_applied",
			error_level: "log",
			payload: {
				status: draft.status.join(","),
				sort: draft.sort,
				minRating: draft.minRating,
				hasArea: draft.area !== null,
				hasPeriod: draft.from !== null || draft.to !== null,
			},
		});
		router.back();
	}, [draft, lightImpact, logFrontendEvent, patch]);

	const handleBack = useCallback(() => {
		lightImpact();
		router.back();
	}, [lightImpact]);

	const periodLabel = useMemo(() => {
		if (!draft.from && !draft.to) return i18n.t("MyDishes.filters.period.none");
		return `${draft.from?.slice(0, 10) ?? ""} 〜 ${draft.to?.slice(0, 10) ?? ""}`.trim();
	}, [draft.from, draft.to]);

	return (
		<SafeAreaView edges={["bottom"]} style={styles.container} testID="my-dishes-filter-screen">
			<ScreenHeader
				title={i18n.t("MyDishes.filters.title")}
				onPressBack={handleBack}
				testID="my-dishes-filter-screen"
			/>

			<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
				<Section title={i18n.t("MyDishes.filters.status.title")}>
					{(["want", "eaten"] as const).map((status) => (
						<Chip
							key={status}
							testID={`my-dishes-filter-status-${status}`}
							label={i18n.t(`MyDishes.filters.status.${status}`)}
							selected={draft.status.includes(status)}
							onPress={() => toggleStatus(status)}
						/>
					))}
				</Section>

				<Section title={i18n.t("MyDishes.filters.rating.title")}>
					{RATING_CHOICES.map((rating) => (
						<Chip
							key={rating}
							testID={`my-dishes-filter-rating-${rating}`}
							label={i18n.t("MyDishes.filters.rating.min", { count: rating })}
							selected={draft.minRating === rating}
							disabled={!ratingEnabled}
							onPress={() => selectMinRating(rating)}
						/>
					))}
				</Section>
				{!ratingEnabled && (
					<Text testID="my-dishes-filter-rating-disabled" style={styles.hint}>
						{i18n.t("MyDishes.filters.rating.disabledByWant")}
					</Text>
				)}

				<Section title={i18n.t("MyDishes.filters.sort.title")}>
					{SORT_CHOICES.map(({ sort, labelKey }) => (
						<Chip
							key={sort}
							testID={`my-dishes-filter-sort-${sort}`}
							label={i18n.t(labelKey)}
							selected={draft.sort === sort}
							// distance はエリア（lat/lng/radius）が必須。未確定なら選ばせない（#1395 §4-3）
							disabled={sort === "distance" && !draft.area}
							onPress={() => selectSort(sort)}
						/>
					))}
				</Section>
				{draft.sort === "distance" && !draft.area && (
					<Text style={styles.hint}>{i18n.t("MyDishes.filters.sort.distanceRequiresArea")}</Text>
				)}

				{draft.sort === "-timeSlotScore" && (
					<Section title={i18n.t("MyDishes.filters.sort.timeSlotKey")}>
						{timeSlots.map((slot) => (
							<Chip
								key={slot.id}
								testID={`my-dishes-filter-time-slot-${slot.id}`}
								label={`${slot.icon} ${i18n.t(slot.label)}`}
								selected={draft.timeSlotKey === slot.id}
								onPress={() => {
									lightImpact();
									patchDraft({ timeSlotKey: slot.id });
								}}
							/>
						))}
					</Section>
				)}

				{draft.sort === "-sceneScore" && (
					<Section title={i18n.t("MyDishes.filters.sort.sceneKey")}>
						{sceneOptions.map((scene) => (
							<Chip
								key={scene.id}
								testID={`my-dishes-filter-scene-${scene.id}`}
								label={`${scene.icon} ${i18n.t(scene.label)}`}
								selected={draft.sceneKey === scene.id}
								onPress={() => {
									lightImpact();
									patchDraft({ sceneKey: scene.id });
								}}
							/>
						))}
					</Section>
				)}

				<View style={styles.section}>
					<Text style={styles.sectionTitle}>{i18n.t("MyDishes.filters.area.title")}</Text>
					<Text style={styles.valueText} testID="my-dishes-filter-area-value">
						{draft.area
							? (draft.area.label ??
								`${draft.area.lat.toFixed(4)}, ${draft.area.lng.toFixed(4)} / ${draft.area.radius}m`)
							: i18n.t("MyDishes.filters.area.none")}
					</Text>
					{/* エリアの確定は Map の「このエリアで再検索」だけが行う（§3-2）。ここでは解除だけできる */}
					<Text style={styles.hint}>{i18n.t("MyDishes.filters.area.hint")}</Text>
					{!!draft.area && (
						<TouchableOpacity
							testID="my-dishes-filter-area-clear"
							onPress={handleClearArea}
							accessibilityRole="button"
							style={styles.linkButton}>
							<Text style={styles.linkButtonLabel}>{i18n.t("MyDishes.filters.area.clear")}</Text>
						</TouchableOpacity>
					)}
				</View>

				<View style={styles.section}>
					<Text style={styles.sectionTitle}>{i18n.t("MyDishes.filters.period.title")}</Text>
					<Text style={styles.valueText} testID="my-dishes-filter-period-value">
						{periodLabel}
					</Text>
					{(!!draft.from || !!draft.to) && (
						<TouchableOpacity
							testID="my-dishes-filter-period-clear"
							onPress={handleClearPeriod}
							accessibilityRole="button"
							style={styles.linkButton}>
							<Text style={styles.linkButtonLabel}>{i18n.t("MyDishes.filters.period.clear")}</Text>
						</TouchableOpacity>
					)}
				</View>
			</ScrollView>

			<View style={styles.footer}>
				<TouchableOpacity
					testID="my-dishes-filter-reset"
					onPress={handleReset}
					accessibilityRole="button"
					style={styles.resetButton}>
					<Text style={styles.resetButtonLabel}>{i18n.t("MyDishes.filters.reset")}</Text>
				</TouchableOpacity>
				<PrimaryButton
					testID="my-dishes-filter-apply"
					onPress={handleApply}
					label={i18n.t("MyDishes.filters.apply")}
					style={styles.applyButton}
				/>
			</View>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#FFFFFF",
	},
	content: {
		paddingHorizontal: 16,
		paddingBottom: 24,
	},
	section: {
		marginTop: 20,
	},
	sectionTitle: {
		fontSize: 14,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 8,
	},
	chipRow: {
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
	chipDisabled: {
		opacity: 0.4,
	},
	chipLabel: {
		fontSize: 13,
		color: "#374151",
	},
	chipLabelSelected: {
		color: "#F05537",
		fontWeight: "700",
	},
	chipLabelDisabled: {
		color: "#9CA3AF",
	},
	hint: {
		marginTop: 8,
		fontSize: 12,
		color: "#6B7280",
	},
	valueText: {
		fontSize: 13,
		color: "#374151",
	},
	linkButton: {
		marginTop: 8,
		alignSelf: "flex-start",
	},
	linkButtonLabel: {
		fontSize: 13,
		color: "#F05537",
		fontWeight: "700",
	},
	footer: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		paddingHorizontal: 16,
		paddingVertical: 12,
		borderTopWidth: 1,
		borderTopColor: "#EEE",
	},
	resetButton: {
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
	resetButtonLabel: {
		fontSize: 14,
		color: "#6B7280",
		fontWeight: "700",
	},
	applyButton: {
		flex: 1,
	},
});
