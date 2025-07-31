import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Modal,
  TextInput,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
  FlatList,
  Dimensions,
} from 'react-native';
import {
  MapPin,
  Search,
  Navigation,
  Camera,
  DollarSign,
  Star,
  Calendar,
  X,
  Plus,
} from 'lucide-react-native';
import MapView, { Marker, Region } from '@/components/MapView';
import { useLocationSearch } from '@/hooks/useLocationSearch';
import { GooglePlacesPrediction } from '@/types/search';
import { AvatarBubbleMarker } from '@/components/AvatarBubbleMarker';

const { width, height } = Dimensions.get('window');

interface ActiveBid {
  placeId: string;
  placeName: string;
  totalAmount: number;
  remainingDays: number;
  latitude: number;
  longitude: number;
  imageUrl: string;
  rating: number;
  reviewCount: number;
}

interface Review {
  id: string;
  dishName: string;
  imageUrl: string;
  rating: number;
  reviewCount: number;
  price: number;
}

// Mock data for active bids
const mockActiveBids: ActiveBid[] = [
  {
    placeId: 'place_1',
    placeName: 'Bella Vista Restaurant',
    totalAmount: 45000,
    remainingDays: 12,
    latitude: 35.6762,
    longitude: 139.6503,
    imageUrl:
      'https://images.pexels.com/photos/262978/pexels-photo-262978.jpeg?auto=compress&cs=tinysrgb&w=400',
    rating: 4.5,
    reviewCount: 127,
  },
  {
    placeId: 'place_2',
    placeName: 'Tokyo Ramen House',
    totalAmount: 28000,
    remainingDays: 8,
    latitude: 35.658,
    longitude: 139.7016,
    imageUrl:
      'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=400',
    rating: 4.2,
    reviewCount: 89,
  },
  {
    placeId: 'place_3',
    placeName: 'Sushi Zen',
    totalAmount: 67000,
    remainingDays: 5,
    latitude: 35.6896,
    longitude: 139.7006,
    imageUrl:
      'https://images.pexels.com/photos/1640772/pexels-photo-1640772.jpeg?auto=compress&cs=tinysrgb&w=400',
    rating: 4.8,
    reviewCount: 203,
  },
];

// Mock reviews data
const mockReviews: Review[] = [
  {
    id: '1',
    dishName: 'Truffle Pasta',
    imageUrl:
      'https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=300',
    rating: 4.5,
    reviewCount: 23,
    price: 2800,
  },
  {
    id: '2',
    dishName: 'Wagyu Steak',
    imageUrl:
      'https://images.pexels.com/photos/3535383/pexels-photo-3535383.jpeg?auto=compress&cs=tinysrgb&w=300',
    rating: 4.8,
    reviewCount: 45,
    price: 5200,
  },
];

// Mock data for bid history
const mockBidHistory = [
  {
    id: '1',
    amount: 15000,
    status: 'active',
    date: '2024-01-15',
    remainingDays: 12,
  },
  {
    id: '2',
    amount: 8000,
    status: 'completed',
    date: '2024-01-10',
    remainingDays: 0,
  },
  {
    id: '3',
    amount: 12000,
    status: 'refunded',
    date: '2024-01-05',
    remainingDays: 0,
  },
];

export default function MapScreen() {
  const [selectedPlace, setSelectedPlace] = useState<ActiveBid | null>(null);
  const [showBottomSheet, setShowBottomSheet] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showBidModal, setShowBidModal] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'reviews' | 'bids'>('reviews');
  const [searchQuery, setSearchQuery] = useState('');
  const [bidAmount, setBidAmount] = useState('');
  const [reviewText, setReviewText] = useState('');
  const [rating, setRating] = useState(5);
  const [price, setPrice] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const mapRef = useRef<any>(null);
  const {
    suggestions,
    isSearching,
    searchLocations,
    getLocationDetails,
    getCurrentLocation,
  } = useLocationSearch();

  const [currentRegion, setCurrentRegion] = useState<Region>({
    latitude: 35.6762,
    longitude: 139.6503,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });

  const [selectedBidStatuses, setSelectedBidStatuses] = useState<string[]>([
    'active',
    'completed',
    'refunded',
  ]);
  useEffect(() => {
    getCurrentLocation().then((location) => {
      const newRegion = {
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      setCurrentRegion(newRegion);
      mapRef.current?.animateToRegion(newRegion, 1000);
    });
  }, []);

  const getBidStatusColor = (status: string): string => {
    switch (status) {
      case 'active':
        return '#4CAF50';
      case 'completed':
        return '#2196F3';
      case 'refunded':
        return '#FF9800';
      default:
        return '#666';
    }
  };

  const getBidStatusText = (status: string): string => {
    switch (status) {
      case 'active':
        return 'アクティブ';
      case 'completed':
        return '完了';
      case 'refunded':
        return '返金済み';
      default:
        return status;
    }
  };

  const handleMarkerPress = (bid: ActiveBid) => {
    setSelectedPlace(bid);
    setShowBottomSheet(true);
  };

  const handleSearchSelect = async (prediction: GooglePlacesPrediction) => {
    try {
      const location = await getLocationDetails(prediction);
      const newRegion = {
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      setCurrentRegion(newRegion);
      mapRef.current?.animateToRegion(newRegion, 1000);
      setSearchQuery('');
    } catch (error) {
      Alert.alert('エラー', '位置情報の取得に失敗しました');
    }
  };

  const handleCurrentLocation = async () => {
    try {
      const location = await getCurrentLocation();
      const newRegion = {
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      setCurrentRegion(newRegion);
      mapRef.current?.animateToRegion(newRegion, 1000);
    } catch (error) {
      Alert.alert('エラー', '現在地の取得に失敗しました');
    }
  };

  const handleBid = async () => {
    if (!bidAmount || !selectedPlace) return;

    setIsProcessing(true);
    try {
      // Mock Stripe payment processing
      await new Promise((resolve) => setTimeout(resolve, 2000));
      Alert.alert(
        '成功',
        `${selectedPlace.placeName}に¥${parseInt(
          bidAmount
        ).toLocaleString()}で入札しました`
      );
      setShowBidModal(false);
      setBidAmount('');
    } catch (error) {
      Alert.alert('エラー', '入札に失敗しました');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReviewSubmit = async () => {
    if (!reviewText || !price) return;

    setIsProcessing(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      Alert.alert('成功', 'レビューを投稿しました');
      setShowReviewModal(false);
      setReviewText('');
      setPrice('');
      setRating(5);
    } catch (error) {
      Alert.alert('エラー', 'レビューの投稿に失敗しました');
    } finally {
      setIsProcessing(false);
    }
  };

  const bidStatuses = [
    { id: 'active', label: 'アクティブ', color: '#4CAF50' },
    { id: 'completed', label: '完了', color: '#2196F3' },
    { id: 'refunded', label: '返金済み', color: '#FF9800' },
  ];

  const toggleBidStatus = (statusId: string) => {
    setSelectedBidStatuses((prev) =>
      prev.includes(statusId)
        ? prev.filter((id) => id !== statusId)
        : [...prev, statusId]
    );
  };

  const filteredBidHistory = mockBidHistory.filter((bid) =>
    selectedBidStatuses.includes(bid.status)
  );

  const renderStars = (rating: number) => {
    return (
      <View style={styles.starsContainer}>
        {[...Array(5)].map((_, index) => (
          <Star
            key={index}
            size={16}
            color="#FFD700"
            fill={index < rating ? '#FFD700' : 'transparent'}
          />
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        region={currentRegion}
        onRegionChangeComplete={setCurrentRegion}
      >
        {mockActiveBids.map((bid) => (
          <AvatarBubbleMarker
            key={bid.placeId}
            coordinate={{ latitude: bid.latitude, longitude: bid.longitude }}
            onPress={() => handleMarkerPress(bid)}
            color="#FFF"
            uri="https://lh3.googleusercontent.com/gps-cs-s/AC9h4np7DkWIEo4c-6z3PcCXqDGQg2FA6tQzjMZcVk3AxlY5WTmL-nitVotmHXsCXQ6EWSMZq-N17c7nTkQ5H0dqp8nLyL0GPh1Hd16F30edR7YKEablN-HZgXVm97EXOsAyuKkKjpWnOA=w520-h350-n-k-no" // 仮
          />
        ))}
      </MapView>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Search size={20} color="#666" />
          <TextInput
            style={styles.searchInput}
            placeholder="レストランを検索"
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              if (text.length >= 2) {
                searchLocations(text);
              }
            }}
          />
        </View>

        {suggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            <FlatList
              data={suggestions}
              keyExtractor={(item) => item.placeId}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.suggestionItem}
                  onPress={() => handleSearchSelect(item)}
                >
                  <MapPin size={16} color="#666" />
                  <Text style={styles.suggestionText}>{item.description}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}
      </View>

      {/* Current Location FAB */}
      <TouchableOpacity style={styles.fab} onPress={handleCurrentLocation}>
        <Navigation size={24} color="#FFF" />
      </TouchableOpacity>

      {/* Bottom Sheet */}
      <Modal
        visible={showBottomSheet}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowBottomSheet(false)}
      >
        <SafeAreaView style={styles.bottomSheet}>
          <View style={styles.bottomSheetHeader}>
            <TouchableOpacity onPress={() => setShowBottomSheet(false)}>
              <X size={24} color="#000" />
            </TouchableOpacity>
            <Text style={styles.bottomSheetTitle}>レストラン詳細</Text>
            <View style={{ width: 24 }} />
          </View>

          {selectedPlace && (
            <ScrollView style={styles.bottomSheetContent}>
              {/* Restaurant Info */}
              <View style={styles.restaurantHeader}>
                <Text style={styles.restaurantName}>
                  {selectedPlace.placeName}
                </Text>
                <View style={styles.ratingContainer}>
                  {renderStars(selectedPlace.rating)}
                  <Text style={styles.ratingText}>{selectedPlace.rating}</Text>
                  <Text style={styles.reviewCount}>
                    ({selectedPlace.reviewCount})
                  </Text>
                </View>
                <View style={styles.bidAmountContainer}>
                  <Text style={styles.bidAmountLabel}>現在の入札額</Text>
                  <Text style={styles.bidAmount}>
                    ¥{selectedPlace.totalAmount.toLocaleString()}
                  </Text>
                  <Text style={styles.remainingDays}>
                    残り{selectedPlace.remainingDays}日
                  </Text>
                </View>
              </View>

              {/* Action Buttons */}
              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={styles.reviewButton}
                  onPress={() => setShowReviewModal(true)}
                >
                  <Camera size={20} color="#007AFF" />
                  <Text style={styles.reviewButtonText}>レビュー投稿</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.bidButton}
                  onPress={() => setShowBidModal(true)}
                >
                  <DollarSign size={20} color="#007AFF" />
                  <Text style={styles.bidButtonText}>入札する</Text>
                </TouchableOpacity>
              </View>

              {/* Tabs */}
              <View style={styles.tabContainer}>
                <TouchableOpacity
                  style={[
                    styles.tab,
                    selectedTab === 'reviews' && styles.activeTab,
                  ]}
                  onPress={() => setSelectedTab('reviews')}
                >
                  <Text
                    style={[
                      styles.tabText,
                      selectedTab === 'reviews' && styles.activeTabText,
                    ]}
                  >
                    レビュー
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.tab,
                    selectedTab === 'bids' && styles.activeTab,
                  ]}
                  onPress={() => setSelectedTab('bids')}
                >
                  <Text
                    style={[
                      styles.tabText,
                      selectedTab === 'bids' && styles.activeTabText,
                    ]}
                  >
                    入札
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Tab Content */}
              {selectedTab === 'reviews' ? (
                <View style={styles.reviewsContent}>
                  {mockReviews.map((review) => (
                    <TouchableOpacity key={review.id} style={styles.reviewCard}>
                      <Image
                        source={{ uri: review.imageUrl }}
                        style={styles.reviewCardImage}
                      />
                      <View style={styles.reviewCardOverlay}>
                        <Text style={styles.reviewCardTitle}>
                          {review.dishName}
                        </Text>
                        <View style={styles.reviewCardRating}>
                          {renderStars(review.rating)}
                          <Text style={styles.reviewCardRatingText}>
                            ({review.reviewCount})
                          </Text>
                        </View>
                        <Text style={styles.reviewCardPrice}>
                          ¥{review.price.toLocaleString()}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <View style={styles.bidsContent}>
                  {/* Status Filter Chips */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.statusFilterContainer}
                    contentContainerStyle={styles.statusFilterContent}
                  >
                    {bidStatuses.map((status) => (
                      <TouchableOpacity
                        key={status.id}
                        style={[
                          styles.statusChip,
                          selectedBidStatuses.includes(status.id) && {
                            backgroundColor: status.color,
                          },
                        ]}
                        onPress={() => toggleBidStatus(status.id)}
                      >
                        <Text
                          style={[
                            styles.statusChipText,
                            selectedBidStatuses.includes(status.id) &&
                              styles.statusChipTextActive,
                          ]}
                        >
                          {status.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {/* Filtered Bid History */}
                  {filteredBidHistory.length > 0 ? (
                    filteredBidHistory.map((bid) => (
                      <View key={bid.id} style={styles.bidHistoryCard}>
                        <View style={styles.bidHistoryHeader}>
                          <Text style={styles.bidHistoryAmount}>
                            ¥{bid.amount.toLocaleString()}
                          </Text>
                          <View
                            style={[
                              styles.bidStatusChip,
                              {
                                backgroundColor: getBidStatusColor(bid.status),
                              },
                            ]}
                          >
                            <Text style={styles.bidStatusText}>
                              {getBidStatusText(bid.status)}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.bidHistoryDate}>{bid.date}</Text>
                        <Text style={styles.bidHistoryDays}>
                          残り{bid.remainingDays}日
                        </Text>
                      </View>
                    ))
                  ) : (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyStateText}>
                        選択したステータスの入札がありません
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* Review Modal */}
      <Modal
        visible={showReviewModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowReviewModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowReviewModal(false)}>
              <X size={24} color="#000" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>レビュー投稿</Text>
            <TouchableOpacity
              onPress={handleReviewSubmit}
              disabled={isProcessing}
            >
              <Text style={styles.submitText}>投稿</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>料金</Text>
              <TextInput
                style={styles.textInput}
                placeholder="料金を入力"
                value={price}
                onChangeText={setPrice}
                keyboardType="numeric"
              />
            </View>

            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>評価</Text>
              <View style={styles.ratingInput}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <TouchableOpacity key={star} onPress={() => setRating(star)}>
                    <Star
                      size={32}
                      color="#FFD700"
                      fill={star <= rating ? '#FFD700' : 'transparent'}
                    />
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>コメント</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                placeholder="レビューを入力"
                value={reviewText}
                onChangeText={setReviewText}
                multiline
                numberOfLines={4}
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Bid Modal */}
      <Modal
        visible={showBidModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowBidModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowBidModal(false)}>
              <X size={24} color="#000" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>入札</Text>
            <TouchableOpacity
              onPress={handleBid}
              disabled={isProcessing || !bidAmount}
            >
              <Text style={styles.submitText}>入札</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>入札額</Text>
              <TextInput
                style={styles.textInput}
                placeholder="入札額を入力"
                value={bidAmount}
                onChangeText={setBidAmount}
                keyboardType="numeric"
              />
            </View>

            <View style={styles.bidInfo}>
              <View style={styles.bidInfoRow}>
                <Calendar size={16} color="#666" />
                <Text style={styles.bidInfoText}>
                  終了日:{' '}
                  {new Date(
                    Date.now() + 30 * 24 * 60 * 60 * 1000
                  ).toLocaleDateString('ja-JP')}
                </Text>
              </View>
            </View>

            {isProcessing && (
              <View style={styles.processingContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
                <Text style={styles.processingText}>決済処理中...</Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  map: {
    flex: 1,
  },
  searchContainer: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    zIndex: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 16,
  },
  suggestionsContainer: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    marginTop: 8,
    maxHeight: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  suggestionText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#333',
  },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    backgroundColor: '#007AFF',
    borderRadius: 28,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  bottomSheet: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  bottomSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  bottomSheetTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  bottomSheetContent: {
    flex: 1,
    padding: 16,
  },
  restaurantHeader: {
    marginBottom: 16,
  },
  restaurantName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  starsContainer: {
    flexDirection: 'row',
    marginRight: 8,
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
  bidAmountContainer: {
    backgroundColor: '#F0F8FF',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  bidAmountLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  bidAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 4,
  },
  remainingDays: {
    fontSize: 14,
    color: '#666',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  reviewButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F8FF',
    paddingVertical: 12,
    borderRadius: 8,
  },
  reviewButtonText: {
    fontSize: 14,
    color: '#007AFF',
    marginLeft: 8,
    fontWeight: '500',
  },
  bidButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F8FF',
    paddingVertical: 12,
    borderRadius: 8,
  },
  bidButtonText: {
    fontSize: 14,
    color: '#007AFF',
    marginLeft: 8,
    fontWeight: '500',
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#007AFF',
  },
  tabText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  activeTabText: {
    color: '#007AFF',
    fontWeight: '600',
  },
  reviewsContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  reviewCard: {
    width: '48%',
    aspectRatio: 9 / 16,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  reviewCardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  reviewCardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 8,
  },
  reviewCardTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFF',
    marginBottom: 4,
  },
  reviewCardRating: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reviewCardRatingText: {
    fontSize: 10,
    color: '#FFF',
    marginLeft: 4,
  },
  reviewCardPrice: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFF',
  },
  bidsContent: {
    gap: 12,
  },
  bidHistoryCard: {
    backgroundColor: '#F8F9FA',
    padding: 16,
    borderRadius: 12,
  },
  bidHistoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  bidHistoryAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  bidHistoryDate: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  bidHistoryDays: {
    fontSize: 12,
    color: '#666',
  },
  bidStatusChip: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  bidStatusText: {
    fontSize: 12,
    color: '#FFF',
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
  submitText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  inputSection: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 8,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: '#000',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  ratingInput: {
    flexDirection: 'row',
    gap: 8,
  },
  bidInfo: {
    marginBottom: 24,
  },
  bidInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  bidInfoText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
  },
  processingContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  processingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
  },
  statusFilterContainer: {
    marginBottom: 16,
  },
  statusFilterContent: {
    paddingHorizontal: 4,
    gap: 8,
  },
  statusChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginHorizontal: 4,
  },
  statusChipText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  statusChipTextActive: {
    color: '#FFF',
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
});
