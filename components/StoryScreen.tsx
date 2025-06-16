import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { Heart, Bookmark, MoreVertical, Send, MapPin, Calendar, Menu, Share, Star, Camera, Video } from 'lucide-react-native';
import { FoodItem, Comment } from '@/types';
import { router } from 'expo-router';

const { width, height } = Dimensions.get('window');

interface StoryScreenProps {
  item: FoodItem;
  onLike: () => void;
  onSave: () => void;
  onAddComment: (text: string) => void;
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

export default function StoryScreen({ item, onLike, onSave, onAddComment }: StoryScreenProps) {
  const [reviewText, setReviewText] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [rating, setRating] = useState(0);
  const [showMediaOptions, setShowMediaOptions] = useState(false);
  const [commentLikes, setCommentLikes] = useState<{[key: string]: { isLiked: boolean, count: number }}>({});
  const scrollViewRef = useRef<ScrollView>(null);

  const handleAddReview = () => {
    if (reviewText.trim() && rating > 0) {
      onAddComment(reviewText.trim());
      setReviewText('');
      setRating(0);
    }
  };

  const handleCommentLike = (commentId: string) => {
    setCommentLikes(prev => ({
      ...prev,
      [commentId]: {
        isLiked: !prev[commentId]?.isLiked,
        count: prev[commentId]?.isLiked 
          ? (prev[commentId]?.count || 0) - 1 
          : (prev[commentId]?.count || 0) + 1
      }
    }));
  };

  const handleViewRestaurant = () => {
    router.push('/restaurant/1');
  };

  const menuOptions = [
    { icon: Share, label: 'Share', onPress: () => console.log('Share') },
    { icon: Calendar, label: 'Make Reservation', onPress: () => console.log('Reservation') },
    { icon: Menu, label: 'View Menu', onPress: () => console.log('Menu') },
    { icon: MapPin, label: 'Open in Google Maps', onPress: () => console.log('Maps') },
  ];

  const renderStars = (count: number, filled: number, onPress?: (index: number) => void) => {
    return (
      <View style={styles.starsContainer}>
        {[...Array(count)].map((_, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => onPress?.(index + 1)}
            disabled={!onPress}
          >
            <Star
              size={onPress ? 24 : 16}
              color="#FFD700"
              fill={index < filled ? "#FFD700" : "transparent"}
            />
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        style={styles.container} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
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
          <TouchableOpacity style={styles.viewRestaurantButton} onPress={handleViewRestaurant}>
            <Text style={styles.viewRestaurantButtonText}>店を見る</Text>
          </TouchableOpacity>
        </View>

        {/* Comments Section */}
        <ScrollView 
          ref={scrollViewRef}
          style={styles.commentsContainer}
          showsVerticalScrollIndicator={false}
        >
          {item.comments.map((comment) => {
            const commentLikeData = commentLikes[comment.id] || { isLiked: false, count: 0 };
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
                      <Text style={styles.commentLikeCount}>{commentLikeData.count}</Text>
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
            {/* Review Input Section */}
            <View style={styles.reviewInputContainer}>
              <View style={styles.reviewHeader}>
                <Text style={styles.reviewLabel}>レビューを投稿</Text>
                {renderStars(5, rating, setRating)}
              </View>
              
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.reviewInput}
                  placeholder="レビューを書く..."
                  placeholderTextColor="#999"
                  value={reviewText}
                  onChangeText={setReviewText}
                  multiline
                />
                <TouchableOpacity 
                  style={styles.mediaButton}
                  onPress={() => setShowMediaOptions(true)}
                >
                  <Camera size={20} color="#666" />
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.sendButton, (reviewText.trim() && rating > 0) && styles.sendButtonActive]} 
                  onPress={handleAddReview}
                  disabled={!reviewText.trim() || rating === 0}
                >
                  <Send size={20} color={(reviewText.trim() && rating > 0) ? '#007AFF' : '#999'} />
                </TouchableOpacity>
              </View>
            </View>
            
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
                <Text style={styles.likesCount}>{formatLikeCount(item.likes)}</Text>
              </View>
              
              <TouchableOpacity style={styles.actionButton} onPress={onSave}>
                <Bookmark 
                  size={28} 
                  color={item.isSaved ? '#FFFFFF' : '#FFFFFF'} 
                  fill={item.isSaved ? '#FFFFFF' : 'transparent'}
                />
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.actionButton} onPress={() => setShowMenu(true)}>
                <MoreVertical size={28} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Media Options Modal */}
        <Modal
          visible={showMediaOptions}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowMediaOptions(false)}
        >
          <TouchableOpacity 
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowMediaOptions(false)}
          >
            <View style={styles.mediaOptionsContainer}>
              <TouchableOpacity style={styles.mediaOption}>
                <Camera size={24} color="#FFFFFF" />
                <Text style={styles.mediaOptionText}>写真を撮る</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.mediaOption}>
                <Video size={24} color="#FFFFFF" />
                <Text style={styles.mediaOptionText}>動画を撮る</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
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
      </KeyboardAvoidingView>
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
    top: height * 0.2,
    bottom: 140,
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
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  reviewInputContainer: {
    flex: 1,
    marginRight: 16,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  reviewLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  reviewInput: {
    flex: 1,
    fontSize: 16,
    color: '#FFFFFF',
    maxHeight: 80,
    marginRight: 8,
  },
  mediaButton: {
    padding: 8,
    marginRight: 4,
  },
  sendButton: {
    padding: 8,
  },
  sendButtonActive: {
    backgroundColor: 'rgba(0, 122, 255, 0.2)',
    borderRadius: 16,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaOptionsContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    borderRadius: 12,
    padding: 8,
    minWidth: 200,
  },
  mediaOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  mediaOptionText: {
    fontSize: 16,
    color: '#FFFFFF',
    marginLeft: 12,
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