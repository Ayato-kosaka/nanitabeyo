import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { CalendarDays, HelpCircle, LayoutGrid, MapPinned, Plus, SlidersHorizontal } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/PrimaryButton";
import { FixedColors, type Palette } from "@/constants/Palette";
import { MY_DISH_STATUS_ORANGE } from "@/features/myDishes/statusColors";
import {
	selectActiveFilterCount,
	useMyDishesFilterStore,
} from "@/features/myDishes/stores/useMyDishesFilterStore";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import { useLocale } from "@/hooks/useLocale";
import { MyDishesListView } from "@/features/myDishes/components/MyDishesListView";
import { MyDishesMapView } from "@/features/myDishes/components/MyDishesMapView";
import { MyDishesCalendarView } from "@/features/myDishes/components/MyDishesCalendarView";
import { MY_DISHES_EVENTS, buildViewSelectedPayload } from "@/features/myDishes/analytics";
import { useSpotlightTutorial } from "@/features/tutorial/hooks/useSpotlightTutorial";
import {
	MY_DISHES_TUTORIAL_STORAGE_KEY,
	MyDishesSpotlightTutorial,
	type MyDishesTutorialTargetRefs,
} from "@/features/myDishes/components/MyDishesSpotlightTutorial";
import i18n from "@/lib/i18n";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// #1396 【設計】Map / リスト / Calendar は 3 ルートに分けず、1 ルート + `?view=` 切替にする。
// ルートを分けるとビュー切替のたびにアンマウントが起き、Map の viewport・各ビューのスクロール
// 位置が毎回飛ぶ（設計 issue #1396 コメント (1/2) §2-2）。ここでは view の shell だけを持ち、
// 各ビューの中身は PR3〜PR5（共有フィルタ store・Map・Calendar）が実装する。
const MY_DISHES_VIEWS = ["map", "list", "calendar"] as const;
/**
 * #1375（5 巡目・性能レビュー A-2）keep-alive で保持するビューの上限（MRU）。
 * 2 = «行き来する 2 つ» は保持し、3 つ目に触ったら最も古いものを落とす。
 */
const MY_DISHES_KEEP_ALIVE_LIMIT = 2;
type MyDishesView = (typeof MY_DISHES_VIEWS)[number];

function isMyDishesView(value: unknown): value is MyDishesView {
	return typeof value === "string" && (MY_DISHES_VIEWS as readonly string[]).includes(value);
}

const VIEW_ICONS: Record<MyDishesView, typeof MapPinned> = {
	map: MapPinned,
	list: LayoutGrid,
	calendar: CalendarDays,
};

export default function MyDishesScreen() {
	useScreenTrace("MyDishes");
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { user } = useAuth();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const { view } = useLocalSearchParams<{ view?: string }>();
	// #1396 M-2: 既定ビューは list に確定する（PR4 が入るまでの暫定ではない）。
	// list が最も安いビューで、着地時に 964MB の dish_reviews への Map クエリを強制しないため
	const activeView: MyDishesView = isMyDishesView(view) ? view : "list";
	const isGuest = isGuestUser(user);
	// #1396 M-1: 一度訪問したビューは保持する（keep-alive）。条件レンダーで毎回アンマウントすると、
	// ルート分割と同じ理由で Map の viewport（useRef）・各ビューのスクロール位置が毎回飛ぶ
	// （§2-2 が避けたかった挙動そのもの）。未訪問のビューはまだマウントしない。
	//
	// #1375（5 巡目・性能レビュー A-2）**保持するのは «直近 2 つ» までにした。**
	//
	// 3 ビュー全部を貼りっぱなしにすると、`react-native-maps` の MapView（ピン数百）と
	// inverted な月リストが、見えていない間もずっとメモリとレイアウトを占める。実機で
	// 報告されているクラッシュ（低メモリ端末）と «重い» の一因がこれである。取得は
	// `enabled` で既に止めてあるが、**マウントされている限りビュー階層は残る**ので、
	// 取得を止めるだけでは足りない。
	//
	// 一方で全部アンマウントすると M-1 の問題（viewport とスクロール位置が飛ぶ）へ戻る。
	// 実際の使われ方は «2 つのビューを行き来する» が支配的（map ⇄ list、list ⇄ calendar）なので、
	// **MRU 2 つ**を保持すれば行き来では一度もアンマウントされない。3 つ目に触ったときだけ
	// 最も古いものが落ちる。
	const [mountedViews, setMountedViews] = useState<readonly MyDishesView[]>(() => [activeView]);
	useEffect(() => {
		setMountedViews((prev) => {
			// 既に先頭（= 直近使用）なら並べ替えも再レンダーも要らない
			if (prev[0] === activeView) return prev;
			return [activeView, ...prev.filter((v) => v !== activeView)].slice(0, MY_DISHES_KEEP_ALIVE_LIMIT);
		});
	}, [activeView]);

	useEffect(() => {
		logFrontendEvent({
			event_name: "screen_view",
			error_level: "log",
			payload: { screen: "my_dishes" },
		});
	}, [logFrontendEvent]);

	// #1396 【設計】ビュー切替では取得し直さない（設計書 (2/2) §3-3）。URL の `view` だけを
	// 履歴を積まずに書き換える（`router.setParams`）。3 ビューは同じフィルタ状態を共有する前提。
	const handleSelectView = useCallback(
		(next: MyDishesView) => {
			// #1403 (PR2) 同じビューを押しても «切り替え» ではないので、ここで先に抜ける。
			// この early return より **後ろ**でログを出すこと。前に出すと、連打や
			// 再レンダーで同じビューを押し直すたびに 1 行ずつ積まれる（ログが爆発する）
			if (next === activeView) return;
			lightImpact();
			logFrontendEvent({
				event_name: MY_DISHES_EVENTS.viewSelected,
				error_level: "log",
				payload: buildViewSelectedPayload(activeView, next),
			});
			router.setParams({ view: next });
		},
		[activeView, lightImpact, logFrontendEvent],
	);

	const handleLoginPress = useCallback(() => {
		lightImpact();
		router.push({ pathname: "/[locale]/auth/login", params: { locale, next: `/${locale}/my-dishes` } });
	}, [lightImpact, locale]);

	// #1396 【設計】フィルタ編集はルート（`my-dishes/filters`）へ push する。BlurModal は使わない（§8-5）
	// #1375（オーナー指示）絞り込みアイコンに出すバッジの数（棚を削っているものだけ数える）
	const activeFilterCount = useMyDishesFilterStore(selectActiveFilterCount);

	const handleFilterPress = useCallback(() => {
		lightImpact();
		// #1375 実機確認: どのビューから開いたかを渡す。Calendar からのときは
		// エリアの絞り込みを出さない（日付の棚にエリアは要らない）
		router.push({ pathname: "/[locale]/(tabs)/my-dishes/filters", params: { locale, view: activeView } });
	}, [activeView, lightImpact, locale]);

	// #1396 【設計】旧レビュータブの投稿導線（`review-post-button`）の後継。
	//
	// #1375 実機確認: 押下先を **SNS URL 取り込み画面**へ変えた。＋ の基本導線は
	// 「SNS で見つけた店を食べたいに入れる」であり、「食べた」の記録はその画面の上部タブから
	// 切り替える（`app/[locale]/add-record.tsx`）。OS の共有シートからの着地点と同じ画面なので、
	// 入口が 2 つで着地は 1 つになる。
	//
	// 取り込みは `dish_media.user_id` を NULL のままにし、ユーザーとの紐付けを
	// `reactions(save)` が持つため **ログイン不要**である（API も AuthAnonGuard）。
	// したがってこのボタンはゲストにも出す。ログインが要るのは切替先の「食べたを記録」だけで、
	// その判定は sns-import 側が行う。
	const handleRecordPress = useCallback(() => {
		lightImpact();
		// #1403 (PR2) 旧名 `my_dishes_record_button_clicked`。my-dishes の他イベントが
		// `_pressed` / `_selected` で揃っているのにここだけ `_clicked` だったので改名した。
		// この機能はまだリリースされておらず、旧名を見ているダッシュボードは存在しない
		logFrontendEvent({
			event_name: MY_DISHES_EVENTS.recordPressed,
			error_level: "log",
			payload: {},
		});
		router.push({ pathname: "/[locale]/add-record", params: { locale } });
	}, [lightImpact, logFrontendEvent, locale]);

	// #1375 実機確認: SafeAreaView に `bottom` を含めると、タブバーが既に確保している下端インセットの
	// 分だけ地図の下に白い帯が二重に入る（実機で「画面下部に不自然な余白」として見えていた）。
	// 下端はタブバーに任せ、ここでは上端だけ確保する
	/**
	 * #1375（5 巡目・性能）タブが前面にあるか。
	 *
	 * bottom-tabs は `unmountOnBlur` を指定していないので、一度開いたタブは離れても
	 * unmount されない。これを見ずに `activeView` だけで判定すると、検索タブにいる間も
	 * my-dishes の 1 ビューが取得し続ける。
	 *
	 * ⚠️ `useIsFocused()` は **ナビゲータの中でだけ**呼べる。ここは (tabs) 配下の画面なので
	 * 安全だが、Portal 配下のコンポーネントへ持ち込むと例外になる（#1375 で実際に踏んだ）。
	 * だからここで 1 回だけ読み、子には props で配る
	 */
	const isScreenFocused = useIsFocused();

	/*
	#1375 実機確認（5 巡目）オーナー要望: この画面のチュートリアル。

	初見では «上部の 3 アイコンがビュー切替である» ことも «カードを押すと全画面フィードに入る»
	ことも分からない、という指摘への対処。料理提案画面（#927）と同じスポットライト形式で、
	仕組みは `features/tutorial/` と共有している。

	⚠️ ref は `collapsable={false}` の View に付けること。RN は子を持たない View を
	ネイティブ階層から畳んでしまい、`measureInWindow` が返らなくなる（#927 で踏んだ）。
	*/
	const viewSwitchTutorialRef = useRef<View>(null);
	const bodyTutorialRef = useRef<View>(null);
	const addButtonTutorialRef = useRef<View>(null);
	const filterButtonTutorialRef = useRef<View>(null);
	const tutorialTargetRefs = useMemo<MyDishesTutorialTargetRefs>(
		() => ({
			viewSwitch: viewSwitchTutorialRef,
			body: bodyTutorialRef,
			addButton: addButtonTutorialRef,
			filterButton: filterButtonTutorialRef,
		}),
		[],
	);
	// 器が描かれてからでないと座標が測れない。ゲストのログイン帯は高さが変わるので、
	// «画面が出ている» ことだけを条件にする（中身の読み込み完了は待たない —
	// この 4 つはデータに依存しない画面の骨格である）
	const {
		isTutorialRequested,
		tutorialRequestId,
		openReason: tutorialOpenReason,
		openManually: openTutorialManually,
		close: closeTutorial,
		markPresented: markTutorialPresented,
	} = useSpotlightTutorial({ storageKey: MY_DISHES_TUTORIAL_STORAGE_KEY, canAutoOpen: true });

	// #1375（オーナー指示）チュートリアルを見返す口。以前は一度見たら二度と開けなかった
	const handleReplayTutorial = useCallback(() => {
		lightImpact();
		openTutorialManually();
	}, [lightImpact, openTutorialManually]);

	return (
		<SafeAreaView edges={["top"]} style={styles.container} testID="my-dishes-screen">
			{/* #1375 実機確認: 画面タイトル「食べたい/食べた」はタブ名と重複しているだけなので出さない。
			    並びは Issue 記載の [Map] [List] [Calendar] [Filter] に揃える（Filter は切替ではなく別ルートへの push） */}
			<View style={styles.header}>
				{/* #1375 実機確認（2 巡目）: ストーリーズアーカイブと同じ **黒/灰のアイコン切替**にする。
				    赤は使わない。アクティブは黒アイコン + 下線、非アクティブは灰。ラベルは出さず
				    読み上げには accessibilityLabel で残す。
				    絞り込みは «ビュー切替ではない別系統» なので、同じ列に混ぜず右端に
				    丸囲みのアイコンだけで置く */}
				<View style={styles.viewSwitch} ref={viewSwitchTutorialRef} collapsable={false}>
					{MY_DISHES_VIEWS.map((v) => {
						const Icon = VIEW_ICONS[v];
						const isActive = activeView === v;
						return (
							<TouchableOpacity
								key={v}
								testID={`my-dishes-view-${v}`}
								onPress={() => handleSelectView(v)}
								style={styles.viewButton}
								accessibilityRole="button"
								accessibilityState={{ selected: isActive }}
								accessibilityLabel={i18n.t(`MyDishes.views.${v}`)}>
								<Icon
									size={22}
									color={isActive ? colors.textPrimaryAlt : colors.textTertiary}
									strokeWidth={isActive ? 2.2 : 1.8}
								/>
								{/* 下線はアクティブのときだけ描く（非アクティブへ薄線を残すと選択が読めなくなる） */}
								<View style={[styles.viewUnderline, !isActive && styles.viewUnderlineHidden]} />
							</TouchableOpacity>
						);
					})}
					<View style={styles.viewSwitchSpacer} />
					<View ref={filterButtonTutorialRef} collapsable={false}>
						<TouchableOpacity
							testID="my-dishes-filter-button"
							onPress={handleFilterPress}
							style={styles.filterButton}
							accessibilityRole="button"
							accessibilityLabel={
								activeFilterCount > 0
									? i18n.t("MyDishes.filters.activeCount", { count: activeFilterCount })
									: i18n.t("MyDishes.filters.title")
							}>
							<SlidersHorizontal size={18} color={colors.textPrimaryAlt} />
							{/* #1375（オーナー指示）絞り込みが効いていることを右上の印で出す。
							    アイコンだけだと «絞り込んだまま» に気づけず、«記録が消えた» と誤解する。
							    #1629（オーナー指示）**件数は出さない。** 知りたいのは «効いているか» であって
							    «何個か» ではなく、数字はそのぶん読ませる情報が増えるだけである
							    （数えられる場所は絞り込み画面そのもの）。0 のときは出さない */}
							{activeFilterCount > 0 && <View style={styles.filterBadge} testID="my-dishes-filter-badge" />}
						</TouchableOpacity>
					</View>
					<View style={styles.viewSwitchSpacer} />
					{/* #1375（9 巡目・オーナー指示）チュートリアルを見返す口は絞り込みの **右**。
					    8 巡目までは左に置いていたが、«左＝ビュー切替、右＝道具» の並びのほうが
					    目で追いやすい、という指摘による */}
					<TouchableOpacity
						testID="my-dishes-tutorial-replay"
						onPress={handleReplayTutorial}
						style={styles.tutorialButton}
						accessibilityRole="button"
						accessibilityLabel={i18n.t("MyDishes.tutorial.replay")}>
						<HelpCircle size={18} color={colors.textSecondary} />
					</TouchableOpacity>
				</View>
			</View>

			{/* #1375 実機確認: ゲストにもここを開ける。
			    「食べたい」＝ `reactions(action_type='save')` は**匿名ユーザーでも書けている**（保存ボタンは
			    ゲストにも出ている）。にもかかわらずこのタブを丸ごとログインで閉じていたので、
			    「保存はできるが保存したものを見られない」状態になっていた。save=食べたい / dish_review=食べた
			    という仕様に対して、閉じるべきなのは**タブではなく「食べた」の記録導線**の方である。
			    匿名→本アカウントは `linkIdentity` で **同じ user id のまま昇格**するので、
			    ゲスト中の保存はログイン後もそのまま引き継がれる（AuthProvider.linkIdentity）。 */}
			{isGuest && (
				<View style={styles.guestBanner}>
					<Text testID="my-dishes-guest-description" style={styles.guestBannerText}>
						{i18n.t("MyDishes.guest.description")}
					</Text>
					<PrimaryButton
						testID="my-dishes-guest-login-button"
						onPress={handleLoginPress}
						label={i18n.t("MyDishes.guest.loginButton")}
						style={styles.guestBannerButton}
					/>
				</View>
			)}

			<View style={styles.body} ref={bodyTutorialRef} collapsable={false}>
				{
					// #1396 【設計】ビュー切替では再取得しない（設計書 (2/2) §3-3）。3 ビューは
					// `useMyDishesFilterStore` の `queryKey` を共有しており、切り替えても
					// `queryKey` が変わらないので、既に読んだページをそのまま描く。
					//
					// M-1: 条件レンダーで毎回アンマウントすると、ルート分割と同じ理由で
					// Map の viewport（`MyDishesMapView` 内の `useRef`）・各ビューのスクロール位置が
					// 毎回飛ぶ（§2-2 が避けたかった挙動そのもの）。一度訪問したビューは
					// アンマウントせず `display: "none"` 相当で隠すだけにする（keep-alive）。
					// 未訪問のビューはまだマウントしない。RN / react-native-web の両方で効くよう
					// `pointerEvents="none"` と `accessibilityElementsHidden` /
					// `importantForAccessibility="no-hide-descendants"` で非表示ビューをタッチと
					// 読み上げから除外する。この器の形は PR4（Map）・PR5（Calendar）がそのまま踏襲する。
					// PR4 で Map（`MyDishesMapView`）が入ったことで、keep-alive の器があって初めて
					// 内部の viewport `useRef` が意味を持つ（ビュー切替のたびにアンマウントされない）。
					// PR5 の Calendar も同じで、inverted リストのスクロール位置（どこまで遡ったか）が
					// ビュー切替のたびに最新月へ戻らないのは、この器がアンマウントしないからである。
					<>
						{MY_DISHES_VIEWS.map((v) => {
							if (!mountedViews.includes(v)) return null;
							const isActive = v === activeView;
							return (
								<View
									key={v}
									testID={`my-dishes-${v}-view`}
									style={[styles.viewPlaceholder, !isActive && styles.hiddenView]}
									pointerEvents={isActive ? "auto" : "none"}
									accessibilityElementsHidden={!isActive}
									importantForAccessibility={isActive ? "auto" : "no-hide-descendants"}>
									{/* #1375（5 巡目・性能）**見えているビューだけが取得する。**
									    3 ビューは keep-alive なので、`bumpMyDishesRevision()` が
									    キャッシュを捨てると隠れているビューまで取り直しに行っていた。
									    一覧の取得は実測で平均 4.48 秒（#1395 §0(A)）なので、
									    保存ボタン 1 タップで数秒級のクエリが最大 3 本走っていた。
									    ⚠️ 捨てる範囲は変えていない（全部捨てるのが唯一ズレない）。
									    変えたのは «取り直すタイミング» だけで、隠れているビューは
									    `hasFetchedInitial` が false のまま待ち、見えた瞬間に取り直す */}
									{/* #1375（6 巡目・オーナー指示）**1 つのビューの描画時例外でアプリごと落とさない。**
									    「マップから絞り込みをする画面がすごいクラッシュする」への構造対策。
									    描画中に throw すると（API が想定と違う形を返した等）アプリ全体の
									    ErrorBoundary まで抜けて «予期しないエラー → トップへ戻る» になり、
									    ユーザーからは «落ちた» と区別が付かない（#1561 と同じ型）。
									    ビュー単位で捕まえれば、その場の再試行に閉じ込められる。
									    ⚠️ これは受け皿であって原因の修正ではない。原因は別途 asApiList 等で潰す */}
									<ErrorBoundary>
										{v === "list" && <MyDishesListView enabled={isActive && isScreenFocused} />}
										{v === "map" && <MyDishesMapView enabled={isActive && isScreenFocused} />}
										{v === "calendar" && <MyDishesCalendarView enabled={isActive && isScreenFocused} />}
									</ErrorBoundary>
								</View>
							);
						})}
					</>
				}
			</View>

			<View ref={addButtonTutorialRef} collapsable={false} style={styles.fabAnchor}>
				<TouchableOpacity
					testID="my-dishes-record-button"
					onPress={handleRecordPress}
					style={styles.fab}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("MyDishes.record.cta")}>
					{/* #1375 実機確認: 「記録する」の文字は出さず ＋ だけにする。
					    ラベルは accessibilityLabel に残すので読み上げからは失われない */}
					{/* brand 塗りの FAB の上。地色がライト / ダークで変わらないため文字も固定 */}
					<Plus size={24} color={FixedColors.onFilled} />
				</TouchableOpacity>
			</View>

			{/* #1375 実機確認（5 巡目）: 初見の人へ «この画面の使い方» を指す。
			    仕組みは料理提案画面（#927）と共通（features/tutorial/） */}
			<MyDishesSpotlightTutorial
				visible={isTutorialRequested}
				requestId={tutorialRequestId}
				openReason={tutorialOpenReason}
				targetRefs={tutorialTargetRefs}
				onPresented={markTutorialPresented}
				onClose={closeTutorial}
				onUnavailable={closeTutorial}
			/>
		</SafeAreaView>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: c.surface,
		},
		header: {
			paddingHorizontal: 16,
			paddingTop: 8,
			// #1375（6 巡目・オーナー指示）選択中のタブの下線と、ヘッダの区切り線の間に
			// 余白を作らない。以前は 12 空けており «下線の下にもう一本、意味の無い帯がある»
			// ように見えていた。下線がそのまま区切り線へ接するようにする
			paddingBottom: 0,
			borderBottomWidth: 1,
			borderBottomColor: c.borderMuted,
		},
		viewSwitch: {
			flexDirection: "row",
			// #1375（オーナー指示・2 度目）**下端で揃える。**
			// `center` だと、右のボタン（38 + marginBottom 8 = 46）が行の高さを決め、
			// 38 しかないタブ側が上下に 4px ずつ振り分けられる。その下の 4px が
			// «下線の下に残る余白» の正体だった（paddingBottom を 0 にしても消えない）
			alignItems: "flex-end",
		},
		viewButton: {
			flex: 1,
			alignItems: "center",
			paddingTop: 6,
			gap: 8,
		},
		viewUnderline: {
			height: 2,
			alignSelf: "stretch",
			marginHorizontal: 18,
			borderRadius: 1,
			backgroundColor: c.textPrimaryAlt,
		},
		// 高さを変えないために透明で残す（消すとアイコンの縦位置がアクティブだけずれる）
		viewUnderlineHidden: {
			backgroundColor: "transparent",
		},
		viewSwitchSpacer: {
			width: 12,
		},
		// 絞り込みは «別系統» と分かるよう、丸囲みのアイコンボタンにする
		filterButton: {
			width: 38,
			height: 38,
			borderRadius: 19,
			borderWidth: 1,
			borderColor: c.borderMuted,
			alignItems: "center",
			justifyContent: "center",
			// 下線（高さ 2）と同じ分だけ持ち上げて、タブのアイコン列と光学的に揃える
			marginBottom: 8,
		},
		// #1375（オーナー指示）チュートリアルの «?»。絞り込みより一段弱い見た目にする
		// （枠を持たせると絞り込みと同じ強さに見え、どちらが主か分からなくなる）
		tutorialButton: {
			width: 32,
			height: 32,
			alignItems: "center",
			justifyContent: "center",
			marginBottom: 11,
		},
		// #1375（オーナー指示）絞り込みが効いていることを示す印。右上に重ねる。
		// #1629（オーナー指示）件数は出さないので、数字が入る幅を持たない **点** にした
		filterBadge: {
			position: "absolute",
			top: -2,
			right: -2,
			width: 10,
			height: 10,
			borderRadius: 5,
			// #1375（オーナー指示 8 巡目）赤（= CTA の色）ではなくオレンジ。
			// 状態のバッジ（食べたい / 食べた）と同じ記号色に揃える
			backgroundColor: MY_DISH_STATUS_ORANGE,
			// 地の色と接して読めなくならないよう縁を付ける（他のバッジ類と同じ考え方）
			borderWidth: 1.5,
			borderColor: c.surface,
		},
		body: {
			flex: 1,
		},
		viewPlaceholder: {
			flex: 1,
		},
		// M-1: 非表示ビューを `display: "none"` で隠す。RN の View / react-native-web の両方で効く
		hiddenView: {
			display: "none",
		},
		// #1375 ゲストは「食べたい」を閲覧できる。ログインは «食べたを記録するため» の導線として
		// 一覧の上に細く出すだけにする（画面を占有しない）
		guestBanner: {
			flexDirection: "row",
			alignItems: "center",
			gap: 12,
			paddingHorizontal: 16,
			paddingVertical: 10,
			// #1375（5 巡目・デザインレビュー #19）パレットに無い淡ピンクをやめる。
			// 画面上部に常時ピンクが乗ると、赤い FAB と主張が競合する。
			// 赤はこの帯の中のログインボタン 1 点だけに残す
			backgroundColor: c.surfaceSubtle,
			borderBottomWidth: 1,
			borderBottomColor: c.brandBorder,
		},
		guestBannerText: {
			flex: 1,
			fontSize: 13,
			color: c.textSecondary,
		},
		guestBannerButton: {
			flexShrink: 0,
		},
		// #1375（5 巡目）チュートリアルが ＋ の座標を測れるよう、**位置決めは器の側**へ移した。
		// ボタン自身を position:"absolute" のままにすると、包んだ器は 0×0 のまま流れの中に残り、
		// measureInWindow が «画面の左上の点» を返してスポットライトが明後日の方向を指す
		fabAnchor: {
			position: "absolute",
			right: 16,
			bottom: 16,
		},
		fab: {
			alignItems: "center",
			justifyContent: "center",
			width: 56,
			height: 56,
			borderRadius: 28,
			backgroundColor: c.brand,
			shadowColor: FixedColors.badgeBackground,
			shadowOffset: { width: 0, height: 2 },
			shadowOpacity: 0.2,
			shadowRadius: 8,
			elevation: 6,
		},
	});
