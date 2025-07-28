import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { X, RotateCcw, Search } from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import FoodContentFeed from '@/components/FoodContentFeed';
import { useSearchStore } from '@/stores/useSearchStore';
import FoodContentMap from '@/components/FoodContentMap';

export default function ResultScreen() {
  const { topicId } = useLocalSearchParams<{
    topicId: string;
  }>();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const dishes = useSearchStore((state) => state.dishesMap[topicId] || []);

  const handleIndexChange = (index: number) => {
    setCurrentIndex(index);

    // Show completion modal when reaching the last item
    // if (index >= dishes.length - 1) {
    //   setTimeout(() => {
    //     setShowCompletionModal(true);
    //   }, 1000);
    // }
  };

  const handleClose = () => {
    router.back();
  };

  const handleReturnToCards = () => {
    setShowCompletionModal(false);
    router.back();
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header with Back Button */}
      <View style={styles.closeButtonContainer}>
        <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
          <X size={24} color="#000" />
        </TouchableOpacity>
      </View>

      {/* Feed Content */}
      {/* <FoodContentFeed items={dishes} onIndexChange={handleIndexChange} /> */}
      <FoodContentMap items={dishes} onIndexChange={handleIndexChange} />

      {/* Completion Modal */}
      <Modal
        visible={showCompletionModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowCompletionModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.completionModal}>
            <Text style={styles.completionTitle}>
              これ以上出すと迷っちゃうし、ここから選ぼう！
            </Text>
            {/* <Text style={styles.completionMessage}>おすすめに戻りますか？</Text> */}

            <View style={styles.completionActions}>
              <TouchableOpacity
                style={styles.returnButton}
                onPress={() => setShowCompletionModal(false)}
              >
                <RotateCcw size={20} color="#666" />
                <Text style={styles.returnButtonText}>ここから選ぶ</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.searchOtherButton}
                onPress={handleReturnToCards}
              >
                <Search size={20} color="#FFF" />
                <Text style={styles.searchOtherButtonText}>他の料理を見る</Text>
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
  closeButtonContainer: {
    position: 'absolute',
    top: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    zIndex: 10,
  },
  closeButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
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
