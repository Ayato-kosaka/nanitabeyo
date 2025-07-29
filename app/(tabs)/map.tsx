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
    imageUrl: 'https://images.pexels.com/photos/262978/pexels-photo-262978.jpeg?auto=compress&cs=tinysrgb&w=400',
    rating: 4.5,
    reviewCount: 127,
  },
  {
    placeId: 'place_2',
    placeName: 'Tokyo Ramen House',
    totalAmount: 28000,
    remainingDays: 8,
    latitude: 35.6580,
    longitude: 139.7016,
    imageUrl: 'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=400',
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
    imageUrl: 'https://images.pexels.com/photos/1640772/pexels-photo-1640772.jpeg?auto=compress&cs=tinysrgb&w=400',
    rating: 4.8,
    reviewCount: 203,
  },
];

// Mock reviews data
const mockReviews: Review[] = [
  {
    id: '1',
    dishName: 'Truffle Pasta',
    imageUrl: 'https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=300',
    rating: 4.5,
    reviewCount: 23,
    price: 2800,
  },
  {
    id: '2',
    dishName: 'Wagyu Steak',
    imageUrl: 'https://images.pexels.com/photos/3535383/pexels-photo-3535383.jpeg?auto=compress&cs=tinysrgb&w=300',
    rating: 4.8,
    reviewCount: 45,
    price: 5200,
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

  const getBidColor = (amount: number): string => {
    if (amount < 30000) return '#4CAF50'; // Green
    if (amount < 50000) return '#FF9800'; // Orange
    return '#F44336'; // Red
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
      await new Promise(resolve => setTimeout(resolve, 2000));
      Alert.alert('成功', `${selectedPlace.placeName}に¥${parseInt(bidAmount).toLocaleString()}で入札しました`);
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
      await new Promise(resolve => setTimeout(resolve, 1000));
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

  const renderReviewItem = ({ item }: { item: Review }) => (
    <TouchableOpacity style={styles.reviewCard} onPress={() => setShowReviewModal(true)}>
      <Image source={{ uri: item.imageUrl }} style={styles.reviewImage} />
      <View style={styles.reviewInfo}>
        <Text style={styles.reviewDishName}>{item.dishName}</Text>
        <View style={styles.reviewRating}>
          {renderStars(item.rating)}
          <Text style={styles.reviewCount}>({item.reviewCount})</Text>
        </View>
        <Text style={styles.reviewPrice}>¥{item.price.toLocaleString()}</Text>
      </View>
    </TouchableOpacity>
  );

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
          <Marker
            key={bid.placeId}
            coordinate={{ latitude: bid.latitude, longitude: bid.longitude }}
            onPress={() => handleMarkerPress(bid)}
            pinColor={getBidColor(bid.totalAmount)}
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
              <View style={styles.restaurantInfo}>
                <Image source={{ uri: selectedPlace.imageUrl }} style={styles.restaurantImage} />
                <View style={styles.restaurantDetails}>
                  <Text style={styles.restaurantName}>{selectedPlace.placeName}</Text>
                  <View style={styles.ratingContainer}>
                    {renderStars(selectedPlace.rating)}
                    <Text style={styles.ratingText}>{selectedPlace.rating}</Text>
                    <Text style={styles.reviewCount}>({selectedPlace.reviewCount})</Text>
                  </View>
                  <Text style={styles.bidInfo}>
                    入札額: ¥{selectedPlace.totalAmount.toLocaleString()} • 残り{selectedPlace.remainingDays}日
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
                  <DollarSign size={20} color="#FFF" />
                  <Text style={styles.bidButtonText}>入札する</Text>
                </TouchableOpacity>
              </View>

              {/* Tabs */}
              <View style={styles.tabContainer}>
                <TouchableOpacity
                  style={[styles.tab, selectedTab === 'reviews' && styles.activeTab]}
                  onPress={() => setSelectedTab('reviews')}
                >
                  <Text style={[styles.tabText, selectedTab === 'reviews' && styles.activeTabText]}>
                    レビュー
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tab, selectedTab === 'bids' && styles.activeTab]}
                  onPress={() => setSelectedTab('bids')}
                >
                  <Text style={[styles.tabText, selectedTab === 'bids' && styles.activeTabText]}>
                    入札
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Tab Content */}
              {selectedTab === 'reviews' ? (
                <FlatList
                  data={mockReviews}
                  renderItem={renderReviewItem}
                  numColumns={2}
                  scrollEnabled={false}
                  contentContainerStyle={styles.reviewsList}
                />
              ) : (
                <View style={styles.bidsContent}>
                  <View style={styles.bidStatusChip}>
                    <Text style={styles.bidStatusText}>アクティブ</Text>
                  </View>
                  <Text style={styles.bidAmount}>¥{selectedPlace.totalAmount.toLocaleString()}</Text>
                  <Text style={styles.bidDays}>残り{selectedPlace.remainingDays}日</Text>
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
            <TouchableOpacity onPress={handleReviewSubmit} disabled={isProcessing}>
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
            <TouchableOpacity onPress={handleBid} disabled={isProcessing || !bidAmount}>
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
                  終了日: {new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('ja-JP')}
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
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
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
  restaurantInfo: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  restaurantImage: {
    width: 80,
    height: 80,
    borderRadius: 12,
    marginRight: 16,
  },
  restaurantDetails: {
    flex: 1,
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
  bidInfo: {
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
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 8,
  },
  bidButtonText: {
    fontSize: 14,
    color: '#FFF',
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
  reviewsList: {
    gap: 8,
  },
  reviewCard: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    padding: 8,
    margin: 4,
  },
  reviewImage: {
    width: '100%',
    height: 100,
    borderRadius: 6,
    marginBottom: 8,
  },
  reviewInfo: {
    flex: 1,
  },
  reviewDishName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  reviewRating: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  reviewPrice: {
    fontSize: 12,
    color: '#666',
  },
  bidsContent: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  bidStatusChip: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 16,
  },
  bidStatusText: {
    fontSize: 12,
    color: '#FFF',
    fontWeight: '500',
  },
  bidAmount: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 8,
  },
  bidDays: {
    fontSize: 16,
    color: '#666',
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
});