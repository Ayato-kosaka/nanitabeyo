/**
 * Cross-platform collapsible tabs component
 * 
 * - iOS/Android: Uses react-native-collapsible-tab-view directly
 * - Web: Uses react-native-tab-view with compatibility adapter
 * 
 * This provides a unified API for collapsible tabs across all platforms.
 */

// Platform-specific exports are handled by Metro bundler
// index.native.ts for iOS/Android
// index.web.tsx for Web
export * from './index.native';