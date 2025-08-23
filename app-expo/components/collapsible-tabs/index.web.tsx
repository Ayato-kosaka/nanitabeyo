/**
 * Web implementation using react-native-tab-view
 * Provides compatibility adapter that mimics react-native-collapsible-tab-view API
 */
import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  createContext,
  useContext,
} from 'react';
import {
  View,
  ScrollView,
  FlatList,
  FlatListProps,
  ViewStyle,
  StyleProp,
} from 'react-native';
import type { TabBarProps } from 'react-native-collapsible-tab-view';
import type { TabName } from 'react-native-collapsible-tab-view/lib/typescript/src/types';
import { TabView } from 'react-native-tab-view';

// -----------------------------------------------------------------------------
// Types and context

interface TabRoute {
  key: string;
  title?: string;
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

interface TabsFlatListProps<T> extends Omit<FlatListProps<T>, 'data'> {
  data: T[];
  scrollEventThrottle?: number;
}

interface SceneContextValue {
  onScroll: (e: any) => void;
  headerHeight: number;
}

const SceneContext = createContext<SceneContextValue | null>(null);

// -----------------------------------------------------------------------------
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
  const routes = useMemo<TabRoute[]>(() => {
    const tabs: TabRoute[] = [];
    React.Children.forEach(children, (child) => {
      if (
        React.isValidElement(child) &&
        child.props &&
        typeof child.props === 'object' &&
        'name' in child.props
      ) {
        tabs.push({ key: child.props.name as string, title: child.props.name });
      }
    });
    return tabs;
  }, [children]);

  // Set initial index based on initialTabName
  useMemo(() => {
    if (initialTabName) {
      const found = routes.findIndex((r) => r.key === initialTabName);
      if (found >= 0) setIndex(found);
    }
  }, [initialTabName, routes]);

  const headerOffsetRef = useRef(0);
  const offsetsRef = useRef<Record<string, number>>({});
  const [tabBarHeight, setTabBarHeight] = useState(0);
  const [, setTick] = useState(0); // force update

  const onScrollFor = useCallback(
    (key: string) => (e: any) => {
      const y = e.nativeEvent.contentOffset?.y ?? 0;
      offsetsRef.current[key] = y;
      headerOffsetRef.current = Math.min(Math.max(y, 0), headerHeight);
      setTick((t) => t + 1);
    },
    [headerHeight],
  );

  const handleIndexChange = useCallback(
    (i: number) => {
      setIndex(i);
      onIndexChange?.(i);
      const key = routes[i]?.key;
      headerOffsetRef.current = Math.min(
        offsetsRef.current[key] ?? 0,
        headerHeight,
      );
      setTick((t) => t + 1);
    },
    [onIndexChange, routes, headerHeight],
  );

  const renderScene = useCallback(
    ({ route }: { route: TabRoute }) => {
      const child = React.Children.toArray(children).find(
        (c) =>
          React.isValidElement(c) &&
          c.props &&
          typeof c.props === 'object' &&
          'name' in c.props &&
          c.props.name === route.key,
      );

      if (!React.isValidElement(child)) return null;

      return (
        <SceneContext.Provider
          value={{
            onScroll: onScrollFor(route.key),
            headerHeight: headerHeight + tabBarHeight,
          }}
        >
          {child}
        </SceneContext.Provider>
      );
    },
    [children, headerHeight, tabBarHeight, onScrollFor],
  );

  const tabNames = routes.map((r) => r.key);

  const tabBar = renderTabBar
    ? renderTabBar({
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
      })
    : null;

  const headerTranslateY = -Math.min(headerOffsetRef.current, headerHeight);

  return (
    <View style={[{ flex: 1 }, style]}>
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          transform: [{ translateY: headerTranslateY }],
        }}
      >
        {renderHeader?.()}
        {tabBar && (
          <View onLayout={(e) => setTabBarHeight(e.nativeEvent.layout.height)}>
            {tabBar}
          </View>
        )}
      </View>
      <TabView
        navigationState={{ index, routes }}
        renderScene={renderScene}
        onIndexChange={handleIndexChange}
        swipeEnabled={pagerProps?.scrollEnabled ?? swipeEnabled}
      />
    </View>
  );
}

// -----------------------------------------------------------------------------
// Tab component

function Tab({ name, children }: TabProps) {
  return <>{children}</>;
}

// -----------------------------------------------------------------------------
// FlatList component with scroll synchronisation

function TabsFlatList<T>({
  data,
  onScroll: externalOnScroll,
  contentContainerStyle,
  scrollEventThrottle = 16,
  ...props
}: TabsFlatListProps<T>) {
  const ctx = useContext(SceneContext);

  const handleScroll = useCallback(
    (e: any) => {
      ctx?.onScroll(e);
      externalOnScroll?.(e);
    },
    [ctx, externalOnScroll],
  );

  const paddingTop = ctx ? ctx.headerHeight : 0;

  return (
    <FlatList
      data={data}
      onScroll={handleScroll}
      scrollEventThrottle={scrollEventThrottle}
      contentContainerStyle={[{ paddingTop }, contentContainerStyle]}
      {...props}
    />
  );
}

// -----------------------------------------------------------------------------
// Exported API

export const Tabs = {
  Container,
  Tab,
  FlatList: TabsFlatList,
  ScrollView: ScrollView, // For compatibility, though FlatList is primary
};

