import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Pencil as Edit3, MessageCircle } from 'lucide-react-native';
import { Card } from '@/components/Card';
import { PrimaryButton } from '@/components/PrimaryButton';
import i18n from '@/lib/i18n';

interface ProfileHeaderProps {
  profile: {
    avatar: string;
    displayName: string;
    bio: string;
    followingCount: number;
    followersCount: number;
    totalLikes: number;
    isFollowing?: boolean;
  };
  isOwnProfile: boolean;
  isFollowing: boolean;
  onEditProfile: () => void;
  onFollow: () => void;
  onLayout?: (event: any) => void;
}

export function ProfileHeader({ 
  profile, 
  isOwnProfile, 
  isFollowing, 
  onEditProfile, 
  onFollow,
  onLayout 
}: ProfileHeaderProps) {
  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1).replace(/\.0$/, '') + i18n.t('Profile.numberSuffix.million');
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1).replace(/\.0$/, '') + i18n.t('Profile.numberSuffix.thousand');
    }
    return num.toString();
  };

  return (
    <Card onLayout={onLayout}>
      {/* Avatar and Stats */}
      <View style={styles.profileHeader}>
        <Image source={{ uri: profile.avatar }} style={styles.avatar} />

        <View style={styles.statsContainer}>
          <View style={styles.statColumn}>
            <Text style={styles.statNumber}>{formatNumber(profile.followingCount)}</Text>
            <Text style={styles.statLabel}>{i18n.t('Profile.stats.following')}</Text>
          </View>
          <View style={styles.statColumn}>
            <Text style={styles.statNumber}>{formatNumber(profile.followersCount)}</Text>
            <Text style={styles.statLabel}>{i18n.t('Profile.stats.followers')}</Text>
          </View>
          <View style={styles.statColumn}>
            <Text style={styles.statNumber}>{formatNumber(profile.totalLikes)}</Text>
            <Text style={styles.statLabel}>{i18n.t('Profile.stats.likes')}</Text>
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
            <PrimaryButton
              style={{ flex: 1 }}
              onPress={onEditProfile}
              label={i18n.t('Profile.buttons.editProfile')}
              icon={<Edit3 size={16} color="#FFFFFF" />}
            />
          </>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.followButton, isFollowing && styles.followingButton]}
              onPress={onFollow}>
              <Text style={[styles.followButtonText, isFollowing && styles.followingButtonText]}>
                {isFollowing ? i18n.t('Profile.buttons.following') : i18n.t('Profile.buttons.follow')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.messageButton}>
              <MessageCircle size={16} color="#FFFFFF" />
              <Text style={styles.messageButtonText}>{i18n.t('Profile.buttons.message')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
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
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  displayName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  bio: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 20,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  followButton: {
    flex: 1,
    backgroundColor: '#5EA2FF',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  followingButton: {
    backgroundColor: '#E5E5E5',
  },
  followButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  followingButtonText: {
    color: '#666',
  },
  messageButton: {
    backgroundColor: '#34D399',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  messageButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});