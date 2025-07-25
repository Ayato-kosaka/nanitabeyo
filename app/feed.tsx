import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { ArrowLeft, RotateCcw, Search } from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import FoodContentFeed from '@/components/FoodContentFeed';
import { FoodItem } from '@/types';
import { mockFeedItems } from '@/data/searchMockData';

export default function FeedScreen() {
  const { googlePlaceSearchText, returnTo } = useLocalSearchParams<{
    googlePlaceSearchText: string;
    returnTo?: string;
  }>();

  const [feedItems, setFeedItems] = useState<FoodItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showCompletionModal, setShowCompletionModal] = useState(false);

  useEffect(() => {
    // Load feed items based on search text
    loadFeedItems();
  }, [googlePlaceSearchText]);

  const loadFeedItems = async () => {
    try {
      // Simulate API call with search text
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Mock: shuffle and take 5 items
      const shuffled = [...mockFeedItems]
        .sort(() => Math.random() - 0.5)
        .slice(0, 5)
        .map((item, index) => ({
          ...item,
          id: `${item.id}_${Date.now()}_${index}`,
        }));

      setFeedItems(shuffled);
    } catch (error) {
      console.error('Failed to load feed items:', error);
    }
  };

  const handleIndexChange = (index: number) => {
    setCurrentIndex(index);

    // Show completion modal when reaching the last item
    if (index >= feedItems.length - 1) {
      setTimeout(() => {
        setShowCompletionModal(true);
      }, 1000);
    }
  };

  const handleBack = () => {
    if (returnTo === 'topics' || returnTo === 'search') {
      router.back();
    } else {
      router.push('/(tabs)/(home)');
    }
  };

  const handleSearchOther = () => {
    setShowCompletionModal(false);
    router.push('/(tabs)/search');
  };

  const handleReturnToCards = () => {
    setShowCompletionModal(false);
    if (returnTo === 'topics') {
      router.back();
    } else {
      router.push('/(tabs)/search/topics');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header with Back Button */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>料理を見る</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Feed Content */}
      <FoodContentFeed items={feedItems} onIndexChange={handleIndexChange} />

      {/* Completion Modal */}
      <Modal
        visible={showCompletionModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowCompletionModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.completionModal}>
            <Text style={styles.completionTitle}>すべて見終わりました！</Text>
            <Text style={styles.completionMessage}>別の料理を探しますか？</Text>

            <View style={styles.completionActions}>
              <TouchableOpacity
                style={styles.returnButton}
                onPress={handleReturnToCards}
              >
                <RotateCcw size={20} color="#666" />
                <Text style={styles.returnButtonText}>おすすめに戻る</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.searchOtherButton}
                onPress={handleSearchOther}
              >
                <Search size={20} color="#FFF" />
                <Text style={styles.searchOtherButtonText}>他の料理を探す</Text>
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    zIndex: 10,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  completionModal: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 32,
    width: '80%',
    maxWidth: 320,
    alignItems: 'center',
  },
  completionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  completionMessage: {
    fontSize: 16,
    color: '#666',
    marginBottom: 32,
    textAlign: 'center',
    lineHeight: 24,
  },
  completionActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  returnButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: '#FAFAFA',
  },
  returnButtonText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
    marginLeft: 6,
  },
  searchOtherButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: '#1976D2',
  },
  searchOtherButtonText: {
    fontSize: 14,
    color: '#FFF',
    fontWeight: '600',
    marginLeft: 6,
  },
});
