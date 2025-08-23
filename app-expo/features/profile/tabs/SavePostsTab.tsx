import React, { useCallback, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SavePostTab } from './save/SavePostTab';
import i18n from '@/lib/i18n';
import { useAPICall } from '@/hooks/useAPICall';
import { useCursorPagination } from '@/features/profile/hooks/useCursorPagination';
import { useHaptics } from '@/hooks/useHaptics';
import { useLogger } from '@/hooks/useLogger';
import { useDishMediaEntriesStore } from '@/stores/useDishMediaEntriesStore';
import { useLocale } from '@/hooks/useLocale';
import { router } from 'expo-router';
import type { QueryMeSavedDishMediaDto } from '@shared/api/v1/dto';
import type { QueryMeSavedDishMediaResponse, DishMediaEntry } from '@shared/api/v1/res';

interface Props {
  isOwnProfile: boolean;
}

export function SavePostsTab({ isOwnProfile }: Props) {
  if (!isOwnProfile) {
    return (
      <View style={styles.privateContainer}>
        <View style={styles.privateCard}>
          <Text style={styles.privateText}>{i18n.t('Profile.privateContent')}</Text>
        </View>
      </View>
    );
  }

  const { callBackend } = useAPICall();

  const posts = useCursorPagination<QueryMeSavedDishMediaDto, DishMediaEntry>(
    useCallback(
      async ({ cursor }) => {
        const response = await callBackend<QueryMeSavedDishMediaDto, QueryMeSavedDishMediaResponse>(
          'v1/users/me/saved-dish-media',
          { method: 'GET', requestPayload: cursor ? { cursor } : {} }
        );
        return { data: response.data || [], nextCursor: response.nextCursor };
      },
      [callBackend]
    )
  );

  useEffect(() => {
    posts.loadInitial();
  }, [posts.loadInitial]);

  const { lightImpact } = useHaptics();
  const { logFrontendEvent } = useLogger();
  const { setDishePromises } = useDishMediaEntriesStore();
  const locale = useLocale();

  const handlePostPress = useCallback(
    (item: DishMediaEntry, index: number) => {
      lightImpact();
      setDishePromises('saved', Promise.resolve(posts.items));
      router.push({
        pathname: '/[locale]/(tabs)/profile/food',
        params: { locale, startIndex: index, tabName: 'saved' },
      });
      logFrontendEvent({
        event_name: 'dish_media_entry_selected',
        error_level: 'log',
        payload: { item, tabName: 'saved' },
      });
    },
    [lightImpact, setDishePromises, posts.items, locale, logFrontendEvent]
  );

  const postsError = posts.error
    ? posts.error instanceof Error
      ? posts.error.message
      : String(posts.error)
    : null;

  return (
    <SavePostTab
      data={posts.items}
      isLoading={posts.isLoadingInitial}
      isLoadingMore={posts.isLoadingMore}
      refreshing={posts.isLoadingInitial}
      onRefresh={posts.refresh}
      onEndReached={posts.loadMore}
      onItemPress={handlePostPress}
      error={postsError}
      onRetry={posts.refresh}
    />
  );
}

const styles = StyleSheet.create({
  privateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  privateCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  privateText: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
});
