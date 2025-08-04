// useTopicsData - manages topic search state and user interactions
import { useState, useEffect, useRef } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Topic, SearchParams } from '@/types/search';
import { useTopicSearch } from '@/features/topics/hooks/useTopicSearch';
import { useSnackbar } from '@/contexts/SnackbarProvider';
import { useSearchStore } from '@/stores/useSearchStore';

export type TopicsData = {
  visibleTopics: Topic[];
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  isLoading: boolean;
  error: string | null;
  handleBack: () => void;
  handleHideCard: (id: string) => void;
  handleViewDetails: (topic: Topic) => void;
  showHideModal: boolean;
  setShowHideModal: (show: boolean) => void;
  hideReason: string;
  setHideReason: (reason: string) => void;
  confirmHideCard: () => void;
  carouselRef: any;
};

export const useTopicsData = (): TopicsData => {
  const { searchParams } = useLocalSearchParams<{ searchParams: string }>();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showHideModal, setShowHideModal] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [hideReason, setHideReason] = useState('');
  const carouselRef = useRef<any>(null);
  const setDishes = useSearchStore((state) => state.setDishes);
  const { topics, isLoading, error, searchTopics, hideTopic } = useTopicSearch();
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    if (searchParams) {
      try {
        const params: SearchParams = JSON.parse(searchParams);
        searchTopics(params).catch(() => {
          showSnackbar('料理の取得に失敗しました');
        });
      } catch {
        showSnackbar('検索パラメータが無効です');
        router.back();
      }
    }
  }, [searchParams, searchTopics, showSnackbar]);

  const handleHideCard = (cardId: string) => {
    setSelectedCardId(cardId);
    setShowHideModal(true);
  };

  const confirmHideCard = () => {
    const selectedTopic = topics.find((topic) => topic.id === selectedCardId);
    if (selectedCardId && selectedTopic) {
      hideTopic(selectedCardId, hideReason);
      setShowHideModal(false);
      setHideReason('');
      setSelectedCardId(null);
      showSnackbar(`${selectedTopic.topicTitle}を非表示にしました`);
    }
  };

  const handleViewDetails = (topic: Topic) => {
    setDishes(topic.id, topic.feedItems);
    router.push({
      pathname: '/(tabs)/search/result',
      params: { topicId: topic.id },
    });
  };

  const handleBack = () => {
    router.back();
  };

  const visibleTopics = topics.filter((topic) => !topic.isHidden);

  return {
    visibleTopics,
    currentIndex,
    setCurrentIndex,
    isLoading,
    error,
    handleBack,
    handleHideCard,
    handleViewDetails,
    showHideModal,
    setShowHideModal,
    hideReason,
    setHideReason,
    confirmHideCard,
    carouselRef,
  };
};
