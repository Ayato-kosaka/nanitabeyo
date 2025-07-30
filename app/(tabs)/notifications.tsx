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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Heart, MessageCircle, UserPlus, AtSign, Share, MoveHorizontal as MoreHorizontal } from 'lucide-react-native';
import { NotificationItem } from '@/types';
import { notificationsData } from '@/data/notificationsData';

const { width } = Dimensions.get('window');

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<NotificationItem[]>(notificationsData);

  const getNotificationIcon = (type: NotificationItem['type']) => {
    const iconProps = { size: 20, color: '#FFFFFF' };
    
    switch (type) {
      case 'like':
        return <Heart {...iconProps} fill="#FFFFFF" />;
      case 'comment':
        return <MessageCircle {...iconProps} />;
      case 'follow':
        return <UserPlus {...iconProps} />;
      case 'mention':
        return <AtSign {...iconProps} />;
      case 'share':
        return <Share {...iconProps} />;
      default:
        return <Heart {...iconProps} />;
    }
  };

  const getIconBackgroundColor = (type: NotificationItem['type']) => {
    switch (type) {
      case 'like':
        return '#FF3040';
      case 'comment':
        return '#007AFF';
      case 'follow':
        return '#34C759';
      case 'mention':
        return '#FF9500';
      case 'share':
        return '#5856D6';
      default:
        return '#FF3040';
    }
  };

  const handleNotificationPress = (notification: NotificationItem) => {
    // Mark as read
    setNotifications(prev => 
      prev.map(item => 
        item.id === notification.id 
          ? { ...item, isRead: true }
          : item
      )
    );
    
    // Navigate to relevant content
    console.log('Navigate to:', notification);
  };

  const renderNotificationItem = (notification: NotificationItem) => {
    const iconBgColor = getIconBackgroundColor(notification.type);
    
    return (
      <TouchableOpacity
        key={notification.id}
        style={[
          styles.notificationItem,
          !notification.isRead && styles.unreadNotification
        ]}
        onPress={() => handleNotificationPress(notification)}
        activeOpacity={0.7}
      >
        {/* Left: Avatar with Action Icon */}
        <View style={styles.avatarContainer}>
          <Image 
            source={{ uri: notification.user.avatar }} 
            style={styles.avatar}
          />
          <View style={[styles.actionIcon, { backgroundColor: iconBgColor }]}>
            {getNotificationIcon(notification.type)}
          </View>
        </View>

        {/* Center: Message Content */}
        <View style={styles.messageContainer}>
          <Text style={styles.messageText} numberOfLines={2}>
            <Text style={styles.username}>{notification.user.username}</Text>
            <Text style={styles.message}> {notification.message}</Text>
          </Text>
          <Text style={styles.timestamp}>{notification.timestamp} ago</Text>
        </View>

        {/* Right: Post Thumbnail or More Options */}
        <View style={styles.rightContainer}>
          {notification.postThumbnail ? (
            <Image 
              source={{ uri: notification.postThumbnail }} 
              style={styles.postThumbnail}
            />
          ) : (
            <TouchableOpacity style={styles.moreButton}>
              <MoreHorizontal size={20} color="#666" />
            </TouchableOpacity>
          )}
        </View>

        {/* Unread Indicator */}
        {!notification.isRead && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    );
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <LinearGradient colors={['#FFFFFF', '#F8F9FA']} style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>通知</Text>
        {unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
          </View>
        )}
      </View>

      {/* Notifications List */}
      <ScrollView 
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {notifications.map(renderNotificationItem)}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#000',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  unreadBadge: {
    position: 'absolute',
    right: 16,
    backgroundColor: '#5EA2FF',
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 24,
    alignItems: 'center',
    shadowColor: '#5EA2FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  unreadBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  notificationItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  unreadNotification: {
    borderWidth: 2,
    borderColor: '#5EA2FF',
    shadowColor: '#5EA2FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 6,
  },
  notificationContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F8F9FA',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  actionIcon: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  messageContainer: {
    flex: 1,
    marginRight: 12,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 4,
  },
  username: {
    fontWeight: '700',
    color: '#1A1A1A',
    letterSpacing: -0.2,
  },
  message: {
    color: '#6B7280',
    fontWeight: '400',
  },
  timestamp: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  rightContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  postThumbnail: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: '#F8F9FA',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  moreButton: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#F8F9FA',
  },
  unreadDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#5EA2FF',
    shadowColor: '#5EA2FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 4,
  },
});