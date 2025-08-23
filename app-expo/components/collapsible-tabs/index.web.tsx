/**
 * Web implementation of a lightweight collapsible tab view.
 *
 * This adapter mirrors the minimal API surface of
 * `react-native-collapsible-tab-view` used in the app.  The previous
 * implementation relied on an `Animated.Value` without synchronising the
 * scroll positions of each tab which resulted in several issues on the web:
 *
 * - Wheel / trackpad events over the header were swallowed so the page did
 *   not scroll.
 * - Scrolling a tab did not collapse the header because the scroll offset was
 *   not wired correctly.
 * - Switching tabs reset the collapsed state.
 *
 * This file reimplements the adapter with proper scroll propagation and
 * header offset bookkeeping for each tab.
 */

import React, { useCallback, useContext, useMemo, useRef, useState } from "react";
import { FlatList, FlatListProps, ScrollView, View, ViewStyle, StyleProp, LayoutChangeEvent } from "react-native";
import { TabView } from "react-native-tab-view";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import type { TabName } from "react-native-collapsible-tab-view/lib/typescript/src/types";

interface TabRoute {
	key: string;
	title?: string;
}

interface TabsContainerProps {
	children: React.ReactNode;
	headerHeight?: number; // height of the collapsible header (without tab bar)
	renderHeader?: () => React.ReactNode;
	renderTabBar?: (props: TabBarProps<TabName>) => React.ReactElement;
	initialTabName?: string;
	swipeEnabled?: boolean;
	style?: StyleProp<ViewStyle>;
	onIndexChange?: (index: number) => void;
	pagerProps?: { scrollEnabled?: boolean };
}

interface TabProps {
	name: string;
	children: React.ReactNode;
}

interface TabsFlatListProps<T> extends Omit<FlatListProps<T>, "data"> {
	data: T[];
}

/**
 * Context used to inject padding and onScroll handler into scenes.
 */
interface SceneContextValue {
	onScroll?: (e: any) => void;
	paddingTop: number;
}

const SceneContext = React.createContext<SceneContextValue>({
	paddingTop: 0,
});

/**
 * Helper to compose two event handlers.
 */
function composeEvents<E>(a?: (e: E) => void, b?: (e: E) => void) {
	return (e: E) => {
		a?.(e);
		b?.(e);
	};
}

/**
 * Container which synchronises header collapse across tabs.
 */
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
	// Extract routes from children
	const routes = useMemo(() => {
		const tabs: TabRoute[] = [];
		React.Children.forEach(children, (child) => {
			if (React.isValidElement(child) && child.props && typeof child.props === "object" && "name" in child.props) {
				tabs.push({ key: child.props.name as string, title: child.props.name });
			}
		});
		return tabs;
	}, [children]);

	// active index state
	const [index, setIndex] = useState(() => {
		if (initialTabName) {
			const found = routes.findIndex((r) => r.key === initialTabName);
			return found >= 0 ? found : 0;
		}
		return 0;
	});

	// Stores latest scroll offset per route
	const offsetsRef = useRef<Record<string, number>>({});
	const headerOffsetRef = useRef(0);

	// tick state to force re-render for header transform changes
	const [, setTick] = useState(0);

	// Total height of header + tab bar, measured at runtime
	const [containerHeight, setContainerHeight] = useState(headerHeight);

	const onContainerLayout = useCallback((e: LayoutChangeEvent) => {
		const { height } = e.nativeEvent.layout;
		setContainerHeight(height);
	}, []);

	// Generate onScroll handler for a specific route
	const onScrollFor = useCallback(
		(key: string) => (e: any) => {
			const y = e.nativeEvent.contentOffset?.y ?? 0;
			offsetsRef.current[key] = y;
			headerOffsetRef.current = Math.min(Math.max(y, 0), headerHeight);
			// Trigger update so header transform reflects new offset
			setTick((t) => t + 1);
		},
		[headerHeight],
	);

	const headerTranslateStyle = {
		transform: [{ translateY: -Math.min(headerOffsetRef.current, headerHeight) }],
	} as const;

	const handleIndexChange = useCallback(
		(newIndex: number) => {
			setIndex(newIndex);
			onIndexChange?.(newIndex);
			const k = routes[newIndex]?.key;
			headerOffsetRef.current = Math.min(offsetsRef.current[k] ?? 0, headerHeight);
			setTick((t) => t + 1);
		},
		[headerHeight, onIndexChange, routes],
	);

	// Render a scene for each tab
	const renderScene = useCallback(
		({ route }: { route: TabRoute }) => {
			const tabChild = React.Children.toArray(children).find(
				(child) =>
					React.isValidElement(child) &&
					child.props &&
					typeof child.props === "object" &&
					"name" in child.props &&
					child.props.name === route.key,
			) as React.ReactElement | undefined;

			if (!tabChild) return null;

			return (
				<SceneContext.Provider value={{ onScroll: onScrollFor(route.key), paddingTop: containerHeight }}>
					{tabChild}
				</SceneContext.Provider>
			);
		},
		[children, containerHeight, onScrollFor],
	);

	// Tab bar rendered under the header
	const renderTabBarNode = useCallback(() => {
		if (!renderTabBar) return null;
		const tabNames = routes.map((r) => r.key);
		const adapterProps: TabBarProps<string> = {
			indexDecimal: { value: index } as any,
			focusedTab: { value: tabNames[index] } as any,
			tabNames,
			index: { value: index } as any,
			containerRef: { current: null } as any,
			onTabPress: (name: string) => {
				const i = tabNames.indexOf(name);
				if (i !== -1) handleIndexChange(i);
			},
			tabProps: new Map() as any,
			width: undefined,
		};
		return renderTabBar(adapterProps);
	}, [handleIndexChange, index, renderTabBar, routes]);

	return (
		<View style={[{ flex: 1 }, style]}>
			{renderHeader && (
				<View
					pointerEvents="box-none"
					onLayout={onContainerLayout}
					style={[{ position: "absolute", top: 0, left: 0, right: 0 }, headerTranslateStyle]}>
					{renderHeader()}
					{renderTabBarNode()}
				</View>
			)}
			<TabView
				navigationState={{ index, routes }}
				renderScene={renderScene}
				onIndexChange={handleIndexChange}
				renderTabBar={() => null}
				swipeEnabled={pagerProps?.scrollEnabled ?? swipeEnabled}
			/>
		</View>
	);
}

function Tab({ name, children }: TabProps) {
	return <>{children}</>;
}

function TabsFlatList<T>({ data, onScroll, contentContainerStyle, ...props }: TabsFlatListProps<T>) {
	const ctx = useContext(SceneContext);
	return (
		<FlatList
			data={data}
			onScroll={composeEvents(ctx.onScroll, onScroll)}
			scrollEventThrottle={16}
			contentContainerStyle={[{ paddingTop: ctx.paddingTop }, contentContainerStyle]}
			{...props}
		/>
	);
}

export const Tabs = {
	Container,
	Tab,
	FlatList: TabsFlatList,
	ScrollView,
};
