import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  SafeAreaView,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  Dimensions,
  FlatList,
} from 'react-native';
import {
  MapPin,
  Search,
  Star,
  MessageCircle,
  Code,
  X,
  RefreshCw,
  Navigation,
  ChevronDown,
  ChevronUp,
} from 'lucide-react-native';
import { SearchLocation, ApiResponse, GooglePlacesPrediction } from '@/types';
import { useAPICall } from '@/hooks/useAPICall';
import {
  DishMedia,
  ListDishMediaQuery,
  ListDishMediaResponse,
  Review,
} from '@/shared/api/list-dish-media.dto';

const { width } = Dimensions.get('window');

export default function DebugScreen() {
  const [dishMediaList, setDishMediaList] = useState<DishMedia[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchLocation, setSearchLocation] = useState<SearchLocation>({
    latitude: 35.6762,
    longitude: 139.6503,
    address: '東京都渋谷区神宮前（デフォルト位置）',
  });
  const { callBackend } = useAPICall();

  // Modal states
  const [showReviewsModal, setShowReviewsModal] = useState(false);
  const [showJsonModal, setShowJsonModal] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [selectedDish, setSelectedDish] = useState<DishMedia | null>(null);

  // Location search states
  const [locationQuery, setLocationQuery] = useState('');
  const [locationSuggestions, setLocationSuggestions] = useState<
    GooglePlacesPrediction[]
  >([]);
  const [searchingLocation, setSearchingLocation] = useState(false);

  useEffect(() => {
    loadDishMediaData();
    getCurrentLocation();
  }, []);

  const getCurrentLocation = async () => {
    try {
      // In a real app, you would use expo-location here
      // For now, we'll use the default Tokyo location
      console.log('Using default location: Tokyo, Japan');
    } catch (error) {
      console.error('Error getting current location:', error);
    }
  };

  const loadDishMediaData = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await callBackend<
        ListDishMediaQuery,
        ListDishMediaResponse
      >('dish-media', 'v1', {
        method: 'GET',
        requestPayload: {
          lat: searchLocation.latitude,
          lng: searchLocation.longitude,
          radius: 5000,
          limit: 20,
          lang: 'ja', // TODO - make this dynamic
        },
      });

      setDishMediaList(response);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load dish media data'
      );
    } finally {
      setLoading(false);
    }
  };

  const searchLocationSuggestions = async (query: string) => {
    if (query.length < 3) {
      setLocationSuggestions([]);
      return;
    }

    setSearchingLocation(true);
    try {
      // In a real app, this would use Google Places API
      // For now, we'll use mock suggestions
      const mockSuggestions: GooglePlacesPrediction[] = [
        {
          place_id: 'place_1',
          description: '渋谷駅, 東京都渋谷区',
          structured_formatting: {
            main_text: '渋谷駅',
            secondary_text: '東京都渋谷区',
          },
        },
        {
          place_id: 'place_2',
          description: '新宿駅, 東京都新宿区',
          structured_formatting: {
            main_text: '新宿駅',
            secondary_text: '東京都新宿区',
          },
        },
        {
          place_id: 'place_3',
          description: '銀座, 東京都中央区',
          structured_formatting: {
            main_text: '銀座',
            secondary_text: '東京都中央区',
          },
        },
      ];

      setLocationSuggestions(
        mockSuggestions.filter((s) =>
          s.description.toLowerCase().includes(query.toLowerCase())
        )
      );
    } catch (error) {
      console.error('Error searching locations:', error);
    } finally {
      setSearchingLocation(false);
    }
  };

  const selectLocation = async (prediction: GooglePlacesPrediction) => {
    try {
      // In a real app, this would use Google Places Details API
      const mockLocation: SearchLocation = {
        latitude: 35.6762 + (Math.random() - 0.5) * 0.01,
        longitude: 139.6503 + (Math.random() - 0.5) * 0.01,
        address: prediction.description,
      };

      setSearchLocation(mockLocation);
      setLocationQuery('');
      setLocationSuggestions([]);
      setShowLocationModal(false);

      // Reload data with new location
      loadDishMediaData();
    } catch (error) {
      Alert.alert('エラー', '位置情報の取得に失敗しました');
    }
  };

  const formatPrice = (price: number): string => {
    return `¥${price.toLocaleString()}`;
  };

  const formatRating = (rating: number): string => {
    return rating.toFixed(1);
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderStars = (rating: number) => {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 !== 0;

    return (
      <View style={styles.starsContainer}>
        {[...Array(5)].map((_, index) => (
          <Star
            key={index}
            size={14}
            color="#FFD700"
            fill={index < fullStars ? '#FFD700' : 'transparent'}
          />
        ))}
      </View>
    );
  };

  const renderDishMediaCard = ({ item }: { item: DishMedia }) => (
    <View style={styles.dishCard}>
      <Image source={{ uri: item.photo_url }} style={styles.dishImage} />

      <View style={styles.dishInfo}>
        <Text style={styles.dishName} numberOfLines={2}>
          {item.dish_name}
        </Text>
        <Text style={styles.restaurantName}>{item.place.name}</Text>

        <View style={styles.priceRatingRow}>
          <Text style={styles.price}>{formatPrice(item.price)}</Text>
          <View style={styles.ratingContainer}>
            {renderStars(item.average_rating)}
            <Text style={styles.ratingText}>
              {formatRating(item.average_rating)}
            </Text>
            <Text style={styles.reviewCount}>({item.review_count})</Text>
          </View>
        </View>

        <View style={styles.locationRow}>
          <MapPin size={12} color="#666" />
          <Text style={styles.locationText} numberOfLines={1}>
            {item.place.location.lat.toFixed(6)},{' '}
            {item.place.location.lng.toFixed(6)}
          </Text>
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.reviewButton}
            onPress={() => {
              setSelectedDish(item);
              setShowReviewsModal(true);
            }}
          >
            <MessageCircle size={16} color="#007AFF" />
            <Text style={styles.reviewButtonText}>クチコミを見る</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.jsonButton}
            onPress={() => {
              setSelectedDish(item);
              setShowJsonModal(true);
            }}
          >
            <Code size={16} color="#FF6B35" />
            <Text style={styles.jsonButtonText}>JSON表示</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  const renderReviewItem = ({ item }: { item: Review }) => (
    <View style={styles.reviewItem}>
      <View style={styles.reviewHeader}>
        <Image
          source={{
            uri:
              item.user_avatar ||
              'https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg?auto=compress&cs=tinysrgb&w=100&h=100',
          }}
          style={styles.reviewAvatar}
        />
        <View style={styles.reviewUserInfo}>
          <Text style={styles.reviewUserName}>{item.author_name}</Text>
          <View style={styles.reviewRatingRow}>
            {renderStars(item.rating)}
            <Text style={styles.reviewDate}>
              {item.created_at && formatDate(item.created_at)}
            </Text>
          </View>
        </View>
      </View>

      <Text style={styles.reviewComment}>{item.text}</Text>

      <View style={styles.reviewFooter}>
        <Text style={styles.helpfulCount}>
          参考になった: {item.helpful_count}
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          Developer Debug - listDishMedia API
        </Text>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={loadDishMediaData}
        >
          <RefreshCw size={20} color="#007AFF" />
        </TouchableOpacity>
      </View>

      {/* Search Location Section */}
      <View style={styles.searchSection}>
        <View style={styles.locationHeader}>
          <Navigation size={16} color="#007AFF" />
          <Text style={styles.locationLabel}>検索中心地</Text>
          <TouchableOpacity
            style={styles.changeLocationButton}
            onPress={() => setShowLocationModal(true)}
          >
            <Text style={styles.changeLocationText}>変更</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.locationInfo}>
          <Text style={styles.coordinatesText}>
            緯度: {searchLocation.latitude.toFixed(6)}, 経度:{' '}
            {searchLocation.longitude.toFixed(6)}
          </Text>
          <Text style={styles.addressText}>{searchLocation.address}</Text>
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>データを読み込み中...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>エラー: {error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={loadDishMediaData}
          >
            <Text style={styles.retryButtonText}>再試行</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={dishMediaList}
          renderItem={renderDishMediaCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Location Search Modal */}
      <Modal
        visible={showLocationModal}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowLocationModal(false)}>
              <X size={24} color="#000" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>検索中心地を変更</Text>
            <View style={{ width: 24 }} />
          </View>

          <View style={styles.searchInputContainer}>
            <Search size={20} color="#666" />
            <TextInput
              style={styles.searchInput}
              placeholder="地名を入力してください"
              value={locationQuery}
              onChangeText={(text) => {
                setLocationQuery(text);
                searchLocationSuggestions(text);
              }}
            />
            {searchingLocation && (
              <ActivityIndicator size="small" color="#007AFF" />
            )}
          </View>

          <FlatList
            data={locationSuggestions}
            keyExtractor={(item) => item.place_id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.suggestionItem}
                onPress={() => selectLocation(item)}
              >
                <MapPin size={16} color="#666" />
                <View style={styles.suggestionText}>
                  <Text style={styles.suggestionMain}>
                    {item.structured_formatting.main_text}
                  </Text>
                  <Text style={styles.suggestionSecondary}>
                    {item.structured_formatting.secondary_text}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>

      {/* Reviews Modal */}
      <Modal
        visible={showReviewsModal}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowReviewsModal(false)}>
              <X size={24} color="#000" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>クチコミ一覧</Text>
            <View style={{ width: 24 }} />
          </View>

          {selectedDish && (
            <>
              <View style={styles.dishSummary}>
                <Text style={styles.dishSummaryName}>
                  {selectedDish.dish_name}
                </Text>
                <Text style={styles.dishSummaryRestaurant}>
                  {selectedDish.place.name}
                </Text>
              </View>

              <FlatList
                data={selectedDish.reviews}
                renderItem={renderReviewItem}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.reviewsList}
                showsVerticalScrollIndicator={false}
              />
            </>
          )}
        </SafeAreaView>
      </Modal>

      {/* JSON Modal */}
      <Modal
        visible={showJsonModal}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowJsonModal(false)}>
              <X size={24} color="#000" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>JSON データ</Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView style={styles.jsonContainer}>
            <Text style={styles.jsonText}>
              {selectedDish ? JSON.stringify(selectedDish, null, 2) : ''}
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    flex: 1,
  },
  refreshButton: {
    padding: 8,
  },
  searchSection: {
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  locationLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginLeft: 8,
    flex: 1,
  },
  changeLocationButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#007AFF',
    borderRadius: 4,
  },
  changeLocationText: {
    fontSize: 12,
    color: '#FFF',
    fontWeight: '500',
  },
  locationInfo: {
    marginLeft: 24,
  },
  coordinatesText: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
  },
  addressText: {
    fontSize: 14,
    color: '#333',
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 12,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  errorText: {
    fontSize: 16,
    color: '#FF3B30',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 16,
    color: '#FFF',
    fontWeight: '600',
  },
  listContainer: {
    padding: 16,
  },
  dishCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    flexDirection: 'row',
  },
  dishImage: {
    width: 120,
    height: 120,
    resizeMode: 'cover',
  },
  dishInfo: {
    flex: 1,
    padding: 12,
  },
  dishName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  restaurantName: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  priceRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  price: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FF6B35',
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  starsContainer: {
    flexDirection: 'row',
    marginRight: 4,
  },
  ratingText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginRight: 4,
  },
  reviewCount: {
    fontSize: 12,
    color: '#666',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  locationText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 4,
    flex: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  reviewButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F8FF',
    paddingVertical: 8,
    borderRadius: 6,
    gap: 4,
  },
  reviewButtonText: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '500',
  },
  jsonButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF5F0',
    paddingVertical: 8,
    borderRadius: 6,
    gap: 4,
  },
  jsonButtonText: {
    fontSize: 12,
    color: '#FF6B35',
    fontWeight: '500',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    gap: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#000',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    gap: 12,
  },
  suggestionText: {
    flex: 1,
  },
  suggestionMain: {
    fontSize: 16,
    color: '#000',
    fontWeight: '500',
  },
  suggestionSecondary: {
    fontSize: 14,
    color: '#666',
  },
  dishSummary: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  dishSummaryName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  dishSummaryRestaurant: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  reviewsList: {
    padding: 16,
  },
  reviewItem: {
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  reviewAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 12,
  },
  reviewUserInfo: {
    flex: 1,
  },
  reviewUserName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  reviewRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  reviewDate: {
    fontSize: 12,
    color: '#666',
    marginLeft: 8,
  },
  reviewComment: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
    marginBottom: 8,
  },
  reviewFooter: {
    alignItems: 'flex-end',
  },
  helpfulCount: {
    fontSize: 12,
    color: '#666',
  },
  jsonContainer: {
    flex: 1,
    padding: 16,
  },
  jsonText: {
    fontSize: 12,
    color: '#333',
    fontFamily: 'monospace',
    lineHeight: 18,
  },
});
