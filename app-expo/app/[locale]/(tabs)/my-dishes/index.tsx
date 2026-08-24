import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { CalendarDays, LayoutGrid, MapPinned, Plus, SlidersHorizontal } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/PrimaryButton";
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

// #1396 【設計】Map / リスト / Calendar は 3 ルートに分けず、1 ルート + `?view=` 切替にする。
// ルートを分けるとビュー切替のたびにアンマウントが起き、Map の viewport・各ビューのスクロール
// 位置が毎回飛ぶ（設計 issue #1396 コメント (1/2) §2-2）。ここでは view の shell だけを持ち、
// 各ビューの中身は PR3〜PR5（共有フィルタ store・Map・Calendar）が実装する。
const MY_DISHES_VIEWS = ["map", "list", "calendar"] as const;
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
	// （§2-2 が避けたかった挙動そのもの）。未訪問のビューはまだマウントしない
	const [visitedViews, setVisitedViews] = useState<Set<MyDishesView>>(() => new Set([activeView]));
	useEffect(() => {
		setVisitedViews((prev) => (prev.has(activeView) ? prev : new Set(prev).add(activeView)));
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
		close: closeTutorial,
		markPresented: markTutorialPresented,
	} = useSpotlightTutorial({ storageKey: MY_DISHES_TUTORIAL_STORAGE_KEY, canAutoOpen: true });

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
								<Icon size={22} color={isActive ? "#111827" : "#9CA3AF"} strokeWidth={isActive ? 2.2 : 1.8} />
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
							accessibilityLabel={i18n.t("MyDishes.filters.title")}>
							<SlidersHorizontal size={18} color="#111827" />
						</TouchableOpacity>
					</View>
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
							if (!visitedViews.has(v)) return null;
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
									{v === "list" && <MyDishesListView enabled={isActive && isScreenFocused} />}
									{v === "map" && <MyDishesMapView enabled={isActive && isScreenFocused} />}
									{v === "calendar" && <MyDishesCalendarView enabled={isActive && isScreenFocused} />}
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
					<Plus size={24} color="#FFFFFF" />
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

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#FFFFFF",
	},
	header: {
		paddingHorizontal: 16,
		paddingTop: 8,
		paddingBottom: 12,
		borderBottomWidth: 1,
		borderBottomColor: "#EEE",
	},
	viewSwitch: {
		flexDirection: "row",
		alignItems: "center",
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
		backgroundColor: "#111827",
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
		borderColor: "#D1D5DB",
		alignItems: "center",
		justifyContent: "center",
		marginBottom: 6,
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
		backgroundColor: "#FFF7F5",
		borderBottomWidth: 1,
		borderBottomColor: "#F6DCD5",
	},
	guestBannerText: {
		flex: 1,
		fontSize: 13,
		color: "#6B7280",
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
		backgroundColor: "#F05537",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.2,
		shadowRadius: 8,
		elevation: 6,
	},
});
