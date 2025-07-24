import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  ActivityIndicator,
  FlatList,
  Alert,
} from 'react-native';
import {
  MapPin,
  Search,
  Clock,
  Users,
  Heart,
  Plus,
  X,
  Navigation,
} from 'lucide-react-native';
import { router } from 'expo-router';
import {
  SearchParams,
  SearchLocation,
  GooglePlacesPrediction,
} from '@/types/search';
import { useLocationSearch } from '@/hooks/useLocationSearch';
import { useSnackbar } from '@/contexts/SnackbarProvider';

const timeSlots = [
  { id: 'morning', label: '朝食', icon: '🌅' },
  { id: 'lunch', label: 'ランチ', icon: '🌞' },
  { id: 'afternoon', label: 'カフェ', icon: '☕' },
  { id: 'dinner', label: 'ディナー', icon: '🌙' },
  { id: 'late_night', label: '夜食', icon: '🌃' },
] as const;

const sceneOptions = [
  { id: 'solo', label: 'おひとり様', icon: '👤' },
  { id: 'date', label: 'デート', icon: '💕' },
  { id: 'group', label: '複数人と', icon: '👥' },
  { id: 'large_group', label: '大人数', icon: '👥👥' },
  { id: 'tourism', label: '観光', icon: '🌍' },
] as const;

const moodOptions = [
  { id: 'hearty', label: 'がっつり', icon: '🍖' },
  { id: 'light', label: '軽めに', icon: '🥗' },
  { id: 'sweet', label: '甘いもの', icon: '🍰' },
  { id: 'spicy', label: '辛いもの', icon: '🌶️' },
  { id: 'healthy', label: 'ヘルシー志向', icon: '🥬' },
  { id: 'junk', label: 'ジャンク気分', icon: '🍔' },
  { id: 'alcohol', label: 'お酒メイン', icon: '🍺' },
] as const;

const restrictionOptions = [
  { id: 'vegetarian', label: 'ベジタリアン', icon: '🌱' },
  { id: 'gluten_free', label: 'グルテンフリー', icon: '🌾' },
  { id: 'dairy_free', label: '乳製品不使用', icon: '🥛' },
  { id: 'nut_allergy', label: 'ナッツアレルギー', icon: '🥜' },
  { id: 'seafood_allergy', label: '魚介アレルギー', icon: '🐟' },
];

export default function SearchScreen() {
  const [location, setLocation] = useState<SearchLocation | null>(null);
  const [locationQuery, setLocationQuery] = useState('');
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const [timeSlot, setTimeSlot] = useState<SearchParams['timeSlot']>('lunch');
  const [scene, setScene] = useState<SearchParams['scene'] | undefined>(
    undefined
  );
  const [mood, setMood] = useState<SearchParams['mood'] | undefined>(undefined);
  const [restrictions, setRestrictions] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const {
    suggestions,
    isSearching: isLocationSearching,
    searchLocations,
    getLocationDetails,
    getCurrentLocation,
  } = useLocationSearch();
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    // Auto-detect current location on mount
    getCurrentLocation().then(setLocation).catch(console.error);

    // Auto-set time slot based on current time
    const hour = new Date().getHours();
    if (hour < 10) setTimeSlot('morning');
    else if (hour < 15) setTimeSlot('lunch');
    else if (hour < 17) setTimeSlot('afternoon');
    else if (hour < 22) setTimeSlot('dinner');
    else setTimeSlot('late_night');
  }, [getCurrentLocation]);

  const handleLocationSearch = (query: string) => {
    setLocationQuery(query);
    if (query.length >= 2) {
      setShowLocationSuggestions(true);
      searchLocations(query);
    } else {
      setShowLocationSuggestions(false);
    }
  };

  const handleLocationSelect = async (prediction: GooglePlacesPrediction) => {
    try {
      const locationDetails = await getLocationDetails(prediction);
      setLocation(locationDetails);
      setLocationQuery(locationDetails.address);
      setShowLocationSuggestions(false);
    } catch (error) {
      showSnackbar('位置情報の取得に失敗しました');
    }
  };

  const handleUseCurrentLocation = async () => {
    try {
      const currentLocation = await getCurrentLocation();
      setLocation(currentLocation);
      setLocationQuery(currentLocation.address);
    } catch (error) {
      showSnackbar('現在地の取得に失敗しました');
    }
  };

  const toggleRestriction = (restrictionId: string) => {
    setRestrictions((prev) =>
      prev.includes(restrictionId)
        ? prev.filter((id) => id !== restrictionId)
        : [...prev, restrictionId]
    );
  };

  const handleSearch = async () => {
    if (!location) {
      showSnackbar('検索場所を選択してください');
      return;
    }

    setIsSearching(true);

    try {
      const searchParams: SearchParams = {
        location,
        timeSlot,
        scene,
        mood,
        restrictions,
      };

      // Navigate to cards screen with search parameters
      router.push({
        pathname: '/(tabs)/search/topics',
        params: {
          searchParams: JSON.stringify(searchParams),
        },
      });
    } catch (error) {
      showSnackbar('検索に失敗しました');
    } finally {
      setIsSearching(false);
    }
  };

  const renderLocationSuggestion = ({
    item,
  }: {
    item: GooglePlacesPrediction;
  }) => (
    <TouchableOpacity
      style={styles.suggestionItem}
      onPress={() => handleLocationSelect(item)}
    >
      <MapPin size={16} color="#666" />
      <View style={styles.suggestionText}>
        <Text style={styles.suggestionMain}>
          {item.structured_formatting.main_text}
        </Text>
        <Text style={styles.suggestionSecondary}>
          {item.structured_formatting.secondary_text}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>料理を探す</Text>
          <Text style={styles.headerSubtitle}>
            あなたにぴったりの料理を見つけましょう
          </Text>
        </View>

        {/* Location Input */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <MapPin size={16} color="#1976D2" /> 場所 *
          </Text>
          <View style={styles.locationInputContainer}>
            <TextInput
              style={styles.locationInput}
              placeholder="場所を入力してください"
              value={locationQuery}
              onChangeText={handleLocationSearch}
              onFocus={() =>
                locationQuery.length >= 2 && setShowLocationSuggestions(true)
              }
            />
            <TouchableOpacity
              style={styles.currentLocationButton}
              onPress={handleUseCurrentLocation}
            >
              <Navigation size={20} color="#1976D2" />
            </TouchableOpacity>
          </View>

          {showLocationSuggestions && (
            <View style={styles.suggestionsContainer}>
              {isLocationSearching ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color="#1976D2" />
                  <Text style={styles.loadingText}>検索中...</Text>
                </View>
              ) : (
                <FlatList
                  data={suggestions}
                  renderItem={renderLocationSuggestion}
                  keyExtractor={(item) => item.place_id}
                  style={styles.suggestionsList}
                  scrollEnabled={false}
                />
              )}
            </View>
          )}
        </View>

        {/* Time of Day */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Clock size={16} color="#1976D2" /> 時間帯
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipRow}
          >
            {timeSlots.map((slot) => (
              <TouchableOpacity
                key={slot.id}
                style={[
                  styles.chip,
                  timeSlot === slot.id && styles.selectedChip,
                ]}
                onPress={() => setTimeSlot(slot.id)}
              >
                <Text style={styles.chipEmoji}>{slot.icon}</Text>
                <Text
                  style={[
                    styles.chipText,
                    timeSlot === slot.id && styles.selectedChipText,
                  ]}
                >
                  {slot.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Scene */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Users size={16} color="#1976D2" /> シーン
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipRow}
          >
            {sceneOptions.map((option) => (
              <TouchableOpacity
                key={option.id}
                style={[
                  styles.chip,
                  scene === option.id && styles.selectedChip,
                ]}
                onPress={() =>
                  setScene(scene === option.id ? undefined : option.id)
                }
              >
                <Text style={styles.chipEmoji}>{option.icon}</Text>
                <Text
                  style={[
                    styles.chipText,
                    scene === option.id && styles.selectedChipText,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Mood */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Heart size={16} color="#1976D2" /> 気分
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipRow}
          >
            {moodOptions.map((option) => (
              <TouchableOpacity
                key={option.id}
                style={[styles.chip, mood === option.id && styles.selectedChip]}
                onPress={() =>
                  setMood(mood === option.id ? undefined : option.id)
                }
              >
                <Text style={styles.chipEmoji}>{option.icon}</Text>
                <Text
                  style={[
                    styles.chipText,
                    mood === option.id && styles.selectedChipText,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Restrictions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>制約条件</Text>
          <View style={styles.restrictionsContainer}>
            {restrictionOptions.map((option) => (
              <TouchableOpacity
                key={option.id}
                style={[
                  styles.restrictionChip,
                  restrictions.includes(option.id) &&
                    styles.selectedRestrictionChip,
                ]}
                onPress={() => toggleRestriction(option.id)}
              >
                <Text style={styles.chipEmoji}>{option.icon}</Text>
                <Text
                  style={[
                    styles.restrictionChipText,
                    restrictions.includes(option.id) &&
                      styles.selectedRestrictionChipText,
                  ]}
                >
                  {option.label}
                </Text>
                {restrictions.includes(option.id) && (
                  <X size={14} color="#FFF" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Search FAB */}
      <TouchableOpacity
        style={[styles.searchFab, !location && styles.disabledFab]}
        onPress={handleSearch}
        disabled={!location || isSearching}
      >
        {isSearching ? (
          <ActivityIndicator size="small" color="#FFF" />
        ) : (
          <>
            <Search size={24} color="#FFF" />
            <Text style={styles.fabText}>検索開始</Text>
          </>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    backgroundColor: '#FFF',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#6750A4',
    marginBottom: 6,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#49454F',
  },
  section: {
    backgroundColor: '#FFF',
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1B1F',
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    backgroundColor: '#FAFAFA',
  },
  locationInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1C1B1F',
  },
  currentLocationButton: {
    padding: 12,
    borderLeftWidth: 1,
    borderLeftColor: '#E0E0E0',
  },
  suggestionsContainer: {
    marginTop: 8,
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    maxHeight: 200,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  loadingText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#666',
  },
  suggestionsList: {
    maxHeight: 200,
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
    marginLeft: 12,
    flex: 1,
  },
  suggestionMain: {
    fontSize: 16,
    color: '#1C1B1F',
    fontWeight: '500',
  },
  suggestionSecondary: {
    fontSize: 14,
    color: '#49454F',
    marginTop: 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F2FA',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E7E0EC',
    marginBottom: 8,
  },
  selectedChip: {
    backgroundColor: '#6750A4',
    borderColor: '#6750A4',
  },
  chipEmoji: {
    fontSize: 14,
    marginRight: 4,
  },
  chipText: {
    fontSize: 13,
    color: '#49454F',
    fontWeight: '500',
  },
  selectedChipText: {
    color: '#FFF',
    fontWeight: '600',
  },
  restrictionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  restrictionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginBottom: 6,
  },
  selectedRestrictionChip: {
    backgroundColor: '#FF5722',
    borderColor: '#FF5722',
  },
  restrictionChipText: {
    fontSize: 11,
    color: '#49454F',
    fontWeight: '500',
    marginLeft: 4,
    marginRight: 4,
  },
  selectedRestrictionChipText: {
    color: '#FFF',
    fontWeight: '600',
  },
  searchFab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    backgroundColor: '#6750A4',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 28,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  disabledFab: {
    backgroundColor: '#79747E',
  },
  fabText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
    marginLeft: 8,
  },
});
