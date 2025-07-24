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
import {
  ArrowLeft,
  Eye,
  ThumbsDown,
  X,
} from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Carousel from 'react-native-reanimated-carousel';
import { FoodCard, SearchParams } from '@/types/search';
import { useCardSearch } from '@/hooks/useCardSearch';
import { useSnackbar } from '@/contexts/SnackbarProvider';

const { width, height } = Dimensions.get('window');
const CARD_WIDTH = width - 48;
const CARD_HEIGHT = height * 0.7;

export default function CardsScreen() {
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
          showSnackbar('カードの取得に失敗しました');
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
      showSnackbar('カードを非表示にしました');
    }
  };

  const handleViewDetails = (card: FoodCard) => {
    router.push({
      pathname: '/feed',
      params: {
        googlePlaceSearchText: card.googlePlaceSearchText,
        returnTo: 'cards',
      },
    });
  };

  const handleBack = () => {
    router.back();
  };

  const visibleCards = cards.filter(card => !card.isHidden);

  const renderCard = ({ item }: { item: FoodCard }) => (
    <View style={styles.card}>
      <View style={styles.cardImageContainer}>
        <Image source={{ uri: item.mediaUrl }} style={styles.cardImage} />
        <View style={styles.cardOverlay}>
          <TouchableOpacity
            style={styles.hideButton}
            onPress={() => handleHideCard(item.id)}
          >
            <ThumbsDown size={20} color="#FFF" />
            <Text style={styles.hideButtonText}>非表示</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.cardContent}>
        <Text style={styles.cardKeyword}>{item.keyword}</Text>
        <Text style={styles.cardReason} numberOfLines={2}>
          {item.reason}
        </Text>
        
        <TouchableOpacity
          style={styles.detailsButton}
          onPress={() => handleViewDetails(item)}
        >
          <Eye size={20} color="#1976D2" />
          <Text style={styles.detailsButtonText}>詳細を見る</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1976D2" />
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
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>おすすめ料理</Text>
        <View style={styles.headerRight}>
          <Text style={styles.cardCounter}>
            {currentIndex + 1} / {visibleCards.length}
          </Text>
        </View>
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
          <Text style={styles.emptyText}>表示できるカードがありません</Text>
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
              <Text style={styles.modalTitle}>カードを非表示にする</Text>
              <TouchableOpacity onPress={() => setShowHideModal(false)}>
                <X size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDescription}>
              このカードを非表示にする理由を教えてください（任意）
            </Text>

            <TextInput
              style={styles.reasonInput}
              placeholder="理由を入力してください..."
              value={hideReason}
              onChangeText={setHideReason}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
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
    backgroundColor: '#F5F5F5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#F5F5F5',
  },
  errorText: {
    fontSize: 16,
    color: '#F44336',
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#1976D2',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 16,
    color: '#FFF',
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  cardCounter: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  carouselContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  carousel: {
    width: width,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: '#FFF',
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  cardImageContainer: {
    flex: 1,
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  cardOverlay: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  hideButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  hideButtonText: {
    fontSize: 12,
    color: '#FFF',
    marginLeft: 4,
    fontWeight: '500',
  },
  cardContent: {
    padding: 24,
  },
  cardKeyword: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  cardReason: {
    fontSize: 16,
    color: '#666',
    lineHeight: 24,
    marginBottom: 20,
  },
  detailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E3F2FD',
    paddingVertical: 14,
    borderRadius: 12,
  },
  detailsButtonText: {
    fontSize: 16,
    color: '#1976D2',
    fontWeight: '600',
    marginLeft: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 18,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 24,
    width: width - 48,
    maxWidth: 400,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  modalDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    lineHeight: 20,
  },
  reasonInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: '#333',
    backgroundColor: '#FAFAFA',
    minHeight: 80,
    marginBottom: 24,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  confirmButton: {
    flex: 1,
    backgroundColor: '#F44336',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmButtonText: {
    fontSize: 16,
    color: '#FFF',
    fontWeight: '600',
  },
});