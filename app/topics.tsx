import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  SafeAreaView,
  Dimensions,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Eye, ThumbsDown, X } from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Carousel from 'react-native-reanimated-carousel';
import { TopicCard, SearchParams } from '@/types/search';
import { useCardSearch } from '@/hooks/useCardSearch';
import { useSnackbar } from '@/contexts/SnackbarProvider';

const { width, height } = Dimensions.get('window');
const CARD_WIDTH = width - 32;
const CARD_HEIGHT = height * 0.85;
import { ArrowLeft } from 'lucide-react-native';

export default function TopicsScreen() {
  const { searchParams } = useLocalSearchParams<{ searchParams: string }>();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showHideModal, setShowHideModal] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [hideReason, setHideReason] = useState('');
  const carouselRef = useRef<any>(null);

  const { cards, isLoading, error, searchCards, hideCard } = useCardSearch();
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    if (searchParams) {
      try {
        const params: SearchParams = JSON.parse(searchParams);
        searchCards(params).catch(() => {
          showSnackbar('おすすめの取得に失敗しました');
        });
      } catch (error) {
        showSnackbar('検索パラメータが無効です');
        router.back();
      }
    }
  }, [searchParams, searchCards, showSnackbar]);

  const handleHideCard = (cardId: string) => {
    setSelectedCardId(cardId);
    setShowHideModal(true);
  };

  const confirmHideCard = () => {
    if (selectedCardId) {
      hideCard(selectedCardId, hideReason);
      setShowHideModal(false);
      setHideReason('');
      setSelectedCardId(null);
      showSnackbar('おすすめを非表示にしました');
    }
  };

  const handleViewDetails = (card: TopicCard) => {
    router.push({
      pathname: '/(tabs)/search/feed',
      params: {
        googlePlaceSearchText: card.googlePlaceSearchText,
        returnTo: 'topics',
      },
    });
  };

  const handleBack = () => {
    router.back();
  };

  const visibleCards = cards.filter((card) => !card.isHidden);

  const renderCard = ({ item }: { item: TopicCard }) => (
    <View style={styles.card}>
      <Image source={{ uri: item.mediaUrl }} style={styles.cardImage} />

      {/* Content Overlay */}
      <View style={styles.cardOverlay}>
        {/* Hide Button */}
        <TouchableOpacity
          style={styles.hideButton}
          onPress={() => handleHideCard(item.id)}
        >
          <ThumbsDown size={18} color="#FFF" />
          <Text style={styles.hideButtonText}></Text>
        </TouchableOpacity>

        {/* Content */}
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>{item.topicTitle}</Text>
          <Text style={styles.cardDescription}>{item.reason}</Text>
          {/* <Text style={styles.cardSearchText}>
            📍 {item.googlePlaceSearchText}
          </Text> */}

          <TouchableOpacity
            style={styles.detailsButton}
            onPress={() => handleViewDetails(item)}
          >
            <Eye size={20} color="#FFF" />
            <Text style={styles.detailsButtonText}>探索する</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6750A4" />
        <Text style={styles.loadingText}>おすすめを探しています...</Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleBack}>
          <Text style={styles.retryButtonText}>戻る</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header with Back Button */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.progressText}>
          {currentIndex + 1} / {visibleCards.length}
        </Text>
      </View>

      {/* Cards Carousel */}
      {visibleCards.length > 0 ? (
        <View style={styles.carouselContainer}>
          <Carousel
            ref={carouselRef}
            width={CARD_WIDTH}
            height={CARD_HEIGHT}
            data={visibleCards}
            renderItem={renderCard}
            onSnapToItem={setCurrentIndex}
            mode="parallax"
            modeConfig={{
              parallaxScrollingScale: 0.9,
              parallaxScrollingOffset: 50,
            }}
            style={styles.carousel}
          />
        </View>
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>表示できるおすすめがありません</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleBack}>
            <Text style={styles.retryButtonText}>検索に戻る</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Hide Card Modal */}
      <Modal
        visible={showHideModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowHideModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>おすすめを非表示にする</Text>
              <TouchableOpacity onPress={() => setShowHideModal(false)}>
                <X size={24} color="#49454F" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDescription}>
              このおすすめを非表示にする理由を教えてください（任意）
            </Text>

            <TextInput
              style={styles.reasonInput}
              placeholder="理由を入力してください..."
              value={hideReason}
              onChangeText={setHideReason}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              placeholderTextColor="#79747E"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowHideModal(false)}
              >
                <Text style={styles.cancelButtonText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmButton}
                onPress={confirmHideCard}
              >
                <Text style={styles.confirmButtonText}>非表示にする</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  backButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFF',
  },
  headerSpacer: {
    width: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  loadingText: {
    fontSize: 16,
    color: '#FFF',
    marginTop: 16,
    fontWeight: '400',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#000',
  },
  errorText: {
    fontSize: 16,
    color: '#FF6B6B',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  retryButton: {
    backgroundColor: '#6750A4',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  retryButtonText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  progressText: {
    fontSize: 14,
    color: '#FFF',
    fontWeight: '500',
  },
  carouselContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
  },
  carousel: {
    width: width,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    backgroundColor: '#000',
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  cardOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    padding: 24,
    justifyContent: 'space-between',
  },
  hideButton: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    gap: 6,
  },
  hideButtonText: {
    fontSize: 14,
    color: '#FFF',
    fontWeight: '500',
  },
  cardContent: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  cardTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 12,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
    lineHeight: 36,
  },
  cardDescription: {
    fontSize: 16,
    color: '#FFFFFF',
    lineHeight: 24,
    marginBottom: 12,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  cardSearchText: {
    fontSize: 14,
    color: '#E0E0E0',
    marginBottom: 20,
    fontWeight: '500',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  detailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingVertical: 14,
    borderRadius: 24,
    gap: 8,
  },
  detailsButtonText: {
    fontSize: 16,
    color: '#000',
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 18,
    color: '#FFF',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 28,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    width: width - 48,
    maxWidth: 400,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '500',
    color: '#1C1B1F',
  },
  modalDescription: {
    fontSize: 14,
    color: '#49454F',
    marginBottom: 16,
    lineHeight: 20,
  },
  reasonInput: {
    borderWidth: 1,
    borderColor: '#79747E',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1C1B1F',
    backgroundColor: '#FFFFFF',
    minHeight: 80,
    marginBottom: 24,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#79747E',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 14,
    color: '#49454F',
    fontWeight: '500',
  },
  confirmButton: {
    flex: 1,
    backgroundColor: '#B3261E',
    paddingVertical: 12,
    borderRadius: 20,
    alignItems: 'center',
  },
  confirmButtonText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
  },
});
