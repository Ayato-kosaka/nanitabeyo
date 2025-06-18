import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  SafeAreaView,
  Modal,
  TextInput,
} from 'react-native';
import {
  Heart,
  Bookmark,
  MoveVertical as MoreVertical,
  MapPin,
  Calendar,
  Share,
  Star,
  User,
  Filter,
  X,
} from 'lucide-react-native';
import { FoodItem, Comment } from '@/types';
import { router } from 'expo-router';

const { width, height } = Dimensions.get('window');

interface FoodContentScreenProps {
  item: FoodItem;
  onLike: () => void;
  onSave: () => void;
  onAddComment: (text: string) => void;
}

interface FilterOptions {
  location: string;
  priceRange: string;
  category: string;
}

const formatLikeCount = (count: number): string => {
  if (count >= 1000000) {
    return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (count >= 1000) {
    return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return count.toString();
};

export default function FoodContentScreen({
  item,
  onLike,
  onSave,
  onAddComment,
}: FoodContentScreenProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [commentLikes, setCommentLikes] = useState<{
    [key: string]: { isLiked: boolean; count: number };
  }>({});
  const [filters, setFilters] = useState<FilterOptions>({
    location: '',
    priceRange: '',
    category: '',
  });
  const scrollViewRef = useRef<ScrollView>(null);

  const handleCommentLike = (commentId: string) => {
    setCommentLikes((prev) => ({
      ...prev,
      [commentId]: {
        isLiked: !prev[commentId]?.isLiked,
        count: prev[commentId]?.isLiked
          ? (prev[commentId]?.count || 0) - 1
          : (prev[commentId]?.count || 0) + 1,
      },
    }));
  };

  const handleViewRestaurant = () => {
    router.push('/(home)/restaurant/1');
  };

  const handleViewCreator = () => {
    // Navigate to creator's profile
    router.push('/profile?userId=creator_123');
  };

  const handleApplyFilters = () => {
    console.log('Applying filters:', filters);
    setShowFilter(false);
  };

  const handleResetFilters = () => {
    setFilters({
      location: '',
      priceRange: '',
      category: '',
    });
  };

  const menuOptions = [
    { icon: User, label: 'View Creator', onPress: handleViewCreator },
    { icon: Share, label: 'Share', onPress: () => console.log('Share') },
    {
      icon: Calendar,
      label: 'Make Reservation',
      onPress: () => console.log('Reservation'),
    },
  ];

  const priceRanges = [
    '¥1,000以下',
    '¥1,000-3,000',
    '¥3,000-5,000',
    '¥5,000以上',
  ];
  const categories = [
    '和食',
    'イタリアン',
    'フレンチ',
    '中華',
    'アジア料理',
    'その他',
  ];

  const renderStars = (count: number, filled: number) => {
    return (
      <View style={styles.starsContainer}>
        {[...Array(count)].map((_, index) => (
          <Star
            key={index}
            size={16}
            color="#FFD700"
            fill={index < filled ? '#FFD700' : 'transparent'}
          />
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Background Image */}
      <Image source={{ uri: item.image }} style={styles.backgroundImage} />

      {/* Gradient Overlay */}
      <View style={styles.gradientOverlay} />

      {/* Top Header */}
      <View style={styles.topHeader}>
        <View style={styles.headerLeft}>
          <Text style={styles.menuName}>{item.name}</Text>
          <View style={styles.priceRatingContainer}>
            <Text style={styles.price}>¥2,800</Text>
            <View style={styles.ratingContainer}>
              {renderStars(5, 4)}
              <Text style={styles.reviewCount}>(127)</Text>
            </View>
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => setShowFilter(true)}
          >
            <Filter size={20} color="#000" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.viewRestaurantButton}
            onPress={handleViewRestaurant}
          >
            <Text style={styles.viewRestaurantButtonText}>店を見る</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Comments Section */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.commentsContainer}
        showsVerticalScrollIndicator={false}
      >
        {item.comments.map((comment) => {
          const commentLikeData = commentLikes[comment.id] || {
            isLiked: false,
            count: 0,
          };
          return (
            <View key={comment.id} style={styles.commentItem}>
              <View style={styles.commentHeader}>
                <Text style={styles.commentUsername}>{comment.username}</Text>
                <Text style={styles.commentTimestamp}>{comment.timestamp}</Text>
              </View>
              <View style={styles.commentContent}>
                <Text style={styles.commentText}>{comment.text}</Text>
                <View style={styles.commentActions}>
                  <TouchableOpacity
                    style={styles.commentLikeButton}
                    onPress={() => handleCommentLike(comment.id)}
                  >
                    <Heart
                      size={14}
                      color={commentLikeData.isLiked ? '#FF3040' : '#CCCCCC'}
                      fill={commentLikeData.isLiked ? '#FF3040' : 'transparent'}
                    />
                  </TouchableOpacity>
                  {commentLikeData.count > 0 && (
                    <Text style={styles.commentLikeCount}>
                      {commentLikeData.count}
                    </Text>
                  )}
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Bottom Section */}
      <View style={styles.bottomSection}>
        <View style={styles.actionRow}>
          {/* Action Buttons */}
          <View style={styles.rightActions}>
            <View style={styles.heartContainer}>
              <TouchableOpacity style={styles.actionButton} onPress={onLike}>
                <Heart
                  size={28}
                  color={item.isLiked ? '#FF3040' : '#FFFFFF'}
                  fill={item.isLiked ? '#FF3040' : 'transparent'}
                />
              </TouchableOpacity>
              <Text style={styles.likesCount}>
                {formatLikeCount(item.likes)}
              </Text>
            </View>

            <TouchableOpacity style={styles.actionButton} onPress={onSave}>
              <Bookmark
                size={28}
                color={item.isSaved ? '#FFFFFF' : '#FFFFFF'}
                fill={item.isSaved ? '#FFFFFF' : 'transparent'}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setShowMenu(true)}
            >
              <MoreVertical size={28} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
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
            {/* Location Filter */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>検索中心地</Text>
              <TextInput
                style={styles.filterInput}
                placeholder="地域を入力してください"
                value={filters.location}
                onChangeText={(text) =>
                  setFilters((prev) => ({ ...prev, location: text }))
                }
              />
            </View>

            {/* Price Range Filter */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>価格帯</Text>
              <View style={styles.filterOptions}>
                {priceRanges.map((range) => (
                  <TouchableOpacity
                    key={range}
                    style={[
                      styles.filterOption,
                      filters.priceRange === range &&
                        styles.filterOptionSelected,
                    ]}
                    onPress={() =>
                      setFilters((prev) => ({
                        ...prev,
                        priceRange: prev.priceRange === range ? '' : range,
                      }))
                    }
                  >
                    <Text
                      style={[
                        styles.filterOptionText,
                        filters.priceRange === range &&
                          styles.filterOptionTextSelected,
                      ]}
                    >
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
                      filters.category === category &&
                        styles.filterOptionSelected,
                    ]}
                    onPress={() =>
                      setFilters((prev) => ({
                        ...prev,
                        category: prev.category === category ? '' : category,
                      }))
                    }
                  >
                    <Text
                      style={[
                        styles.filterOptionText,
                        filters.category === category &&
                          styles.filterOptionTextSelected,
                      ]}
                    >
                      {category}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>

          <View style={styles.filterFooter}>
            <TouchableOpacity
              style={styles.applyButton}
              onPress={handleApplyFilters}
            >
              <Text style={styles.applyButtonText}>適用</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Menu Modal */}
      <Modal
        visible={showMenu}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowMenu(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowMenu(false)}
        >
          <View style={styles.menuContainer}>
            {menuOptions.map((option, index) => (
              <TouchableOpacity
                key={index}
                style={styles.menuItem}
                onPress={() => {
                  option.onPress();
                  setShowMenu(false);
                }}
              >
                <option.icon size={20} color="#FFFFFF" />
                <Text style={styles.menuItemText}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  backgroundImage: {
    position: 'absolute',
    width: width,
    height: height,
    resizeMode: 'cover',
  },
  gradientOverlay: {
    position: 'absolute',
    width: width,
    height: height,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  topHeader: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    zIndex: 10,
  },
  headerLeft: {
    flex: 1,
    marginRight: 16,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: 8,
    borderRadius: 20,
  },
  menuName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    marginBottom: 4,
  },
  priceRatingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  price: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 2,
  },
  reviewCount: {
    fontSize: 14,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  viewRestaurantButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  viewRestaurantButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  commentsContainer: {
    position: 'absolute',
    top: height * 0.4,
    bottom: 0,
    left: 0,
    width: width * 0.7,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  commentItem: {
    marginBottom: 12,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  commentUsername: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    marginRight: 8,
  },
  commentTimestamp: {
    fontSize: 11,
    color: '#CCCCCC',
  },
  commentContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  commentText: {
    fontSize: 13,
    color: '#FFFFFF',
    lineHeight: 18,
    flex: 1,
    marginRight: 8,
  },
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  commentLikeButton: {
    marginRight: 6,
  },
  commentLikeCount: {
    fontSize: 11,
    color: '#CCCCCC',
  },
  bottomSection: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
  rightActions: {
    alignItems: 'center',
    gap: 16,
  },
  heartContainer: {
    alignItems: 'center',
  },
  actionButton: {
    padding: 4,
  },
  likesCount: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    marginTop: 2,
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
  filterInput: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    borderRadius: 12,
    padding: 8,
    minWidth: 200,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  menuItemText: {
    fontSize: 16,
    color: '#FFFFFF',
    marginLeft: 12,
  },
});
