import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  SafeAreaView,
  FlatList,
  Platform,
  TextInput,
  Modal,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { 
  ArrowLeft, 
  MapPin, 
  Star,
  MessageCircle,
  Phone,
  Clock,
  Calendar,
  Camera,
  Filter,
  Search,
  X,
  Chrome as Home,
  Bell,
  User
} from 'lucide-react-native';
import MapViewComponent from '@/components/MapView';

const { width, height } = Dimensions.get('window');

interface RestaurantInfo {
  id: string;
  name: string;
  description: string;
  rating: number;
  reviewCount: number;
  address: string;
  phone: string;
  hours: string;
  image: string;
  latitude: number;
  longitude: number;
}

interface FoodPost {
  id: string;
  name: string;
  image: string;
  likes: number;
  comments: number;
}

interface FilterOptions {
  priceRange: string;
  category: string;
}

const restaurantInfo: RestaurantInfo = {
  id: '1',
  name: 'Bella Vista Restaurant',
  description: '本格イタリアンレストラン。新鮮な食材を使用した伝統的な料理をお楽しみください。',
  rating: 4.5,
  reviewCount: 127,
  address: '東京都渋谷区神宮前1-2-3',
  phone: '03-1234-5678',
  hours: '11:00 - 22:00',
  image: 'https://images.pexels.com/photos/262978/pexels-photo-262978.jpeg?auto=compress&cs=tinysrgb&w=800',
  latitude: 35.6762,
  longitude: 139.6503,
};

const foodPosts: FoodPost[] = [
  {
    id: '1',
    name: 'Truffle Pasta',
    image: 'https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=400&h=711',
    likes: 142,
    comments: 23,
  },
  {
    id: '2',
    name: 'Wagyu Steak',
    image: 'https://images.pexels.com/photos/3535383/pexels-photo-3535383.jpeg?auto=compress&cs=tinysrgb&w=400&h=711',
    likes: 298,
    comments: 45,
  },
  {
    id: '3',
    name: 'Chocolate Soufflé',
    image: 'https://images.pexels.com/photos/3026804/pexels-photo-3026804.jpeg?auto=compress&cs=tinysrgb&w=400&h=711',
    likes: 186,
    comments: 31,
  },
  {
    id: '4',
    name: 'Caesar Salad',
    image: 'https://images.pexels.com/photos/2097090/pexels-photo-2097090.jpeg?auto=compress&cs=tinysrgb&w=400&h=711',
    likes: 89,
    comments: 12,
  },
  {
    id: '5',
    name: 'Lobster Bisque',
    image: 'https://images.pexels.com/photos/5560763/pexels-photo-5560763.jpeg?auto=compress&cs=tinysrgb&w=400&h=711',
    likes: 156,
    comments: 28,
  },
  {
    id: '6',
    name: 'Margherita Pizza',
    image: 'https://images.pexels.com/photos/315755/pexels-photo-315755.jpeg?auto=compress&cs=tinysrgb&w=400&h=711',
    likes: 234,
    comments: 39,
  },
  {
    id: '7',
    name: 'Tiramisu',
    image: 'https://images.pexels.com/photos/6880219/pexels-photo-6880219.jpeg?auto=compress&cs=tinysrgb&w=400&h=711',
    likes: 178,
    comments: 25,
  },
  {
    id: '8',
    name: 'Seafood Risotto',
    image: 'https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=400&h=711',
    likes: 203,
    comments: 34,
  },
  {
    id: '9',
    name: 'Grilled Salmon',
    image: 'https://images.pexels.com/photos/3535383/pexels-photo-3535383.jpeg?auto=compress&cs=tinysrgb&w=400&h=711',
    likes: 167,
    comments: 22,
  },
];

export default function RestaurantScreen() {
  const { restaurantId } = useLocalSearchParams();
  const [selectedTab, setSelectedTab] = useState<'posts' | 'info'>('posts');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [filters, setFilters] = useState<FilterOptions>({
    priceRange: '',
    category: '',
  });
  const scrollViewRef = useRef<ScrollView>(null);

  const priceRanges = ['¥1,000以下', '¥1,000-3,000', '¥3,000-5,000', '¥5,000以上'];
  const categories = ['和食', 'イタリアン', 'フレンチ', '中華', 'アジア料理', 'その他'];

  const formatLikeCount = (count: number): string => {
    if (count >= 1000000) {
      return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (count >= 1000) {
      return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return count.toString();
  };

  const renderStars = (rating: number) => {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 !== 0;
    
    return (
      <View style={styles.starsContainer}>
        {[...Array(5)].map((_, index) => (
          <Star
            key={index}
            size={16}
            color="#FFD700"
            fill={index < fullStars ? "#FFD700" : "transparent"}
          />
        ))}
      </View>
    );
  };

  const handleFoodPostPress = (index: number) => {
    router.push(`/(tabs)/(home)/food?startIndex=${index}`);
  };

  const renderFoodPost = ({ item, index }: { item: FoodPost; index: number }) => (
    <TouchableOpacity style={styles.foodPost} onPress={() => handleFoodPostPress(index)}>
      <Image source={{ uri: item.image }} style={styles.foodPostImage} />
      <View style={styles.foodPostOverlay}>
        <View style={styles.foodPostStats}>
          <Text style={styles.foodPostLikes}>{formatLikeCount(item.likes)}</Text>
          <Text style={styles.foodPostComments}>{item.comments}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const handleMakeReservation = () => {
    console.log('Make reservation...');
  };

  const handlePostReview = () => {
    console.log('Post review with media...');
  };

  const handleApplyFilters = () => {
    console.log('Applying filters:', filters);
    setShowFilter(false);
  };

  const handleResetFilters = () => {
    setFilters({
      priceRange: '',
      category: '',
    });
  };

  const handleOpenMaps = () => {
    if (Platform.OS === 'web') {
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurantInfo.address)}`;
      if (typeof window !== 'undefined') {
        window.open(mapsUrl, '_blank');
      }
    } else {
      // Native platform handling
      console.log('Opening native maps...');
    }
  };

  return (
    <View style={styles.container}>
      {/* Map Section */}
      <View style={styles.mapContainer}>
        <MapViewComponent
          latitude={restaurantInfo.latitude}
          longitude={restaurantInfo.longitude}
          title={restaurantInfo.name}
          description={restaurantInfo.address}
        />
        
        {/* Header with Back Button, Search, and Filter */}
        <View style={styles.headerContainer}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={24} color="#000" />
          </TouchableOpacity>
          
          <View style={styles.searchFilterContainer}>
            <View style={styles.searchBar}>
              <Search size={20} color="#666" />
              <TextInput
                style={styles.searchInput}
                placeholder="地点・地域を検索"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
            <TouchableOpacity style={styles.filterIconButton} onPress={() => setShowFilter(true)}>
              <Filter size={20} color="#007AFF" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Bottom Sheet */}
      <View style={styles.bottomSheet}>
        {/* Handle */}
        <View style={styles.handle} />
        
        {/* Restaurant Header */}
        <View style={styles.restaurantHeader}>
          <Image source={{ uri: restaurantInfo.image }} style={styles.restaurantImage} />
          <View style={styles.restaurantInfo}>
            <Text style={styles.restaurantName}>{restaurantInfo.name}</Text>
            <View style={styles.ratingContainer}>
              {renderStars(restaurantInfo.rating)}
              <Text style={styles.ratingText}>{restaurantInfo.rating}</Text>
              <Text style={styles.reviewCount}>({restaurantInfo.reviewCount})</Text>
            </View>
            <Text style={styles.restaurantDescription}>{restaurantInfo.description}</Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          <TouchableOpacity style={styles.actionButton} onPress={handleMakeReservation}>
            <Calendar size={20} color="#007AFF" />
            <Text style={styles.actionButtonText}>予約する</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={handlePostReview}>
            <Camera size={20} color="#007AFF" />
            <Text style={styles.actionButtonText}>画像・動画投稿</Text>
          </TouchableOpacity>
        </View>

        {/* Tab Navigation */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'posts' && styles.activeTab]}
            onPress={() => setSelectedTab('posts')}
          >
            <Text style={[styles.tabText, selectedTab === 'posts' && styles.activeTabText]}>
              投稿 {foodPosts.length}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'info' && styles.activeTab]}
            onPress={() => setSelectedTab('info')}
          >
            <Text style={[styles.tabText, selectedTab === 'info' && styles.activeTabText]}>
              店舗情報
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {selectedTab === 'posts' ? (
            <FlatList
              data={foodPosts}
              renderItem={renderFoodPost}
              numColumns={3}
              scrollEnabled={false}
              contentContainerStyle={styles.postsGrid}
              columnWrapperStyle={styles.postsRow}
            />
          ) : (
            <View style={styles.infoContent}>
              <View style={styles.infoItem}>
                <MapPin size={20} color="#666" />
                <Text style={styles.infoText}>{restaurantInfo.address}</Text>
              </View>
              <View style={styles.infoItem}>
                <Phone size={20} color="#666" />
                <Text style={styles.infoText}>{restaurantInfo.phone}</Text>
              </View>
              <View style={styles.infoItem}>
                <Clock size={20} color="#666" />
                <Text style={styles.infoText}>{restaurantInfo.hours}</Text>
              </View>
            </View>
          )}
        </ScrollView>
      </View>

      {/* Filter Modal */}
      <Modal
        visible={showFilter}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={styles.filterModalContainer}>
          <View style={styles.filterHeader}>
            <TouchableOpacity onPress={() => setShowFilter(false)}>
              <X size={24} color="#000" />
            </TouchableOpacity>
            <Text style={styles.filterTitle}>フィルター</Text>
            <TouchableOpacity onPress={handleResetFilters}>
              <Text style={styles.resetText}>リセット</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.filterContent}>
            {/* Price Range Filter */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>価格帯</Text>
              <View style={styles.filterOptions}>
                {priceRanges.map((range) => (
                  <TouchableOpacity
                    key={range}
                    style={[
                      styles.filterOption,
                      filters.priceRange === range && styles.filterOptionSelected
                    ]}
                    onPress={() => setFilters(prev => ({ 
                      ...prev, 
                      priceRange: prev.priceRange === range ? '' : range 
                    }))}
                  >
                    <Text style={[
                      styles.filterOptionText,
                      filters.priceRange === range && styles.filterOptionTextSelected
                    ]}>
                      {range}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Category Filter */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>料理カテゴリ</Text>
              <View style={styles.filterOptions}>
                {categories.map((category) => (
                  <TouchableOpacity
                    key={category}
                    style={[
                      styles.filterOption,
                      filters.category === category && styles.filterOptionSelected
                    ]}
                    onPress={() => setFilters(prev => ({ 
                      ...prev, 
                      category: prev.category === category ? '' : category 
                    }))}
                  >
                    <Text style={[
                      styles.filterOptionText,
                      filters.category === category && styles.filterOptionTextSelected
                    ]}>
                      {category}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>

          <View style={styles.filterFooter}>
            <TouchableOpacity style={styles.applyButton} onPress={handleApplyFilters}>
              <Text style={styles.applyButtonText}>適用</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  mapContainer: {
    height: height * 0.4,
    position: 'relative',
  },
  headerContainer: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 20,
    padding: 8,
  },
  searchFilterContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#000',
  },
  filterIconButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 20,
    padding: 12,
  },
  bottomSheet: {
    flex: 1,
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: -20,
    paddingTop: 8,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#DDD',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  restaurantHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  restaurantImage: {
    width: 80,
    height: 80,
    borderRadius: 12,
    marginRight: 16,
  },
  restaurantInfo: {
    flex: 1,
  },
  restaurantName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  starsContainer: {
    flexDirection: 'row',
    marginRight: 8,
  },
  ratingText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginRight: 4,
  },
  reviewCount: {
    fontSize: 14,
    color: '#666',
  },
  restaurantDescription: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  actionButtons: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F8FF',
    paddingVertical: 12,
    borderRadius: 8,
  },
  actionButtonText: {
    fontSize: 14,
    color: '#007AFF',
    marginLeft: 8,
    fontWeight: '500',
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
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
  content: {
    flex: 1,
  },
  postsGrid: {
    padding: 2,
  },
  postsRow: {
    justifyContent: 'space-between',
  },
  foodPost: {
    width: (width - 8) / 3,
    height: ((width - 8) / 3) * (16 / 9),
    margin: 1,
    position: 'relative',
  },
  foodPostImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  foodPostOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: 8,
  },
  foodPostStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  foodPostLikes: {
    fontSize: 12,
    color: '#FFF',
    fontWeight: '600',
  },
  foodPostComments: {
    fontSize: 12,
    color: '#FFF',
  },
  infoContent: {
    padding: 16,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  infoText: {
    fontSize: 16,
    color: '#333',
    marginLeft: 12,
    flex: 1,
  },
  filterModalContainer: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  filterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  filterTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  resetText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '500',
  },
  filterContent: {
    flex: 1,
    padding: 16,
  },
  filterSection: {
    marginBottom: 24,
  },
  filterSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 12,
  },
  filterOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterOption: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#FFF',
  },
  filterOptionSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  filterOptionText: {
    fontSize: 14,
    color: '#666',
  },
  filterOptionTextSelected: {
    color: '#FFF',
    fontWeight: '500',
  },
  filterFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
  },
  applyButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
});