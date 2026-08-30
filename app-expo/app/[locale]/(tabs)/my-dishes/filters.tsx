import React, { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PrimaryButton } from "@/components/PrimaryButton";
import { type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import {
	coreIngredientOptions,
	diningPaceOptions,
	priceLevelOptions,
	sceneOptions,
	tasteOptions,
	timeSlots,
} from "@/features/search/constants";
import i18n from "@/lib/i18n";
import { MY_DISHES_EVENTS, buildFilterAppliedPayload } from "@/features/myDishes/analytics";
import { buildCategoryFacets } from "@/features/myDishes/categoryFacets";
import { useMyDishesStore, selectMyDishesByQuery } from "@/features/myDishes/stores/useMyDishesStore";
import { selectFilterQueryKey } from "@/features/myDishes/stores/useMyDishesFilterStore";
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

/** 料理カテゴリーのチップをこの件数まで畳む。超えたぶんは「もっと見る」で開く（#1375 4 巡目） */
const CATEGORY_COLLAPSE_COUNT = 8;

const SORT_CHOICES: { sort: MyDishesSort; labelKey: string }[] = [
	{ sort: "-occurredAt", labelKey: "MyDishes.filters.sort.occurredAtDesc" },
	{ sort: "occurredAt", labelKey: "MyDishes.filters.sort.occurredAtAsc" },
	{ sort: "-rating", labelKey: "MyDishes.filters.sort.ratingDesc" },
	{ sort: "distance", labelKey: "MyDishes.filters.sort.distance" },
	// #1396 確定B: 特徴量は絞り込みではなく**並び替え**として出す（連続値なので絞り込めない）
	{ sort: "-featureScore", labelKey: "MyDishes.filters.sort.featureScoreDesc" },
];

/**
 * #1375 実機確認: 特徴量の軸。**検索画面と同じ選択肢・同じ文言**を使う。
 *
 * ここで新しい選択肢を作らないのは、「検索で選べたもの」と「自分の棚で絞れるもの」が
 * 食い違うと、ユーザーから見て同じ言葉が別の意味を持つことになるためである。
 * `featureType` は `dish_category_features.feature_type` で、API の `featureKeys`
 * （`"<feature_type>:<feature_key>"`）へそのまま入る。
 *
 * `どんな系統` だけは検索画面と同じく taste と core_ingredient の 2 つの feature_type が
 * 1 つの見出しにぶら下がる（`foodStyleOptions` と同じ構成）。
 */
type FeatureAxis = {
	/** 折りたたみの識別子。testID にも使う */
	id: string;
	titleKey: string;
	options: readonly { id: string; label: string; icon?: string; featureType: string }[];
};

const FEATURE_AXES: FeatureAxis[] = [
	{
		id: "time-slot",
		titleKey: "MyDishes.filters.axes.timeSlot",
		options: timeSlots.map((o) => ({ id: o.id, label: o.label, icon: o.icon, featureType: "timeSlot" })),
	},
	{
		id: "scene",
		titleKey: "MyDishes.filters.axes.scene",
		options: sceneOptions.map((o) => ({ id: o.id, label: o.label, icon: o.icon, featureType: "scene" })),
	},
	{
		id: "budget",
		titleKey: "MyDishes.filters.axes.budget",
		// 検索画面の価格帯は Google の PRICE_LEVEL_* だが、特徴量側のキーは budgetIntent である
		options: priceLevelOptions.map((o) => ({
			id: o.budgetIntent,
			label: o.label,
			featureType: "budget_intent",
		})),
	},
	{
		id: "dining-pace",
		titleKey: "MyDishes.filters.axes.diningPace",
		options: diningPaceOptions.map((o) => ({ id: o.id, label: o.label, icon: o.icon, featureType: "dining_pace" })),
	},
	{
		id: "food-style",
		titleKey: "MyDishes.filters.axes.foodStyle",
		options: [
			...tasteOptions.map((o) => ({ id: o.id, label: o.label, icon: o.icon, featureType: "taste" })),
			...coreIngredientOptions.map((o) => ({
				id: o.id,
				label: o.label,
				icon: o.icon,
				featureType: "core_ingredient",
			})),
		],
	},
];

/** `"<feature_type>:<feature_key>"` を組む。API 契約（`parseMyDishFeatureKey`）と同じ形 */
const toFeatureKey = (featureType: string, id: string): string => `${featureType}:${id}`;

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
	const styles = useThemedStyles(createStyles);
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

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
	const styles = useThemedStyles(createStyles);
	return (
		<View style={styles.section}>
			{/* #1375 実機確認（2 巡目）: 見出しは «小さく» するが、**消さない**。
			    1 巡目で「絞り込み」「並び替え」のラベルを丸ごと落としたところ、チップだけが
			    3 段並ぶ画面になり «何をすればいいのか分からない» という指摘になった。
			    見出し（何の話か）＋ 1 行の説明（押すとどうなるか）を必ず添える */}
			{title.length > 0 && <Text style={styles.sectionTitle}>{title}</Text>}
			{description ? <Text style={styles.sectionDescription}>{description}</Text> : null}
			<View style={styles.chipRow}>{children}</View>
		</View>
	);
}

/** エリアの半径を «読める単位» にする。1km 以上は km、それ未満は m */
export const formatAreaRadius = (radiusMeters: number): string =>
	radiusMeters >= 1000 ? `${(radiusMeters / 1000).toFixed(1)}km` : `${Math.round(radiusMeters)}m`;

/**
 * 「押したらプルダウンで選択肢が出る」行。RN に素の select が無いので折りたたみで表す。
 * 閉じているときも**選択中の値は見出しの右に出す**（開かないと分からない状態を作らない）。
 */
function AccordionSection({
	title,
	valueLabel,
	expanded,
	// prop 名は `onPress` にする。`Chip` と揃えておくと、テストの `press()` が
	// «一番浅い、testID を持つ要素» の `props.onPress` を呼ぶ作法のまま通る
	onPress,
	testID,
	children,
}: {
	title: string;
	valueLabel: string;
	expanded: boolean;
	onPress: () => void;
	testID: string;
	children: React.ReactNode;
}) {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const Chevron = expanded ? ChevronUp : ChevronDown;
	return (
		<View style={styles.section}>
			{/* #1375 実機確認: 軸の見出しは **チップの見た目**にする。
			    押すとプルダウンのように選択肢が開く、という関係を形で示すため */}
			<TouchableOpacity
				testID={testID}
				onPress={onPress}
				accessibilityRole="button"
				accessibilityState={{ expanded, selected: expanded }}
				style={[styles.axisChip, expanded && styles.axisChipExpanded]}>
				<Text style={styles.axisChipLabel}>{title}</Text>
				<Text style={styles.accordionValue} numberOfLines={1} testID={`${testID}-value`}>
					{valueLabel}
				</Text>
				<Chevron size={14} color={colors.textSecondary} />
			</TouchableOpacity>
			{expanded && <View style={styles.chipRow}>{children}</View>}
		</View>
	);
}

export default function MyDishesFiltersScreen() {
	useScreenTrace("MyDishesFilters");
	const styles = useThemedStyles(createStyles);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const filter = useMyDishesFilterStore((s) => s.filter);
	const patch = useMyDishesFilterStore((s) => s.patch);
	const clearArea = useMyDishesFilterStore((s) => s.clearArea);

	/*
	#1629【43】【設計】**エリアの絞り込みは、どのビューから開いても出す。**

	オーナー指示: 「エリアで絞った時に、カレンダーの『絞り込み・並び替え』でエリアの絞り込みを
	非表示にする仕様を入れてもらったけど、あれ無くしたい」。

	もともとは #1375 の実機確認で «日付の棚にエリアは要らない» として、Calendar から開いたときだけ
	エリアの節を隠していた（`view !== "calendar"`）。しかし **エリアの絞り込みは実際には Calendar にも
	効いている**（`toMyDishesCalendarQueryParams` は `sort` / `featureKeys` しか落とさず、
	`lat` / `lng` / `radius` はそのまま渡る）。隠していたのは表示だけで、効果は残っていたので、
	Map でエリアを絞ったあと Calendar が減った理由を確かめる場所も、解除する場所も無かった。
	隠す分岐を外すことで «効いているものは、その画面で見えて解除できる» に揃う。

	#1629【提案 2】かつては «グリッドは空なのに開くと入っている» ズレが残っていた（月グリッドは
	エリアで絞られるのに、日付タップで開く Feed だけ `lat` / `lng` / `radius` を落としていたため）。
	オーナー確定「フィルタの条件はマップ・グリッド・カレンダーで一緒、出力結果も同じにする」により
	`toMyDishesDateQueryParams` はエリアを落とさなくなり、3 ビューと Feed が同じ条件・同じ結果になった。

	`view` パラメータは呼び出し側（`my-dishes/index.tsx`）が引き続き渡すが、この画面では使わない。
	*/

	const [draft, setDraft] = useState<MyDishesFilter>(filter);

	/**
	 * #1375（3 巡目）料理カテゴリーの候補。**いま画面に出ている記録**（開いた時点の
	 * base スライス）から数える。取得はしない — 一覧が読んだキャッシュを読むだけなので、
	 * この画面を開いても 964MB の dish_reviews へ新しいクエリは飛ばない。
	 * 開いた時点のスナップショットで固定する（編集中に裏で並びが動くと候補が揺れる）
	 */
	const [categoryFacets] = useState(() => {
		const state = useMyDishesStore.getState();
		const queryKey = selectFilterQueryKey(useMyDishesFilterStore.getState());
		const { itemKeys } = selectMyDishesByQuery(queryKey)(state);
		const items = itemKeys.map((key) => state.itemByKey[key]).filter((item) => Boolean(item));
		// 上限は «全部»。表示側が CATEGORY_COLLAPSE_COUNT で畳む（#1375 4 巡目）
		// #1375 ローマ字ではなくカテゴリの正式表記を出す（dishCategoryLabel.ts）
		return buildCategoryFacets(items, Number.POSITIVE_INFINITY, i18n.locale);
	});
	// #1375 4 巡目: カテゴリーが多いとチップが画面を占領するので、上位だけ見せて「もっと見る」で開く
	const [showAllCategories, setShowAllCategories] = useState(false);
	const visibleCategoryFacets = showAllCategories ? categoryFacets : categoryFacets.slice(0, CATEGORY_COLLAPSE_COUNT);

	const toggleCategory = useCallback(
		(categoryId: string) => {
			lightImpact();
			setDraft((prev) => ({
				...prev,
				categoryIds: prev.categoryIds.includes(categoryId)
					? prev.categoryIds.filter((id) => id !== categoryId)
					: [...prev.categoryIds, categoryId],
			}));
		},
		[lightImpact],
	);
	/** 開いている軸（プルダウン）。同時に 1 つだけ開く */
	const [expandedAxis, setExpandedAxis] = useState<string | null>(null);

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
				const next = prev.status.includes(status) ? prev.status.filter((s) => s !== status) : [...prev.status, status];
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

	/**
	 * 軸の値を選ぶ / 外す。**1 軸につき高々 1 件**（同じ軸の別の値を押すと差し替え）。
	 *
	 * 軸を 1 つでも選んだら並び順を `-featureScore` へ寄せる。ユーザーが「夜ご飯」を選ぶのは
	 * «夜ご飯に合うものを上に出したい» からで、選んだのに並びが変わらないのが一番分かりにくい。
	 * 逆に全部外したら既定の日付順へ戻す（`-featureScore` は軸が無いと 400 になる）。
	 * ただし距離順・評価順のように **ユーザーが明示的に選んだ並び**は奪わない。
	 */
	const toggleFeatureKey = useCallback(
		(featureType: string, id: string) => {
			lightImpact();
			const key = toFeatureKey(featureType, id);
			// #1375 4 巡目: 1 軸 1 値なので、値を **選んだら** その軸の役目は終わり。
			// プルダウンを開いたままにせず閉じる（外したときは選び直しの途中なので開けたまま）
			if (!draft.featureKeys.includes(key)) {
				setExpandedAxis(null);
			}
			setDraft((prev) => {
				const prefix = `${featureType}:`;
				const withoutAxis = prev.featureKeys.filter((k) => !k.startsWith(prefix));
				const next = prev.featureKeys.includes(key) ? withoutAxis : [...withoutAxis, key];
				// 軸を選んだら並びを -featureScore へ寄せる（ユーザーが明示した並びは奪わない）。
				//
				// ⚠️ 全部外しても **-featureScore から巻き戻さない**（独立レビュー指摘 #6）。
				// 巻き戻すと `draft.sort === "-featureScore"` が描画条件の軸セクションごと
				// 消えてしまい、「選び直そうとして外した瞬間に UI が消える」。軸ゼロのまま
				// 適用されてもサーバ側の resolveSort が既定の並びへ落とすので 400 にはならない
				const sort: MyDishesSort = next.length > 0 && prev.sort === "-occurredAt" ? "-featureScore" : prev.sort;
				return { ...prev, featureKeys: next, sort };
			});
		},
		[draft.featureKeys, lightImpact],
	);

	const toggleAxis = useCallback(
		(axisId: string) => {
			lightImpact();
			setExpandedAxis((prev) => (prev === axisId ? null : axisId));
		},
		[lightImpact],
	);

	const selectSort = useCallback(
		(sort: MyDishesSort) => {
			lightImpact();
			// #1396 m-4: 同伴パラメータ（featureKeys）を勝手に埋めない。
			// 軸を選ぶまでこのソートは適用しない（UI 上も「選択済み」に見せない）
			patchDraft({ sort });
		},
		[lightImpact, patchDraft],
	);

	const handleClearArea = useCallback(() => {
		lightImpact();
		// #1396 m-2: 確定済みエリアの解除も「適用」で 1 回だけ反映する。ここでは draft を更新するだけ
		setDraft((prev) => ({
			...prev,
			area: null,
			sort: prev.sort === "distance" ? DEFAULT_MY_DISHES_FILTER.sort : prev.sort,
		}));
	}, [lightImpact]);

	/*
	#1375（オーナー指示 7 巡目）**「リセット」はその場で反映する。**

	以前は下書きを戻すだけで、「適用」を押さずに戻ると **何も起きなかった**
	（「リセット → 戻る でリセットされてない」というオーナー指摘）。

	「リセット」は取り消しではなく «全部外す» という意思表示なので、
	押した結果がその場で見えるのが自然である。ここは
	「store を書くのは適用だけ」という原則の**明示的な例外**にする。
	押した瞬間に 1 回だけ書くので、チップを押すたびに書く形（それを避けるための原則）には戻らない。

	エリアは Map の «このエリアで再検索» が確定したものなので、リセットでも保持する
	（意図せず全国検索に戻さない）。したがって `patch` には area を渡さない。
	*/
	const handleReset = useCallback(() => {
		lightImpact();
		const next: MyDishesFilter = { ...DEFAULT_MY_DISHES_FILTER, area: draft.area };
		setDraft(next);
		const { area: _resetArea, ...patchWithoutArea } = next;
		patch(patchWithoutArea);
		logFrontendEvent({
			event_name: MY_DISHES_EVENTS.filterApplied,
			error_level: "log",
			payload: buildFilterAppliedPayload(next),
		});
	}, [draft.area, lightImpact, logFrontendEvent, patch]);

	const handleApply = useCallback(() => {
		lightImpact();
		// #1396 【設計】ここが唯一 store を書く場所。queryKey が変わったビューだけが取り直す（§3-3）
		// m-3: area はここに含めない。PR4 以降 Map の commitArea が確定した area を、
		// この画面が開いている間のスナップショット（draft）で黙って巻き戻さないため
		const { area: _draftArea, ...patchWithoutArea } = draft;
		patch(patchWithoutArea);
		// m-2: エリア解除（handleClearArea）も「適用」まで反映しない。ここで初めて 1 回だけ store を書く
		if (draft.area === null && filter.area !== null) {
			clearArea();
		}
		// #1403 (PR2) 計測もこの «唯一 store を書く場所» に合わせる。チップの `onPress` からは
		// 一切ログを出さない（押した回数だけログが積まれるのを避ける。上と同じ理由）。
		// payload の中身は `features/myDishes/analytics.ts` に寄せてあり、
		// 「個人を特定しうる値を入れない」判断もそちらに集約している
		logFrontendEvent({
			event_name: MY_DISHES_EVENTS.filterApplied,
			error_level: "log",
			payload: buildFilterAppliedPayload(draft),
		});
		router.back();
	}, [clearArea, draft, filter.area, lightImpact, logFrontendEvent, patch]);

	const handleBack = useCallback(() => {
		lightImpact();
		router.back();
	}, [lightImpact]);

	return (
		/*
		#1375（10 巡目・オーナー実機指摘「私の iPhone だと謎の余白がある」）
		**下端のインセットをここで確保してはいけない。**

		この画面は `(tabs)` の中にあり、**下端の安全領域はタブバーが既に確保している**。
		ここで `edges={["bottom"]}` を足すと、ホームインジケータぶん（iPhone で約 34pt）が
		タブバーの **上に二重で**入り、ボタンの下に説明のつかない帯が出る。

		同じ間違いを一度 my-dishes 本体でも踏んでおり（index.tsx の「タブバーが既に確保している
		下端インセットの分だけ…」のコメント）、**この画面だけ直っていなかった**。
		⚠️ `(tabs)` の外にある画面（`add-record` / `auth/login` / `onboarding`）は
		   タブバーが無いので `bottom` が要る。この判断はタブの内か外かで決まる。
		*/
		<SafeAreaView edges={[]} style={styles.container} testID="my-dishes-filter-screen">
			<ScreenHeader
				title={i18n.t("MyDishes.filters.title")}
				onPressBack={handleBack}
				testID="my-dishes-filter-screen"
			/>

			<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
				<Section
					title={i18n.t("MyDishes.filters.status.title")}
					description={i18n.t("MyDishes.filters.status.description")}>
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

				{/* #1375 実機確認（5 巡目）: 評価は料理カテゴリーより **上**。「食べた」を選ぶと
				    まず «どのくらい美味しかったか» で絞りたい、というオーナーの操作順に合わせる。
				    #1375 実機確認: 評価は「食べた」を選んだときだけ出す。
				    want 行は評価を持たないので、以前は常に出したうえで不活性にし「なぜ押せないか」を
				    注記で説明していた。押せない UI を説明するより、出さない方が短い */}
				{ratingEnabled && (
					<Section
						title={i18n.t("MyDishes.filters.rating.title")}
						description={i18n.t("MyDishes.filters.rating.description")}>
						{RATING_CHOICES.map((rating) => (
							<Chip
								key={rating}
								testID={`my-dishes-filter-rating-${rating}`}
								label={i18n.t("MyDishes.filters.rating.min", { count: rating })}
								selected={draft.minRating === rating}
								onPress={() => selectMinRating(rating)}
							/>
						))}
					</Section>
				)}

				{/* #1375（3 巡目）: 料理カテゴリーの絞り込み。候補は «いま出ている記録の中で多いもの» */}
				{categoryFacets.length > 0 && (
					<Section
						title={i18n.t("MyDishes.filters.category.title")}
						description={i18n.t("MyDishes.filters.category.description")}>
						{visibleCategoryFacets.map((facet) => (
							<Chip
								key={facet.categoryId}
								testID={`my-dishes-filter-category-${facet.categoryId}`}
								label={i18n.t("MyDishes.filters.category.count", { label: facet.label, count: facet.count })}
								selected={draft.categoryIds.includes(facet.categoryId)}
								onPress={() => toggleCategory(facet.categoryId)}
							/>
						))}
						{/* 畳んだぶんがあるときだけ出す。開いたら畳み直しは要らない（適用して閉じる画面なので） */}
						{!showAllCategories && categoryFacets.length > CATEGORY_COLLAPSE_COUNT && (
							<Chip
								testID="my-dishes-filter-category-show-all"
								label={i18n.t("MyDishes.filters.category.showAll", {
									count: categoryFacets.length - CATEGORY_COLLAPSE_COUNT,
								})}
								selected={false}
								onPress={() => {
									lightImpact();
									setShowAllCategories(true);
								}}
							/>
						)}
					</Section>
				)}

				<Section
					title={i18n.t("MyDishes.filters.sort.title")}
					description={i18n.t("MyDishes.filters.sort.description")}>
					{SORT_CHOICES.map(({ sort, labelKey }) => {
						// #1396 m-4: 同伴パラメータが無い間は「選択済み」に見せない。
						// 既定値を勝手に入れないので、軸を選ぶまでこの並びは実質未適用のままである。
						//
						// ⚠️ #1375 実機確認: **`-featureScore` は押せないようにしない。**
						// 押して初めて軸（時間帯〜どんな系統）が出る作りなので、
						// «軸が無いから押せない → 押せないから軸を選べない» で詰む。
						// 軸が無いまま適用されても `resolveSort` が既定の並びへ落とすので 400 にはならない
						return (
							<Chip
								key={sort}
								testID={`my-dishes-filter-sort-${sort}`}
								label={i18n.t(labelKey)}
								selected={draft.sort === sort}
								// distance はエリア（lat/lng/radius）が必須。未確定なら選ばせない（#1395 §4-3）
								disabled={sort === "distance" && !draft.area}
								onPress={() => selectSort(sort)}
							/>
						);
					})}
				</Section>
				{draft.sort === "distance" && !draft.area && (
					<Text style={styles.hint}>{i18n.t("MyDishes.filters.sort.distanceRequiresArea")}</Text>
				)}

				{/* #1375 実機確認: 軸は «「条件を選ぶ」を選んだときだけ» 出す。
				    常に 5 行出していると、日付順で見たいだけの人にも関係ない行が並ぶ。
				    見出しも選択肢も検索画面と同じ文言を使う（`FEATURE_AXES`） */}
				{draft.sort === "-featureScore" && (
					<Text style={styles.axesDescription} testID="my-dishes-filter-axes-description">
						{i18n.t("MyDishes.filters.axes.description")}
					</Text>
				)}
				{draft.sort === "-featureScore" &&
					FEATURE_AXES.map((axis) => {
						const selected = axis.options.find((o) => draft.featureKeys.includes(toFeatureKey(o.featureType, o.id)));
						return (
							<AccordionSection
								key={axis.id}
								testID={`my-dishes-filter-axis-${axis.id}`}
								title={i18n.t(axis.titleKey)}
								valueLabel={selected ? i18n.t(selected.label) : i18n.t("MyDishes.filters.axes.none")}
								expanded={expandedAxis === axis.id}
								onPress={() => toggleAxis(axis.id)}>
								{axis.options.map((option) => (
									<Chip
										key={`${option.featureType}:${option.id}`}
										testID={`my-dishes-filter-axis-${axis.id}-${option.id}`}
										label={option.icon ? `${option.icon} ${i18n.t(option.label)}` : i18n.t(option.label)}
										selected={draft.featureKeys.includes(toFeatureKey(option.featureType, option.id))}
										onPress={() => toggleFeatureKey(option.featureType, option.id)}
									/>
								))}
							</AccordionSection>
						);
					})}

				<View style={styles.section}>
					<Text style={styles.sectionTitle}>{i18n.t("MyDishes.filters.area.title")}</Text>
					<Text style={styles.valueText} testID="my-dishes-filter-area-value">
						{/* #1375 実機確認（2 巡目）: 生の緯度経度は出さない。
						    `35.6812, 139.7671 / 5000m` は «よくわからない数字» でしかなく、
						    ユーザーがやったのは「マップでこの範囲を選んだ」ことだけである。
						    その事実と半径だけを、読める単位（km / m）で言う */}
						{draft.area
							? (draft.area.label ??
								i18n.t("MyDishes.filters.area.selected", { radius: formatAreaRadius(draft.area.radius) }))
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

				{/* #1375 実機確認: 期間の絞り込みはこの画面から廃止した。
				    日付で見たいときは Calendar から Dish Feed へ入る導線が担当する */}
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

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: c.surface,
		},
		content: {
			paddingHorizontal: 16,
			paddingBottom: 24,
		},
		section: {
			marginTop: 20,
		},
		axisChip: {
			alignSelf: "flex-start",
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
			paddingHorizontal: 12,
			paddingVertical: 8,
			borderRadius: 16,
			backgroundColor: c.surfaceSubtle,
		},
		axisChipExpanded: {
			backgroundColor: c.brandTintAlt,
		},
		axisChipLabel: {
			fontSize: 13,
			fontWeight: "700",
			color: c.textSecondaryStrong,
		},
		accordionValue: {
			fontSize: 13,
			color: c.textSecondary,
			flexShrink: 1,
		},
		// #1375 実機確認: 見出しは «小さくてよい»。大きい見出しが並ぶとチップより目立ってしまう
		// #1375（5 巡目・デザインレビュー #10）見出しが自分の説明文より薄かった
		// （12/700 #9CA3AF = プレースホルダ色 vs 説明文 12/400 #6B7280）。
		// 正本 §2 のセクション見出しは 14–15/700
		sectionTitle: {
			fontSize: 14,
			fontWeight: "700",
			color: c.textPrimaryAlt,
			marginBottom: 8,
		},
		sectionDescription: {
			fontSize: 12,
			color: c.textSecondary,
			lineHeight: 17,
			marginBottom: 10,
		},
		axesDescription: {
			marginTop: 16,
			fontSize: 12,
			color: c.textSecondary,
			lineHeight: 17,
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
			backgroundColor: c.surfaceSubtle,
		},
		chipSelected: {
			backgroundColor: c.brandTintAlt,
		},
		chipDisabled: {
			opacity: 0.4,
		},
		chipLabel: {
			fontSize: 13,
			color: c.textSecondaryStrong,
		},
		chipLabelSelected: {
			color: c.brand,
			fontWeight: "700",
		},
		chipLabelDisabled: {
			color: c.textTertiary,
		},
		hint: {
			marginTop: 8,
			fontSize: 12,
			color: c.textSecondary,
		},
		valueText: {
			fontSize: 13,
			color: c.textSecondaryStrong,
		},
		linkButton: {
			marginTop: 8,
			alignSelf: "flex-start",
		},
		linkButtonLabel: {
			fontSize: 13,
			color: c.brand,
			fontWeight: "700",
		},
		footer: {
			flexDirection: "row",
			alignItems: "center",
			gap: 12,
			paddingHorizontal: 16,
			// #1375（9 巡目・オーナー指示）**フッターの下の余白は 0。**
			// 下側は SafeAreaView(edges=["bottom"]) が端末のインセットを別途入れるので、
			// ここで足すぶんはそのまま «ボタンの下だけ間延びして見える» ことになる
			paddingTop: 12,
			paddingBottom: 0,
			borderTopWidth: 1,
			// #1375（5 巡目・デザインレビュー #18）`#EEE` は正本のパレットに無い。罫線は #E5E7EB へ統一
			borderTopColor: c.borderMuted,
		},
		// #1375（5 巡目・デザインレビュー #21）副 CTA が «枠も地も無い素のテキスト» で、
		// 隣の赤い「適用する」との差が開きすぎていた。正本 §1「副 CTA は灰背景 + 濃灰文字」
		resetButton: {
			paddingHorizontal: 16,
			paddingVertical: 12,
			borderRadius: 8,
			backgroundColor: c.surfaceSubtle,
		},
		resetButtonLabel: {
			fontSize: 14,
			color: c.textSecondaryStrong,
			fontWeight: "700",
		},
		applyButton: {
			flex: 1,
		},
	});
