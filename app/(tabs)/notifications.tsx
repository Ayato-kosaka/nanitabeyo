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
import { 
  Heart, 
  MessageCircle, 
  UserPlus, 
  AtSign, 
  Share,
  MoreHorizontal
} from 'lucide-react-native';
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
    <SafeAreaView style={styles.container}>
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
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    position: 'relative',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  unreadBadge: {
    position: 'absolute',
    right: 16,
    backgroundColor: '#FF3040',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 24,
    alignItems: 'center',
  },
  unreadBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#000',
    borderBottomWidth: 0.5,
    borderBottomColor: '#333',
    position: 'relative',
  },
  unreadNotification: {
    backgroundColor: '#111',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#333',
  },
  actionIcon: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  messageContainer: {
    flex: 1,
    marginRight: 12,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  username: {
    fontWeight: '600',
    color: '#FFFFFF',
  },
  message: {
    color: '#CCCCCC',
  },
  timestamp: {
    fontSize: 12,
    color: '#666',
  },
  rightContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  postThumbnail: {
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#333',
  },
  moreButton: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadDot: {
    position: 'absolute',
    left: 8,
    top: '50%',
    marginTop: -3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#007AFF',
  },
});