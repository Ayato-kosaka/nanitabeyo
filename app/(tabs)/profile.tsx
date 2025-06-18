import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  SafeAreaView,
  Dimensions,
  FlatList,
  Modal,
  TextInput,
} from 'react-native';
import { ArrowLeft, MoveHorizontal as MoreHorizontal, Share, CreditCard as Edit3, Play, Heart, MessageCircle, Eye, Lock, Grid3x3 as Grid3X3, Bookmark, X } from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { UserProfile, UserPost } from '@/types';
import { userProfile, otherUserProfile, userPosts, savedPosts, likedPosts } from '@/data/profileData';

const { width } = Dimensions.get('window');

type TabType = 'posts' | 'saved' | 'liked';

export default function ProfileScreen() {
  const { userId } = useLocalSearchParams();
  const [selectedTab, setSelectedTab] = useState<TabType>('posts');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editedBio, setEditedBio] = useState('');
  const [isFollowing, setIsFollowing] = useState(false);
  
  // Determine if this is the current user's profile or another user's
  const isOwnProfile = !userId || userId === userProfile.id;
  const profile = isOwnProfile ? userProfile : otherUserProfile;
  
  React.useEffect(() => {
    if (profile && !isOwnProfile) {
      setIsFollowing(profile.isFollowing || false);
    }
  }, [profile, isOwnProfile]);

  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return num.toString();
  };

  const getCurrentPosts = (): UserPost[] => {
    switch (selectedTab) {
      case 'posts':
        return userPosts;
      case 'saved':
        return savedPosts;
      case 'liked':
        return likedPosts;
      default:
        return userPosts;
    }
  };

  const handleFollow = () => {
    setIsFollowing(!isFollowing);
  };

  const handleEditProfile = () => {
    setEditedBio(profile.bio);
    setShowEditModal(true);
  };

  const handleSaveProfile = () => {
    // In a real app, this would update the profile via API
    console.log('Saving profile with bio:', editedBio);
    setShowEditModal(false);
  };

  const handleShareProfile = () => {
    console.log('Sharing profile:', profile.username);
  };

  const handlePostPress = (index: number) => {
    router.push(`/(tabs)/(home)/food?startIndex=${index}`);
  };

  const renderPost = ({ item, index }: { item: UserPost; index: number }) => (
    <TouchableOpacity
      style={styles.postItem}
      onPress={() => handlePostPress(index)}
      activeOpacity={0.9}
    >
      <Image source={{ uri: item.image }} style={styles.postImage} />
      
      {/* Video duration overlay */}
      {item.duration && (
        <View style={styles.durationOverlay}>
          <Text style={styles.durationText}>{item.duration}</Text>
        </View>
      )}
      
      {/* Play icon overlay */}
      <View style={styles.playOverlay}>
        <Play size={20} color="#FFFFFF" fill="#FFFFFF" />
      </View>
      
      {/* Stats overlay */}
      <View style={styles.statsOverlay}>
        <View style={styles.statItem}>
          <Heart size={14} color="#FFFFFF" fill="#FFFFFF" />
          <Text style={styles.statText}>{formatNumber(item.likes)}</Text>
        </View>
        <View style={styles.statItem}>
          <MessageCircle size={14} color="#FFFFFF" />
          <Text style={styles.statText}>{formatNumber(item.comments)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderTabIcon = (tab: TabType) => {
    const isActive = selectedTab === tab;
    const iconColor = isActive ? '#FFFFFF' : '#666';
    
    switch (tab) {
      case 'posts':
        return <Grid3X3 size={20} color={iconColor} />;
      case 'saved':
        return <Bookmark size={20} color={iconColor} fill={isActive ? iconColor : 'transparent'} />;
      case 'liked':
        return <Heart size={20} color={iconColor} fill={isActive ? iconColor : 'transparent'} />;
    }
  };

  const getTabLabel = (tab: TabType): string => {
    switch (tab) {
      case 'posts':
        return `投稿 ${formatNumber(profile.postsCount)}`;
      case 'saved':
        return '保存済み';
      case 'liked':
        return 'いいね';
    }
  };

  const shouldShowTab = (tab: TabType): boolean => {
    if (isOwnProfile) return true;
    // For other users, only show posts tab
    return tab === 'posts';
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        {!isOwnProfile && (
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={24} color="#FFFFFF" />
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>{profile.username}</Text>
        <TouchableOpacity style={styles.moreButton}>
          <MoreHorizontal size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Profile Info */}
        <View style={styles.profileSection}>
          {/* Avatar and Stats */}
          <View style={styles.profileHeader}>
            <Image source={{ uri: profile.avatar }} style={styles.avatar} />
            
            <View style={styles.statsContainer}>
              <View style={styles.statColumn}>
                <Text style={styles.statNumber}>{formatNumber(profile.followingCount)}</Text>
                <Text style={styles.statLabel}>フォロー中</Text>
              </View>
              <View style={styles.statColumn}>
                <Text style={styles.statNumber}>{formatNumber(profile.followersCount)}</Text>
                <Text style={styles.statLabel}>フォロワー</Text>
              </View>
              <View style={styles.statColumn}>
                <Text style={styles.statNumber}>{formatNumber(profile.totalLikes)}</Text>
                <Text style={styles.statLabel}>いいね</Text>
              </View>
            </View>
          </View>

          {/* Display Name */}
          <Text style={styles.displayName}>{profile.displayName}</Text>

          {/* Bio */}
          <Text style={styles.bio}>{profile.bio}</Text>

          {/* Action Buttons */}
          <View style={styles.actionButtons}>
            {isOwnProfile ? (
              <>
                <TouchableOpacity style={styles.editButton} onPress={handleEditProfile}>
                  <Edit3 size={16} color="#FFFFFF" />
                  <Text style={styles.editButtonText}>プロフィールを編集</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.shareButton} onPress={handleShareProfile}>
                  <Share size={16} color="#FFFFFF" />
                  <Text style={styles.shareButtonText}>プロフィールをシェア</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity 
                  style={[styles.followButton, isFollowing && styles.followingButton]} 
                  onPress={handleFollow}
                >
                  <Text style={[styles.followButtonText, isFollowing && styles.followingButtonText]}>
                    {isFollowing ? 'フォロー中' : 'フォロー'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.messageButton}>
                  <MessageCircle size={16} color="#FFFFFF" />
                  <Text style={styles.messageButtonText}>メッセージ</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* Content Tabs */}
        <View style={styles.tabsContainer}>
          {(['posts', 'saved', 'liked'] as TabType[])
            .filter(shouldShowTab)
            .map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, selectedTab === tab && styles.activeTab]}
                onPress={() => setSelectedTab(tab)}
              >
                {renderTabIcon(tab)}
                <Text style={[styles.tabText, selectedTab === tab && styles.activeTabText]}>
                  {getTabLabel(tab)}
                </Text>
              </TouchableOpacity>
            ))}
        </View>

        {/* Posts Grid */}
        <View style={styles.postsContainer}>
          {selectedTab === 'saved' && !isOwnProfile ? (
            <View style={styles.privateSection}>
              <Lock size={48} color="#666" />
              <Text style={styles.privateText}>この内容は非公開です</Text>
            </View>
          ) : (
            <FlatList
              data={getCurrentPosts()}
              renderItem={renderPost}
              numColumns={3}
              scrollEnabled={false}
              contentContainerStyle={styles.postsGrid}
              columnWrapperStyle={styles.postsRow}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </ScrollView>

      {/* Edit Profile Modal */}
      <Modal
        visible={showEditModal}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowEditModal(false)}>
              <X size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>プロフィールを編集</Text>
            <TouchableOpacity onPress={handleSaveProfile}>
              <Text style={styles.saveText}>保存</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            <View style={styles.editSection}>
              <Text style={styles.editLabel}>自己紹介</Text>
              <TextInput
                style={styles.editInput}
                value={editedBio}
                onChangeText={setEditedBio}
                multiline
                numberOfLines={4}
                placeholder="自己紹介を入力してください..."
                placeholderTextColor="#666"
              />
            </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#333',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  moreButton: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  profileSection: {
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginRight: 20,
  },
  statsContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statColumn: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 12,
    color: '#CCCCCC',
  },
  displayName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  bio: {
    fontSize: 14,
    color: '#CCCCCC',
    lineHeight: 20,
    marginBottom: 16,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  editButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#333',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 6,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#333',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 6,
  },
  shareButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  followButton: {
    flex: 1,
    backgroundColor: '#FF3040',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  followingButton: {
    backgroundColor: '#333',
    borderWidth: 1,
    borderColor: '#666',
  },
  followButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  followingButtonText: {
    color: '#CCCCCC',
  },
  messageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#333',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 6,
  },
  messageButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  tabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#333',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#FFFFFF',
  },
  tabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  activeTabText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  postsContainer: {
    flex: 1,
    minHeight: 400,
  },
  privateSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  privateText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
  },
  postsGrid: {
    paddingTop: 2,
  },
  postsRow: {
    justifyContent: 'flex-start',
  },
  postItem: {
    width: (width - 4) / 3,
    height: ((width - 4) / 3) * (16 / 9),
    margin: 1,
    position: 'relative',
    backgroundColor: '#111',
  },
  postImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  durationOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  durationText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  playOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -10 }, { translateY: -10 }],
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 15,
    padding: 5,
  },
  statsOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#333',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  saveText: {
    fontSize: 16,
    color: '#FF3040',
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  editSection: {
    marginBottom: 24,
  },
  editLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  editInput: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: '#FFFFFF',
    backgroundColor: '#111',
    textAlignVertical: 'top',
    minHeight: 100,
  },
});