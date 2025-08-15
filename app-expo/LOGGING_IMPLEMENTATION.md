# Observability Logging Implementation Summary

This document outlines the comprehensive observability logging added to the app-expo directory for enhanced debugging, monitoring, and analytics capabilities.

## Overview

Added observability logging throughout the app-expo directory using the existing `useLogger` hook with `logFrontendEvent` function. The implementation follows the principles outlined in the issue requirements:

- Track **when, who, what, and how** operations succeed or fail
- Enable bug cause identification, user impact estimation, and performance degradation detection
- Use appropriate log levels: `error`, `warn`, `log`, `debug`
- Include relevant metadata while avoiding sensitive information

## Logging Events Implemented

### Screen Navigation & Lifecycle

- `screen_view` - Screen visits with metadata (home, search, profile, search_result)
- `locale_initialized` - App locale setup and validation
- `locale_validation_failed` - Invalid locale handling

### User Interactions & Content Engagement

- `dish_liked` / `dish_unliked` - Content engagement tracking
- `dish_saved` / `dish_unsaved` - Save/bookmark actions
- `comment_liked` / `comment_unliked` - Comment interaction
- `dish_menu_opened` / `dish_menu_option_selected` - Menu interactions
- `food_feed_swipe` - Content navigation patterns
- `food_feed_mounted` - Feed initialization

### Search & Location Services

- `location_search_started` / `location_search_success` / `location_search_failed` - Location autocomplete
- `location_selected` / `location_selection_failed` - Location picker actions
- `current_location_requested` / `current_location_success` / `current_location_failed` - GPS location
- `current_location_fetch_started` / `current_location_fetch_success` / `current_location_fetch_failed` - Location retrieval
- `search_started` / `search_navigation_success` / `search_failed` - Search execution

### Profile & Social Actions

- `user_followed` / `user_unfollowed` - Social interactions
- `profile_edit_started` / `profile_edit_saved` - Profile modifications
- `profile_shared` - Share actions
- `profile_tab_selected` - Tab navigation
- `profile_post_clicked` - Content discovery

### Navigation & Deep Links

- `restaurant_view_clicked` - Restaurant detail navigation
- `creator_profile_clicked` - User profile navigation
- `search_result_closed` / `search_result_exit` - Search result handling
- `search_result_navigation` - Result browsing patterns

### API & Performance Monitoring

- `api_call_started` / `api_call_success` / `api_call_error` - HTTP requests with timing
- `performance_timer_start` / `performance_timer_end` - Operation timing
- `performance_measure` / `performance_measure_async` - Synchronous/asynchronous operation measurement

## Files Modified

### Core Screens

- `app/[locale]/(tabs)/home/index.tsx` - Home screen view logging
- `app/[locale]/(tabs)/search/index.tsx` - Search interactions and location services
- `app/[locale]/(tabs)/profile/index.tsx` - Profile actions and social features
- `app/[locale]/(tabs)/search/result.tsx` - Search result navigation

### Components

- `components/FoodContentFeed.tsx` - Content feed interactions and swipe navigation
- `components/FoodContentScreen.tsx` - Content engagement (like, save, share, comments)

### Hooks & Services

- `hooks/useAPICall.ts` - Enhanced API logging with performance metrics
- `hooks/useLocationSearch.ts` - Location service error handling and success tracking
- `hooks/usePerformanceLogger.ts` - New performance measurement utilities
- `features/search/hooks/useSearchResult.ts` - Search result state and navigation

### Layout & Navigation

- `app/[locale]/_layout.tsx` - App lifecycle and locale initialization

## Performance Logger Utility

Created `usePerformanceLogger` hook providing:

- `start(name, metadata)` / `end(name, metadata)` - Manual timing
- `measure(name, fn, metadata)` - Automatic synchronous function timing
- `measureAsync(name, fn, metadata)` - Automatic asynchronous function timing

## Log Levels Used

- **`error`**: API failures, location service failures, validation errors
- **`warn`**: Locale validation issues, recoverable problems
- **`log`**: User actions, screen views, successful operations, state changes
- **`debug`**: Detailed flow information, search queries, navigation details

## Metadata Included

Typical metadata includes:

- Screen names and user flow context
- Performance timing (duration in milliseconds)
- User interaction details (previous/new state)
- Content identifiers (dish IDs, restaurant IDs, user IDs)
- Error details and request IDs for debugging
- Feature usage patterns (search filters, tab selections)

## Privacy & Security

- No sensitive personal information logged (emails, passwords, tokens)
- Content IDs used instead of full content
- Error messages sanitized
- Location data limited to success/failure states
- User IDs hashed/anonymized where possible

## Development Testing

- Expo development server starts successfully with logging code
- Metro bundler compiles without issues
- Console output shows structured log events in development mode
- Supabase integration preserves existing functionality

## Usage

The logging is automatically active in development mode with console output. In production, logs are sent to Supabase for analysis and monitoring. Log levels can be controlled via remote config.

Example usage in components:

```typescript
const { logFrontendEvent } = useLogger();

// Screen view
logFrontendEvent({
	event_name: "screen_view",
	error_level: "log",
	payload: { screen: "home", itemCount: items.length },
});

// User action
logFrontendEvent({
	event_name: "dish_liked",
	error_level: "log",
	payload: { dishId: item.id, restaurantId: restaurant.id },
});

// Error handling
logFrontendEvent({
	event_name: "api_call_error",
	error_level: "error",
	payload: { endpoint, status, requestId, error: String(error) },
});
```

This implementation provides comprehensive observability for debugging production issues, understanding user behavior, and monitoring app performance while maintaining user privacy and security standards.
