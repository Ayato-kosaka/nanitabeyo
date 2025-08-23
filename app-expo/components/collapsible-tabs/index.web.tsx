/**
 * Web implementation using react-native-tab-view
 * Provides compatibility adapter that mimics react-native-collapsible-tab-view API
 */
import React, { useState, useCallback, useMemo, useRef } from "react";
import {
	View,
	ScrollView,
	FlatList,
	Animated,
	LayoutChangeEvent,
	FlatListProps,
	ViewStyle,
	StyleProp,
} from "react-native";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import type { TabName } from "react-native-collapsible-tab-view/lib/typescript/src/types";
import { TabView, TabBar, Route, SceneRendererProps, NavigationState, TabDescriptor } from "react-native-tab-view";

// Types that match react-native-collapsible-tab-view API
interface TabRoute {
	key: string;
	title?: string;
}

interface TabViewState {
	index: number;
	routes: TabRoute[];
}

interface TabsContainerProps {
	children: React.ReactNode;
	headerHeight?: number;
	renderHeader?: () => React.ReactNode;
	renderTabBar?: (props: TabBarProps<TabName>) => React.ReactElement;
	initialTabName?: string;
	swipeEnabled?: boolean;
	style?: StyleProp<ViewStyle>;
	onIndexChange?: (index: number) => void;
	// Map collapsible-tab-view pagerProps.scrollEnabled -> TabView.swipeEnabled
	pagerProps?: { scrollEnabled?: boolean };
}

interface TabProps {
	name: string;
	children: React.ReactNode;
}

interface TabsFlatListProps<T> extends Omit<FlatListProps<T>, "data"> {
	data: T[];
	scrollEventThrottle?: number;
}

// Header collapse management
const useHeaderCollapse = (headerHeight: number = 0) => {
	const scrollY = useRef(new Animated.Value(0)).current;

	const headerTranslateY = scrollY.interpolate({
		inputRange: [0, headerHeight],
		outputRange: [0, -headerHeight],
		extrapolate: "clamp",
	});

	// Web-compatible scroll handler
	const onScroll = useCallback((event: any) => {
		const offsetY = event.nativeEvent.contentOffset.y;
		scrollY.setValue(offsetY);
	}, [scrollY]);

	return {
		headerTranslateY,
		onScroll,
		scrollY,
	};
};

// Container component
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
	const [index, setIndex] = useState(0);
	const [actualHeaderHeight, setActualHeaderHeight] = useState(headerHeight);
	const { headerTranslateY, onScroll } = useHeaderCollapse(actualHeaderHeight);

	// Extract routes from children
	const routes = useMemo(() => {
		const tabs: TabRoute[] = [];
		React.Children.forEach(children, (child) => {
			if (React.isValidElement(child) && child.props && typeof child.props === "object" && "name" in child.props) {
				tabs.push({
					key: child.props.name as string,
					title: child.props.name as string,
				});
			}
		});
		return tabs;
	}, [children]);

	// Find initial index
	const initialIndex = useMemo(() => {
		if (initialTabName) {
			const found = routes.findIndex((route) => route.key === initialTabName);
			return found >= 0 ? found : 0;
		}
		return 0;
	}, [routes, initialTabName]);

	React.useEffect(() => {
		if (index !== initialIndex) {
			setIndex(initialIndex);
		}
	}, [initialIndex]);

	const handleIndexChange = useCallback(
		(newIndex: number) => {
			setIndex(newIndex);
			onIndexChange?.(newIndex);
		},
		[onIndexChange],
	);

	const onHeaderLayout = useCallback((event: LayoutChangeEvent) => {
		const { height } = event.nativeEvent.layout;
		setActualHeaderHeight(height);
	}, []);

	// Render scene for each tab
	const renderScene = useCallback(
		({ route }: { route: TabRoute }) => {
			const tabChild = React.Children.toArray(children).find(
				(child) =>
					React.isValidElement(child) &&
					child.props &&
					typeof child.props === "object" &&
					"name" in child.props &&
					child.props.name === route.key,
			);

			if (!React.isValidElement(tabChild)) return null;

			// Clone the child and inject scroll handling
			return React.cloneElement(tabChild, {
				onScroll,
				contentContainerStyle: { paddingTop: actualHeaderHeight },
			} as any);
		},
		[children, onScroll, actualHeaderHeight],
	);

	const customRenderTabBar = useCallback(
		(
			props: SceneRendererProps & {
				navigationState: NavigationState<TabRoute>;
				options: Record<string, TabDescriptor<TabRoute>> | undefined;
			},
		): React.ReactNode => {
			if (renderTabBar) {
				// Adapt react-native-tab-view props to react-native-collapsible-tab-view TabBarProps
				const tabNames = props.navigationState.routes.map((r) => r.key as string);
				const currentIndex = props.navigationState.index;
				const adapterProps: TabBarProps<string> = {
					indexDecimal: { value: currentIndex } as any,
					focusedTab: { value: tabNames[currentIndex] as string } as any,
					tabNames,
					index: { value: currentIndex } as any,
					containerRef: { current: null } as any,
					onTabPress: (name: string) => {
						const idx = tabNames.indexOf(name);
						if (idx !== -1) {
							props.jumpTo(props.navigationState.routes[idx].key);
						}
					},
					tabProps: new Map() as any,
					width: undefined,
				};
				return renderTabBar(adapterProps);
			}
			return <TabBar {...props} />;
		},
		[renderTabBar],
	);

	return (
		<View style={[{ flex: 1 }, style]}>
			{/* Fixed Header */}
			{renderHeader && (
				<Animated.View
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						zIndex: 1000,
						transform: [{ translateY: headerTranslateY }],
					}}
					onLayout={onHeaderLayout}>
					{renderHeader()}
				</Animated.View>
			)}

			{/* Tab View */}
			<TabView
				navigationState={{ index, routes }}
				renderScene={renderScene}
				onIndexChange={handleIndexChange}
				renderTabBar={customRenderTabBar}
				swipeEnabled={pagerProps?.scrollEnabled ?? swipeEnabled}
				style={{ marginTop: actualHeaderHeight }}
			/>
		</View>
	);
}

// Tab component
function Tab({ name, children }: TabProps) {
	return <>{children}</>;
}

// FlatList component with scroll sync
function TabsFlatList<T>({ data, onScroll: externalOnScroll, contentContainerStyle, scrollEventThrottle = 16, ...props }: TabsFlatListProps<T>) {
	const handleScroll = useCallback(
		(event: any) => {
			// Allow parent scroll handler (for header collapse)
			if (externalOnScroll) {
				externalOnScroll(event);
			}
		},
		[externalOnScroll],
	);

	return (
		<FlatList
			data={data}
			onScroll={handleScroll}
			scrollEventThrottle={scrollEventThrottle}
			contentContainerStyle={contentContainerStyle}
			{...props}
		/>
	);
}

// Export the API that matches react-native-collapsible-tab-view
export const Tabs = {
	Container,
	Tab,
	FlatList: TabsFlatList,
	ScrollView: ScrollView, // For compatibility, though we'll primarily use FlatList
};
