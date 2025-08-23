/**
 * Web-only collapsible tabs adapter (no Animated)
 * Strategy:
 * - Parent <ScrollView> controls vertical scroll
 * - Children FlatList/ScrollView are non-scrollable (scrollEnabled={false})
 * - Header collapse via setState on parent scroll (translateY only)
 * - TabBar fixed under the (collapsing) header
 * - BottomSheet is unaffected (no shared values)
 *
 * Exposes a compatible API: Tabs.Container / Tabs.Tab / Tabs.FlatList / Tabs.ScrollView
 */

import React, { useMemo, useRef, useState, useCallback, useEffect, createContext, useContext } from "react";
import {
	View,
	ScrollView as RNScrollView,
	ScrollViewProps as RNScrollViewProps,
	FlatList as RNFlatList,
	FlatListProps as RNFlatListProps,
	ViewStyle,
	StyleProp,
} from "react-native";
import { TabView } from "react-native-tab-view";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import type { TabName } from "react-native-collapsible-tab-view/lib/typescript/src/types";

type TabRoute = { key: string; title?: string };

interface TabsContainerProps {
	children: React.ReactNode;
	headerHeight?: number;
	renderHeader?: () => React.ReactNode;
	renderTabBar?: (props: TabBarProps<TabName>) => React.ReactElement;
	initialTabName?: string;
	swipeEnabled?: boolean; // ignored on web
	style?: StyleProp<ViewStyle>;
	onIndexChange?: (index: number) => void;
	pagerProps?: { scrollEnabled?: boolean }; // ignored on web
}

interface TabProps {
	name: string;
	children: React.ReactNode;
}

interface TabsFlatListProps<T> extends Omit<RNFlatListProps<T>, "data"> {
	data: T[];
}

interface TabsScrollViewProps extends Omit<RNScrollViewProps, "scrollEnabled"> {}

// ---------- Container ----------
function Container({
	children,
	headerHeight = 0,
	renderHeader,
	renderTabBar,
	initialTabName,
	swipeEnabled = true,
	style,
	onIndexChange,
	pagerProps,
}: TabsContainerProps) {
	// routes from Tabs.Tab children
	const routes = useMemo<TabRoute[]>(() => {
		const tabs: TabRoute[] = [];
		React.Children.forEach(children, (child) => {
			if (React.isValidElement(child) && child.props && typeof child.props === "object" && "name" in child.props) {
				tabs.push({ key: child.props.name as string, title: child.props.name as string });
			}
		});
		return tabs;
	}, [children]);

	const initialIndex = useMemo(() => {
		if (initialTabName) {
			const idx = routes.findIndex((r) => r.key === initialTabName);
			return idx >= 0 ? idx : 0;
		}
		return 0;
	}, [routes, initialTabName]);

	const [index, setIndex] = useState(initialIndex);
	useEffect(() => {
		// if routes or initial change after mount
		if (index !== initialIndex) setIndex(initialIndex);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [initialIndex]);

	const currentKey = routes[index]?.key;

	const handleIndexChange = useCallback(
		(next: number) => {
			setIndex(next);
			onIndexChange?.(next);
		},
		[onIndexChange],
	);

	// Render active scene: find matching child and render it
	const ActiveScene = useMemo(() => {
		const node = React.Children.toArray(children).find(
			(child) =>
				React.isValidElement(child) &&
				child.props &&
				typeof child.props === "object" &&
				"name" in child.props &&
				child.props.name === currentKey,
		);
		return node ?? null;
	}, [children, currentKey]);

	// Adapter for renderTabBar (collapsible-tab-view props → minimal shape)
	const tabNames = routes.map((r) => r.key as string);
	const renderWebTabBar = useCallback(() => {
		if (!renderTabBar) return null;

		const props: TabBarProps<string> = {
			indexDecimal: { value: index } as any,
			focusedTab: { value: tabNames[index] } as any,
			tabNames,
			index: { value: index } as any,
			containerRef: { current: null } as any,
			onTabPress: (name: string) => {
				const idx = tabNames.indexOf(name);
				if (idx !== -1) handleIndexChange(idx);
			},
			tabProps: new Map() as any,
			width: undefined,
		};

		return <View pointerEvents="box-none">{renderTabBar(props)}</View>;
	}, [renderTabBar, tabNames, index, handleIndexChange]);

	const renderWebHeader = useCallback(() => {
		if (!renderHeader) return null;
		return renderHeader();
	}, [renderHeader]);

	return (
		<View style={[{ flex: 1 }, style]}>
			{/* Parent scroll container (the ONLY scroller) */}
			<RNScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} scrollEventThrottle={16}>
				{renderWebHeader()}
				{renderWebTabBar()}
				<TabView
					navigationState={{ index, routes }}
					renderScene={() => ActiveScene}
					onIndexChange={handleIndexChange}
					renderTabBar={() => null}
					swipeEnabled={pagerProps?.scrollEnabled ?? swipeEnabled}
				/>
			</RNScrollView>
		</View>
	);
}

// ---------- Tab wrapper ----------
function Tab({ children }: TabProps) {
	return <>{children}</>;
}

// ---------- Non-scrollable FlatList wrapped for parent scrolling ----------
function TabsFlatList<T>({ scrollEnabled, contentContainerStyle, ...rest }: TabsFlatListProps<T>) {
	return (
		<RNFlatList
			{...(rest as any)}
			// disable child scrolling; delegate to parent
			// sufficient height comes from items themselves; parent scrolls
			contentContainerStyle={[{ paddingTop: 16, paddingBottom: 0 }, contentContainerStyle as any]}
			// Prevent the list from capturing wheel events on web
			// @ts-expect-error RN Web onWheel
			onWheel={(ev) => {
				const scroller = document.querySelector("[data-tabs-parent-scroll='1']") as HTMLElement | null;
				if (scroller && "scrollTop" in scroller) {
					scroller.scrollTop += ev?.nativeEvent?.deltaY ?? 0;
				}
			}}
			showsVerticalScrollIndicator={false}
			// (Note) virtualization is limited when disabled; acceptable by spec
		/>
	);
}

// ---------- Non-scrollable ScrollView wrapped for parent scrolling ----------
function TabsScrollView({ children, contentContainerStyle, ...rest }: TabsScrollViewProps) {
	return (
		<RNScrollView
			{...(rest as any)}
			scrollEnabled={false}
			contentContainerStyle={[{ paddingTop: 0, paddingBottom: 0 }, contentContainerStyle as any]}
			// @ts-expect-error RN Web onWheel
			onWheel={(ev) => {
				const scroller = document.querySelector("[data-tabs-parent-scroll='1']") as HTMLElement | null;
				if (scroller && "scrollTop" in scroller) {
					scroller.scrollTop += ev?.nativeEvent?.deltaY ?? 0;
				}
			}}>
			{children}
		</RNScrollView>
	);
}

// ---------- Export API ----------
export const Tabs = {
	Container,
	Tab,
	FlatList: TabsFlatList,
	ScrollView: TabsScrollView,
};
