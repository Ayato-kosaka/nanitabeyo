import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  ScrollView,
  FlatList,
  FlatListProps,
  ViewStyle,
  StyleProp,
} from "react-native";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import type { TabName } from "react-native-collapsible-tab-view/lib/typescript/src/types";
import { TabView } from "react-native-tab-view";

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

type SceneContextType = {
  onScroll?: (e: any) => void;
  topInset: number;
};

const SceneContext = React.createContext<SceneContextType>({
  topInset: 0,
});

const composeEvents =
  <T,>(a?: (e: T) => void, b?: (e: T) => void) =>
  (e: T) => {
    a?.(e);
    b?.(e);
  };

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
  const [tabBarHeight, setTabBarHeight] = useState(0);
  const headerOffsetRef = useRef(0);
  const offsetsRef = useRef<Record<string, number>>({});
  const [, forceUpdate] = useState(0);

  const routes = useMemo<TabRoute[]>(() => {
    const tabs: TabRoute[] = [];
    React.Children.forEach(children, (child) => {
      if (
        React.isValidElement(child) &&
        child.props &&
        typeof child.props === "object" &&
        "name" in child.props
      ) {
        const name = child.props.name as string;
        tabs.push({ key: name, title: name });
      }
    });
    return tabs;
  }, [children]);

  const initialIndex = useMemo(() => {
    if (initialTabName) {
      const found = routes.findIndex((r) => r.key === initialTabName);
      return found >= 0 ? found : 0;
    }
    return 0;
  }, [routes, initialTabName]);

  useEffect(() => {
    if (index !== initialIndex) {
      setIndex(initialIndex);
    }
  }, [initialIndex]);

  const updateHeaderOffset = useCallback(
    (y: number) => {
      const clamped = Math.min(Math.max(y, 0), headerHeight);
      headerOffsetRef.current = clamped;
      forceUpdate((t) => t + 1);
    },
    [headerHeight]
  );

  const onScrollFor = useCallback(
    (key: string) => (e: any) => {
      const y = e?.nativeEvent?.contentOffset?.y ?? 0;
      offsetsRef.current[key] = y;
      updateHeaderOffset(y);
    },
    [updateHeaderOffset]
  );

  const handleIndexChange = useCallback(
    (i: number) => {
      setIndex(i);
      const k = routes[i]?.key;
      if (k) {
        const saved = offsetsRef.current[k] ?? 0;
        updateHeaderOffset(saved);
      }
      onIndexChange?.(i);
    },
    [routes, onIndexChange, updateHeaderOffset]
  );

  const tabNames = routes.map((r) => r.key);

  const renderTabBarElement = useCallback(() => {
    if (!renderTabBar) return null;
    const currentIndex = index;
    const adapterProps: TabBarProps<string> = {
      indexDecimal: { value: currentIndex } as any,
      focusedTab: { value: tabNames[currentIndex] } as any,
      tabNames,
      index: { value: currentIndex } as any,
      containerRef: { current: null } as any,
      onTabPress: (name: string) => {
        const idx = tabNames.indexOf(name);
        if (idx !== -1) {
          handleIndexChange(idx);
        }
      },
      tabProps: new Map() as any,
      width: undefined,
    };
    return (
      <View onLayout={(e) => setTabBarHeight(e.nativeEvent.layout.height)}>
        {renderTabBar(adapterProps)}
      </View>
    );
  }, [renderTabBar, index, tabNames, handleIndexChange]);

  const headerTranslateY = -Math.min(headerOffsetRef.current, headerHeight);

  const renderScene = useCallback(
    ({ route }: { route: TabRoute }) => {
      const tabChild = React.Children.toArray(children).find(
        (child) =>
          React.isValidElement(child) &&
          child.props &&
          typeof child.props === "object" &&
          "name" in child.props &&
          child.props.name === route.key
      ) as React.ReactElement<any> | undefined;

      if (!tabChild) return null;

      return (
        <SceneContext.Provider
          value={{
            onScroll: onScrollFor(route.key),
            topInset: headerHeight + tabBarHeight,
          }}
        >
          {tabChild.props.children}
        </SceneContext.Provider>
      );
    },
    [children, onScrollFor, headerHeight, tabBarHeight]
  );

  return (
    <View style={[{ flex: 1 }, style]}>
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          transform: [{ translateY: headerTranslateY }],
        }}
      >
        {renderHeader?.()}
        {renderTabBarElement()}
      </View>
      <TabView
        navigationState={{ index, routes }}
        renderScene={renderScene}
        onIndexChange={handleIndexChange}
        swipeEnabled={pagerProps?.scrollEnabled ?? swipeEnabled}
        style={{ flex: 1 }}
      />
    </View>
  );
}

function Tab({ children }: TabProps) {
  return <>{children}</>;
}

function TabsFlatList<T>({
  data,
  onScroll,
  contentContainerStyle,
  scrollEventThrottle = 16,
  ...props
}: TabsFlatListProps<T>) {
  const { onScroll: ctxOnScroll, topInset } = useContext(SceneContext);

  return (
    <FlatList
      {...props}
      data={data}
      onScroll={composeEvents(ctxOnScroll, onScroll)}
      scrollEventThrottle={scrollEventThrottle}
      contentContainerStyle={[
        { paddingTop: topInset },
        contentContainerStyle as any,
      ]}
    />
  );
}

export const Tabs = {
  Container,
  Tab,
  FlatList: TabsFlatList,
  ScrollView,
};

