import React, { useMemo, useState, useRef, useEffect } from 'react';
import { View, Animated, FlatList as RNFlatList, ViewStyle } from 'react-native';
import { TabView, SceneMap, TabBar } from 'react-native-tab-view';
import type { FlatListProps as RNFlatListProps } from 'react-native';
import type { NavigationState as RNTabNavigationState, SceneRendererProps } from 'react-native-tab-view';

interface Route {
  key: string;
  title?: string;
}

interface CustomNavigationState {
  index: number;
  routes: Route[];
}

interface Scene<T = any> {
  route: Route;
  jumpTo: (key: string) => void;
}

interface ContainerProps {
  headerHeight?: number;
  renderHeader?: () => React.ReactNode;
  renderTabBar?: React.ComponentType<any>;
  children?: React.ReactNode;
}

interface TabProps {
  name: string;
  label?: string;
  children?: React.ReactNode;
}

interface CustomFlatListProps<T> extends Omit<RNFlatListProps<T>, 'scrollEnabled'> {
  data: T[];
}

// Global state for header collapse
let globalHeaderOffset = new Animated.Value(0);
let globalHeaderHeight = 200; // default

const Container: React.FC<ContainerProps> = ({ 
  headerHeight = 200, 
  renderHeader, 
  renderTabBar,
  children 
}) => {
  const [navigationState, setNavigationState] = useState<CustomNavigationState>({
    index: 0,
    routes: []
  });

  // Update global header height
  useEffect(() => {
    globalHeaderHeight = headerHeight;
  }, [headerHeight]);

  // Extract routes from children
  useEffect(() => {
    if (children) {
      const childArray = React.Children.toArray(children);
      const routes = childArray.map((child: any, index) => ({
        key: child.props.name || `tab-${index}`,
        title: child.props.label || child.props.name || `Tab ${index + 1}`
      }));
      
      setNavigationState(prev => ({
        ...prev,
        routes
      }));
    }
  }, [children]);

  const scenes = useMemo(() => {
    const sceneMap: { [key: string]: React.ComponentType<any> } = {};
    
    if (children) {
      React.Children.forEach(children, (child: any) => {
        const key = child.props.name || 'default';
        sceneMap[key] = () => child.props.children || null;
      });
    }
    
    return SceneMap(sceneMap);
  }, [children]);

  const renderTabBarComponent = (props: any) => {
    if (renderTabBar) {
      const TabBarComponent = renderTabBar;
      return <TabBarComponent {...props} />;
    }
    
    return (
      <TabBar
        {...props}
        indicatorStyle={{ backgroundColor: '#5EA2FF' }}
        style={{ backgroundColor: 'white' }}
        labelStyle={{ color: '#333' }}
        activeColor="#5EA2FF"
        inactiveColor="#666"
      />
    );
  };

  const headerOffsetY = globalHeaderOffset.interpolate({
    inputRange: [0, headerHeight],
    outputRange: [0, -headerHeight],
    extrapolate: 'clamp',
  });

  return (
    <View style={{ flex: 1 }}>
      {/* Fixed Header */}
      <Animated.View 
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1,
          transform: [{ translateY: headerOffsetY }],
        }}
      >
        {renderHeader && renderHeader()}
      </Animated.View>

      {/* Tab View with top padding for header */}
      <View style={{ flex: 1, paddingTop: headerHeight }}>
        <TabView
          navigationState={navigationState}
          renderScene={scenes}
          renderTabBar={renderTabBarComponent}
          onIndexChange={(index) => setNavigationState(prev => ({ ...prev, index }))}
          swipeEnabled={true}
        />
      </View>
    </View>
  );
};

const Tab: React.FC<TabProps> = ({ children }) => {
  return <>{children}</>;
};

function CollapsibleFlatList<T>(props: CustomFlatListProps<T>) {
  const scrollY = useRef(new Animated.Value(0)).current;

  const onScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    { 
      useNativeDriver: true,
      listener: (event: any) => {
        // Update global header offset based on scroll position
        globalHeaderOffset.setValue(event.nativeEvent.contentOffset.y);
      }
    }
  );

  return (
    <RNFlatList
      {...props}
      onScroll={onScroll}
      scrollEventThrottle={16}
      contentContainerStyle={[
        props.contentContainerStyle,
        { paddingTop: 0 } // Remove any top padding since header is handled separately
      ]}
    />
  );
}

export const Tabs = {
  Container,
  Tab,
  FlatList: CollapsibleFlatList,
};