import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { View, StyleSheet, LayoutChangeEvent } from "react-native";
import { router, useGlobalSearchParams, useLocalSearchParams } from "expo-router";
import { Tabs } from "@/components/collapsible-tabs";
import { ProfileHeader } from "../components/ProfileHeader";
import { ProfileTabsBar } from "../components/ProfileTabsBar";
import { ReviewTab } from "../tabs/ReviewTab";
import { LikeTab } from "../tabs/LikeTab";
import { SavedPostsTab } from "../tabs/SavedPostsTab";
import { SavedTopicsTab } from "../tabs/SavedTopicsTab";
// #1071 【リリース差分】ウォレットのペインを落としたため未使用になった import。
// バンドルに未使用の Tab 実装を含めないようにコメントアウトする(復活時は下の
// Tabs.Tab のコメントと合わせて戻す)。
// import { DepositsTab } from "../tabs/wallet/DepositsTab";
// import { EarningsTab } from "../tabs/wallet/EarningsTab";
import { LoginbackModal } from "../components/LoginbackModal";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
// #1071 【リリース差分】同上。constants.ts の mockBids / mockEarnings 自体は将来の
// 復活のために残してあるため、import だけを落とす。
// import { mockBids, mockEarnings } from "../constants";
import { ProfileEditForm } from "../components/ProfileEditForm";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import type { GroupName, RouteName } from "../components/ProfileTabsBar";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { useProfileStore } from "../stores/useProfileStore";
import { useEnsureOwnProfileLoaded } from "../hooks/useEnsureOwnProfileLoaded";
import { LoadingIndicator } from "@/components/LoadingIndicator";
// #1272 E2E ビルド限定のルートパラメータプローブ。通常ビルドでは metro が noop へ差し替える
import { e2eRouteParamsProbeElement } from "@/lib/e2e/routeParamsProbe";

export function ProfileTabsLayout() {
	const { mediumImpact, lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { user, isAuthResolved } = useAuth();

	// #467 【設計】プロフィールをグローバルストアから取得し、自動ロードを実行
	useEnsureOwnProfileLoaded();
	const profile = useProfileStore((state) => state.profile);

	const { BlurModal: ProfileEditModal, open: openEditModal, close: closeEditModal } = useBlurModal({ intensity: 100 });
	const { BlurModal: LoginModal, open: openLoginModal, close: closeLoginModal } = useBlurModal({ intensity: 100 });

	const [headerHeight, setHeaderHeight] = useState(0);
	const [isFollowing, setIsFollowing] = useState(false);

	const isOwnProfile = useMemo(() => true, []);
	// #1092 PR4b `user?.is_anonymous !== false` から共通判定へ寄せた。
	// 旧式は is_anonymous が undefined のときもゲストへ倒れ、ログイン済みユーザーの
	// レビュータブが消える。理由は lib/authGuest.ts を参照（通知タブ・設定と同じ式）
	const isGuest = useMemo(() => isGuestUser(user), [user]);

	const availableTabs: GroupName[] = useMemo(() => {
		const tabs: GroupName[] = [];
		if (!isGuest) {
			tabs.push("reviews");
		}
		if (isOwnProfile) {
			tabs.push("saved", "liked");
			// #1071 【リリース差分】ウォレット(入札・収益)は未完成のため本番では出さない。
			// 表示するデータは features/profile/constants.ts の mockBids / mockEarnings で、
			// 実データを取る経路が存在しない(フロントから me/payouts を呼んでいない)。
			// さらに #811 が MVP で「ウォレット」というアプリ内表現を禁止している。
			// タブバー・tabRoutes・ペインの 3 箇所を全て落とすこと。
			// 1 箇所でも残すと ?tab=wallet-deposit のディープリンクまたは横スワイプで到達できてしまう。
			// if (!isGuest) {
			// 	tabs.push("wallet");
			// }
		}
		return tabs;
	}, [isOwnProfile, isGuest]);

	const tabRoutes: RouteName[] = useMemo(() => {
		const routes: RouteName[] = [];
		if (!isGuest) {
			routes.push("reviews");
		}
		if (isOwnProfile) {
			routes.push("saved-posts", "saved-topics", "liked");
			// #1071 【リリース差分】ウォレットの route も落とす。ここを残すと requestedTab の検証
			// (tabRoutes.includes(...)) を通ってしまい、/ja-JP/profile?tab=wallet-deposit の
			// ディープリンクでウォレットへ到達できてしまう。
			// if (!isGuest) {
			// 	routes.push("wallet-deposit", "wallet-earning");
			// }
		}
		return routes;
	}, [isOwnProfile, isGuest]);

	// #954 【修正】遷移元からタブを指定できるようにする(例: トピック保存スナックバーの
	// 「見る」→ tab=saved-topics)。指定が無い/不正な場合は従来通り先頭タブを表示する。
	// tabRequest は「同じタブへの2回目以降の遷移」でも必ず切り替えるためのリクエスト識別子
	// (遷移元が Date.now() 等を渡す。値自体に意味はなく、変化の検知にだけ使う)。
	// ⚠️ `useLocalSearchParams` **だけ**に頼らないこと。
	// あれは「そのルートが focus された時点の」パラメータしか返さず、
	// **ディープリンクでこの画面へ直接着地した場合**に取りこぼすことがある。
	// 実際 iOS の Detox が「マイページには着いているのに先頭タブのまま」で捕まえた
	// （Android では同じコードで切り替わるため、端末差として現れて切り分けにくい）。
	// `useGlobalSearchParams` は URL 全体を追うので、着地直後でも値が入る。
	// 通常遷移では local が正なので local を優先し、無いときだけ global で補う。
	const localParams = useLocalSearchParams<{ tab?: string; tabRequest?: string }>();
	const globalParams = useGlobalSearchParams<{ tab?: string; tabRequest?: string }>();
	const requestedTabParam = localParams.tab ?? globalParams.tab;
	const tabRequestParam = localParams.tabRequest ?? globalParams.tabRequest;
	const requestedTab = useMemo(
		() => (requestedTabParam && tabRoutes.includes(requestedTabParam as RouteName) ? requestedTabParam : undefined),
		[requestedTabParam, tabRoutes],
	);

	// #954 【設計】プロフィールはタブナビゲータ内で mount され続けるため、initialTabName
	// (mount 時のみ有効)だけでは2回目以降の遷移でタブが切り替わらない。
	// native は react-native-collapsible-tab-view の CollapsibleRef.jumpToTab、web は
	// アダプタ(index.web.tsx)に追加した同名の命令的 API で、パラメータ変更のたびに切り替える。
	const tabsContainerRef = useRef<{ jumpToTab?: (name: string) => void } | null>(null);
	// #1272 【プローブ】jumpToTab の結末を E2E ビルドで観測できるようにする。
	// "none"（effect 未発火）/ "direct"（即時に呼べた）/ "retried:<n>"（n 回目のリトライで呼べた）/
	// "gaveup"（2 秒待っても ref が生えなかった）。通常ビルドでは setState されるだけで描画物は無い
	const [e2eJumpOutcome, setE2eJumpOutcome] = useState("none");
	useEffect(() => {
		if (!requestedTab) return;

		// ⚠️ 1 回呼んで終わりにしないこと。**ディープリンクで直接この画面へ着地した場合**、
		// この effect が走る時点で ref がまだ埋まっていないことがあり、`?.()` が黙って
		// 捨てられて二度と再試行されない。結果「?tab= が効く端末と効かない端末がある」
		// という切り分けの難しい形で壊れる（iOS の Detox が先頭タブのまま止まって捕まえた）。
		// 効いたかどうかは外から観測できないので、ref が生えるまで短間隔で試し、
		// 生えたら 1 度だけ呼んで止める。
		if (tabsContainerRef.current?.jumpToTab) {
			tabsContainerRef.current.jumpToTab(requestedTab);
			setE2eJumpOutcome("direct");
			return;
		}

		let attempts = 0;
		const timer = setInterval(() => {
			attempts += 1;
			if (tabsContainerRef.current?.jumpToTab) {
				tabsContainerRef.current.jumpToTab(requestedTab);
				setE2eJumpOutcome(`retried:${attempts}`);
				clearInterval(timer);
			} else if (attempts >= 20) {
				// 2 秒待っても生えないのは別の異常。無限に回さない
				setE2eJumpOutcome("gaveup");
				clearInterval(timer);
			}
		}, 100);
		return () => clearInterval(timer);
		// #1272 【バグ】deps に isAuthResolved が無いと、この effect は **auth 未解決のうちに一度だけ**
		// 走って終わる。auth 未解決の間は下の早期 return で Tabs.Container がマウントされないため
		// ref は絶対に生えず、iOS のコールドスタート（セッション注入 + プロフィール取得）が
		// 2 秒を超えるとリトライが尽きる（probe の実測 `jump=gaveup`。パラメータは届いているのに
		// タブが切り替わらない）。auth の解決で effect を再実行すれば、その時点で ref は生えており
		// 即時に跳べる。リトライ間隔を伸ばす方向で直さないこと — 「何 ms 待てば十分か」は
		// 端末依存で答えが無く、マウントを追いかける形だけが正しい
	}, [requestedTab, tabRequestParam, isAuthResolved]);

	// #1272 【プローブ】「パラメータがどの段で消えているか」を示す実測値。
	// local/global が "-" なら expo-router がクエリを届けていない（起動 URL 処理の問題）、
	// 値があるのに先頭タブなら jumpToTab / initialTabName が効いていない（タブ実装の問題）。
	// 通常ビルドでは e2eRouteParamsProbeElement が常に null を返すため描画物は増えない
	const e2eProbe = e2eRouteParamsProbeElement({
		local: localParams.tab,
		global: globalParams.tab,
		requested: requestedTab,
		auth: isAuthResolved ? "1" : "0",
		jump: e2eJumpOutcome,
	});

	const handleHeaderLayout = useCallback((event: LayoutChangeEvent) => {
		const { height } = event.nativeEvent.layout;
		setHeaderHeight(height);
	}, []);

	const handleBack = useCallback(() => {
		router.back();
	}, []);

	const handleShareProfile = useCallback(() => {
		if (!profile) return;
		lightImpact();
		logFrontendEvent({
			event_name: "profile_shared",
			error_level: "log",
			payload: { userId: profile.id, username: profile.username },
		});
	}, [lightImpact, logFrontendEvent, profile]);

	const handleFollow = useCallback(() => {
		if (!profile) return;
		mediumImpact();
		const newFollowState = !isFollowing;
		setIsFollowing(newFollowState);
		logFrontendEvent({
			event_name: newFollowState ? "user_followed" : "user_unfollowed",
			error_level: "log",
			payload: {
				targetUserId: profile.id,
				targetUsername: profile.username,
			},
		});
	}, [mediumImpact, isFollowing, logFrontendEvent, profile]);

	const handleEditProfile = useCallback(() => {
		lightImpact();
		openEditModal();
		logFrontendEvent({
			event_name: "profile_edit_started",
			error_level: "log",
			payload: {},
		});
	}, [lightImpact, openEditModal, logFrontendEvent]);

	const handleLogin = useCallback(() => {
		lightImpact();
		openLoginModal();
		logFrontendEvent({
			event_name: "login_modal_opened",
			error_level: "log",
			payload: { userId: user?.id },
		});
	}, [lightImpact, openLoginModal, logFrontendEvent, user?.id]);

	const handleTabChange = useCallback(
		(index: number) => {
			const tabName = tabRoutes[index];
			logFrontendEvent({
				event_name: "profile_tab_changed",
				error_level: "log",
				payload: { tabName, userId: user?.id },
			});
		},
		[tabRoutes, logFrontendEvent, user?.id],
	);

	const renderHeader = useCallback(() => {
		if (!profile) {
			return null;
		}
		return (
			<ProfileHeader
				profile={profile}
				isOwnProfile={isOwnProfile}
				isGuest={isGuest}
				isFollowing={isFollowing}
				onLayout={handleHeaderLayout}
				onBack={handleBack}
				onShare={handleShareProfile}
				onEditProfile={handleEditProfile}
				onFollow={handleFollow}
				onMessage={() => {}}
				onLogin={handleLogin}
			/>
		);
	}, [
		profile,
		isOwnProfile,
		isGuest,
		isFollowing,
		handleHeaderLayout,
		handleBack,
		handleShareProfile,
		handleEditProfile,
		handleFollow,
		handleLogin,
	]);

	const renderTabBar = useCallback(
		(props: TabBarProps<string>) => {
			return <ProfileTabsBar {...props} availableTabs={availableTabs} />;
		},
		[availableTabs],
	);

	// #1092 【設計】auth 未確定(user === null)の間はタブ構成を確定させない。
	// isGuest は user === null をゲスト扱いにする（lib/authGuest.ts）ので、未確定のままだと
	// ログイン済みのリピーターでは「reviews タブ無しで描画 → 後からタブが増える」というちらつきになる。
	// タブ本数が変わると Tabs.Container 全体が作り直されるため、確定するまで描画を保留する。
	// ⚠️ この return はフックを全て呼び終えた後に置くこと（フックの呼び出し順を変えないため）。
	if (!isAuthResolved) {
		return (
			<View style={[styles.container, styles.loadingContainer]}>
				<LoadingIndicator size="large" />
				{/* #1272 auth 未確定の段階でパラメータが届いているかも観測対象（通常ビルドでは null） */}
				{e2eProbe}
			</View>
		);
	}

	return (
		<View style={styles.container}>
			{/* #1272 E2E ビルド限定のルートパラメータプローブ（通常ビルドでは null） */}
			{e2eProbe}
			<Tabs.Container
				ref={tabsContainerRef as never}
				headerHeight={headerHeight}
				renderHeader={renderHeader}
				renderTabBar={renderTabBar}
				initialTabName={requestedTab}
				onIndexChange={handleTabChange}
				pagerProps={{ scrollEnabled: true }}
				headerContainerStyle={{ shadowColor: "transparent" }}
				containerStyle={{ backgroundColor: "white" }}>
				{!isGuest ? (
					<Tabs.Tab name="reviews">
						<ReviewTab />
					</Tabs.Tab>
				) : null}
				{isOwnProfile ? (
					<Tabs.Tab name="saved-posts">
						<SavedPostsTab isOwnProfile={isOwnProfile} />
					</Tabs.Tab>
				) : null}
				{isOwnProfile ? (
					<Tabs.Tab name="saved-topics">
						<SavedTopicsTab isOwnProfile={isOwnProfile} />
					</Tabs.Tab>
				) : null}
				{isOwnProfile ? (
					<Tabs.Tab name="liked">
						<LikeTab />
					</Tabs.Tab>
				) : null}
				{/* #1071 【リリース差分】ウォレットのペイン自体も落とす。ここを残すと
				    pagerProps={{ scrollEnabled: true }} により、タブバーに項目が無くても
				    横スワイプでウォレットへ到達できてしまう。
				{isOwnProfile && !isGuest ? (
					<Tabs.Tab name="wallet-deposit">
						<DepositsTab
							data={mockBids}
							onItemPress={(item, index) => {
								lightImpact();
								logFrontendEvent({
									event_name: "deposit_item_selected",
									error_level: "log",
									payload: { depositId: item.id, index },
								});
							}}
						/>
					</Tabs.Tab>
				) : null}
				{isOwnProfile && !isGuest ? (
					<Tabs.Tab name="wallet-earning">
						<EarningsTab
							data={mockEarnings}
							onItemPress={(item, index) => {
								lightImpact();
								logFrontendEvent({
									event_name: "earning_item_selected",
									error_level: "log",
									payload: { earningId: item.id, index },
								});
							}}
						/>
					</Tabs.Tab>
				) : null}
				*/}
			</Tabs.Container>

			{profile && (
				<ProfileEditModal>{({ close }) => <ProfileEditForm close={close} onCancel={close} />}</ProfileEditModal>
			)}

			<LoginModal>{({ close }) => <LoginbackModal onClose={close} />}</LoginModal>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	loadingContainer: {
		backgroundColor: "white",
		justifyContent: "center",
		alignItems: "center",
	},
});
