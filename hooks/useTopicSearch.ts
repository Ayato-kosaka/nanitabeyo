import { useState, useCallback } from 'react';
import { TopicCard, SearchParams } from '@/types/search';
import { mockTopicCards } from '@/data/searchMockData';

export const useTopicSearch = () => {
  const [topics, setTopics] = useState<TopicCard[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchTopics = useCallback(async (params: SearchParams): Promise<TopicCard[]> => {
    setIsLoading(true);
    setError(null);

    try {
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Mock API response based on search parameters
      const shuffledTopics = [...mockTopicCards]
        .sort(() => Math.random() - 0.5)
        .slice(0, 6)
        .map(topic => ({
          ...topic,
          id: `${topic.id}_${Date.now()}_${Math.random()}`,
          isHidden: false,
        }));

      setTopics(shuffledTopics);
      return shuffledTopics;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'おすすめ検索に失敗しました';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const hideTopic = useCallback((topicId: string, reason: string) => {
    setTopics(prevTopics =>
      prevTopics.map(topic =>
        topic.id === topicId ? { ...topic, isHidden: true } : topic
      )
    );

    // Log hide reason for analytics
    const hideReason = {
      topicId,
      reason: reason.replace(/[^\w\s]/gi, '*'), // Simple PII masking
      timestamp: new Date().toISOString(),
    };

    console.log('Topic hidden:', hideReason);
  }, []);

  const resetTopics = useCallback(() => {
    setTopics([]);
    setError(null);
  }, []);

  return {
    topics,
    isLoading,
    error,
    searchTopics,
    hideTopic,
    resetTopics,
  };
};