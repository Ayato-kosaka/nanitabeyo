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
import {
  ArrowLeft,
  MoveHorizontal as MoreHorizontal,
  Share,
  CreditCard as Edit3,
  Play,
  Heart,
  MessageCircle,
  Eye,
  Lock,
  Grid3x3 as Grid3X3,
  Bookmark,
  X,
  Wallet,
  DollarSign,
} from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { UserProfile, UserPost } from '@/types';
import {
  userProfile,
  otherUserProfile,
  userPosts,
  savedPosts,
  likedPosts,
} from '@/data/profileData';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { NavigationContainer } from '@react-navigation/native';

const { width } = Dimensions.get('window');
const Tab = createMaterialTopTabNavigator();

type TabType = 'posts' | 'saved' | 'liked' | 'wallet';

interface BidItem {
  id: string;
  restaurantName: string;
  bidAmount: number;
  remainingDays: number;
  status: 'active' | 'completed' | 'refunded';
  imageUrl: string;
}

interface EarningItem {
  id: string;
  dishName: string;
  earnings: number;
  status: 'paid' | 'pending';
  imageUrl: string;
}

// Mock data for bids
const mockBids: BidItem[] = [
  {
    id: '1',
    restaurantName: 'Bella Vista Restaurant',
    bidAmount: 15000,
    remainingDays: 12,
    status: 'active',
    imageUrl:
      'https://images.pexels.com/photos/262978/pexels-photo-262978.jpeg?auto=compress&cs=tinysrgb&w=300',
  },
  {
    id: '2',
    restaurantName: 'Tokyo Ramen House',
    bidAmount: 8000,
    remainingDays: 5,
    status: 'active',
    imageUrl:
      'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=300',
  },
];

// Mock data for earnings
const mockEarnings: EarningItem[] = [
  {
    id: '1',
    dishName: 'Truffle Pasta',
    earnings: 2400,
    status: 'paid',
    imageUrl:
      'https://images.pexels.com/photos/4518843/pexels-photo-4518843.jpeg?auto=compress&cs=tinysrgb&w=300',
  },
  {
    id: '2',
    dishName: 'Wagyu Steak',
    earnings: 3200,
    status: 'paid',
    imageUrl:
      'https://images.pexels.com/photos/3535383/pexels-photo-3535383.jpeg?auto=compress&cs=tinysrgb&w=300',
  },
  {
    id: '3',
    dishName: 'Chocolate Soufflé',
    earnings: 1800,
    status: 'pending',
    imageUrl:
      'https://images.pexels.com/photos/3026804/pexels-photo-3026804.jpeg?auto=compress&cs=tinysrgb&w=300',
  },
  {
    id: '4',
    dishName: 'Caesar Salad',
    earnings: 1200,
    status: 'paid',
    imageUrl:
      'https://images.pexels.com/photos/2097090/pexels-photo-2097090.jpeg?auto=compress&cs=tinysrgb&w=300',
  },
];

function DepositsScreen() {
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    'active',
    'completed',
    'refunded',
  ]);

  const depositStatuses = [
    { id: 'active', label: 'アクティブ', color: '#4CAF50' },
    { id: 'completed', label: '完了', color: '#2196F3' },
    { id: 'refunded', label: '返金済み', color: '#FF9800' },
  ];

  const toggleStatus = (statusId: string) => {
    setSelectedStatuses((prev) =>
      prev.includes(statusId)
        ? prev.filter((id) => id !== statusId)
        : [...prev, statusId]
    );
  };

  const filteredBids = mockBids.filter((bid) =>
    selectedStatuses.includes(bid.status)
  );

  const renderBidItem = ({ item }: { item: BidItem }) => (
    <View style={styles.depositCard}>
      <View style={styles.depositHeader}>
        <Text style={styles.depositRestaurantName}>{item.restaurantName}</Text>
        <View
          style={[
            styles.statusChip,
            { backgroundColor: getStatusColor(item.status) },
          ]}
        >
          <Text style={styles.statusText}>{getStatusText(item.status)}</Text>
        </View>
      </View>
      <Text style={styles.depositAmount}>
        ¥{item.bidAmount.toLocaleString()}
      </Text>
      <Text style={styles.depositDays}>残り{item.remainingDays}日</Text>
    </View>
  );

  const getStatusColor = (status: string) => {
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

  const getStatusText = (status: string) => {
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

  return (
    <View style={styles.tabContent}>
      {/* Status Filter Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.statusFilterContainer}
        contentContainerStyle={styles.statusFilterContent}
      >
        {depositStatuses.map((status) => (
          <TouchableOpacity
            key={status.id}
            style={[
              styles.statusFilterChip,
              selectedStatuses.includes(status.id) && {
                backgroundColor: status.color,
              },
            ]}
            onPress={() => toggleStatus(status.id)}
          >
            <Text
              style={[
                styles.statusFilterChipText,
                selectedStatuses.includes(status.id) &&
                  styles.statusFilterChipTextActive,
              ]}
            >
              {status.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Filtered Results */}
      {filteredBids.length > 0 ? (
        <FlatList
          data={filteredBids}
          renderItem={renderBidItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.depositsList}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>
            選択したステータスの入札がありません
          </Text>
        </View>
      )}
    </View>
  );
}

function EarningsScreen() {
  const [selectedEarningStatuses, setSelectedEarningStatuses] = useState<
    string[]
  >(['paid', 'pending']);

  const earningStatuses = [
    { id: 'paid', label: '支払済み', color: '#4CAF50' },
    { id: 'pending', label: '保留中', color: '#FF9800' },
  ];

  const toggleEarningStatus = (statusId: string) => {
    setSelectedEarningStatuses((prev) =>
      prev.includes(statusId)
        ? prev.filter((id) => id !== statusId)
        : [...prev, statusId]
    );
  };

  const filteredEarnings = mockEarnings.filter((earning) =>
    selectedEarningStatuses.includes(earning.status)
  );

  const renderEarningItem = ({ item }: { item: EarningItem }) => (
    <TouchableOpacity style={styles.earningCard}>
      <Image source={{ uri: item.imageUrl }} style={styles.earningCardImage} />
      <View style={styles.earningCardOverlay}>
        <Text style={styles.earningCardTitle}>{item.dishName}</Text>
        <Text style={styles.earningCardAmount}>
          ¥{item.earnings.toLocaleString()}
        </Text>
        <View
          style={[
            styles.statusChip,
            {
              backgroundColor: item.status === 'paid' ? '#4CAF50' : '#FF9800',
            },
          ]}
        >
          <Text style={styles.statusText}>
            {item.status === 'paid' ? '支払済み' : '保留中'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.tabContent}>
      {/* Status Filter Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.statusFilterContainer}
        contentContainerStyle={styles.statusFilterContent}
      >
        {earningStatuses.map((status) => (
          <TouchableOpacity
            key={status.id}
            style={[
              styles.statusFilterChip,
              selectedEarningStatuses.includes(status.id) && {
                backgroundColor: status.color,
              },
            ]}
            onPress={() => toggleEarningStatus(status.id)}
          >
            <Text
              style={[
                styles.statusFilterChipText,
                selectedEarningStatuses.includes(status.id) &&
                  styles.statusFilterChipTextActive,
              ]}
            >
              {status.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Filtered Results */}
      {filteredEarnings.length > 0 ? (
        <FlatList
          data={filteredEarnings}
          renderItem={renderEarningItem}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.earningsGrid}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>
            選択したステータスの収益がありません
          </Text>
        </View>
      )}
    </View>
  );
}

function WalletTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: '#CCCCCC',
        tabBarStyle: {
          backgroundColor: '#000',
        },
        tabBarIndicatorStyle: {
          backgroundColor: '#FFFFFF',
        },
      }}
    >
      <Tab.Screen
        name="Deposits"
        component={DepositsScreen}
        options={{
          tabBarLabel: '入札',
          tabBarIcon: ({ color }) => <Wallet size={20} color={color} />,
        }}
      />
      <Tab.Screen
        name="Earnings"
        component={EarningsScreen}
        options={{
          tabBarLabel: '収益',
          tabBarIcon: ({ color }) => <DollarSign size={20} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

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

  // Add wallet tab for own profile
  const availableTabs: TabType[] = isOwnProfile
    ? ['posts', 'saved', 'liked', 'wallet']
    : ['posts'];

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
      case 'wallet':
        return [];
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
    router.push(`/(tabs)/profile/food?startIndex=${index}`);
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
        return (
          <Bookmark
            size={20}
            color={iconColor}
            fill={isActive ? iconColor : 'transparent'}
          />
        );
      case 'wallet':
        return (
          <Wallet
            size={20}
            color={iconColor}
            fill={isActive ? iconColor : 'transparent'}
          />
        );
      case 'liked':
        return (
          <Heart
            size={20}
            color={iconColor}
            fill={isActive ? iconColor : 'transparent'}
          />
        );
    }
  };

  const getTabLabel = (tab: TabType): string => {
    switch (tab) {
      case 'posts':
        return `投稿 ${formatNumber(profile.postsCount)}`;
      case 'saved':
        return '保存済み';
      case 'wallet':
        return 'ウォレット';
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
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
          >
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
                <Text style={styles.statNumber}>
                  {formatNumber(profile.followingCount)}
                </Text>
                <Text style={styles.statLabel}>フォロー中</Text>
              </View>
              <View style={styles.statColumn}>
                <Text style={styles.statNumber}>
                  {formatNumber(profile.followersCount)}
                </Text>
                <Text style={styles.statLabel}>フォロワー</Text>
              </View>
              <View style={styles.statColumn}>
                <Text style={styles.statNumber}>
                  {formatNumber(profile.totalLikes)}
                </Text>
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
                <TouchableOpacity
                  style={styles.editButton}
                  onPress={handleEditProfile}
                >
                  <Edit3 size={16} color="#FFFFFF" />
                  <Text style={styles.editButtonText}>プロフィールを編集</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.shareButton}
                  onPress={handleShareProfile}
                >
                  <Share size={16} color="#FFFFFF" />
                  <Text style={styles.shareButtonText}>
                    プロフィールをシェア
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={[
                    styles.followButton,
                    isFollowing && styles.followingButton,
                  ]}
                  onPress={handleFollow}
                >
                  <Text
                    style={[
                      styles.followButtonText,
                      isFollowing && styles.followingButtonText,
                    ]}
                  >
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
          {availableTabs.map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, selectedTab === tab && styles.activeTab]}
              onPress={() => setSelectedTab(tab)}
            >
              {renderTabIcon(tab)}
              <Text
                style={[
                  styles.tabText,
                  selectedTab === tab && styles.activeTabText,
                ]}
              >
                {getTabLabel(tab)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Posts Grid */}
        <View style={styles.postsContainer}>
          {selectedTab === 'wallet' ? (
            <WalletTabs />
          ) : selectedTab === 'saved' && !isOwnProfile ? (
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
  tabContent: {
    backgroundColor: '#000',
  },
  depositsList: {
    padding: 16,
  },
  depositCard: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  depositHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  depositRestaurantName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    flex: 1,
  },
  depositAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginBottom: 4,
  },
  depositDays: {
    fontSize: 14,
    color: '#CCCCCC',
  },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  earningsGrid: {
    padding: 16,
  },
  earningCard: {
    flex: 1,
    aspectRatio: 9 / 16,
    borderRadius: 12,
    margin: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  earningCardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  earningCardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 8,
  },
  earningCardTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFF',
    flex: 1,
    marginRight: 8,
  },
  earningCardAmount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFF',
  },
  statusFilterContainer: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  statusFilterContent: {
    gap: 8,
  },
  statusFilterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginHorizontal: 4,
  },
  statusFilterChipText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  statusFilterChipTextActive: {
    color: '#FFF',
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
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
