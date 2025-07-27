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
  PanResponder,
} from 'react-native';
import { Divider } from 'react-native-paper';
import {
  MapPin,
  Search,
  Clock,
  Users,
  Heart,
  Plus,
  X,
  Navigation,
  MapPin as Distance,
  DollarSign,
  ChevronDown,
  ChevronUp,
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

// Distance options in meters
const distanceOptions = [
  { value: 100, label: '100m' },
  { value: 300, label: '300m' },
  { value: 500, label: '500m' },
  { value: 800, label: '800m' },
  { value: 1000, label: '1km' },
  { value: 2000, label: '2km' },
  { value: 3000, label: '3km' },
  { value: 5000, label: '5km' },
  { value: 10000, label: '10km' },
  { value: 15000, label: '15km' },
  { value: 20000, label: '20km' },
];

// Budget options in yen
const budgetOptions = [
  { value: null, label: '下限なし' },
  { value: 1000, label: '1,000円' },
  { value: 2000, label: '2,000円' },
  { value: 3000, label: '3,000円' },
  { value: 4000, label: '4,000円' },
  { value: 5000, label: '5,000円' },
  { value: 6000, label: '6,000円' },
  { value: 7000, label: '7,000円' },
  { value: 8000, label: '8,000円' },
  { value: 9000, label: '9,000円' },
  { value: 10000, label: '10,000円' },
  { value: 15000, label: '15,000円' },
  { value: 20000, label: '20,000円' },
  { value: 30000, label: '30,000円' },
  { value: 40000, label: '40,000円' },
  { value: 50000, label: '50,000円' },
  { value: 60000, label: '60,000円' },
  { value: 80000, label: '80,000円' },
  { value: 100000, label: '100,000円' },
  { value: null, label: '上限なし' },
];

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
  const [distance, setDistance] = useState<number>(500); // Default 500m
  const [budgetMin, setBudgetMin] = useState<number | null>(null);
  const [budgetMax, setBudgetMax] = useState<number | null>(null);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

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
        distance,
        budgetMin,
        budgetMax,
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

  // Distance slider component
  const DistanceSlider = () => {
    const currentIndex = distanceOptions.findIndex(
      (option) => option.value === distance
    );
    const sliderWidth = 280;
    const thumbWidth = 24;
    const trackWidth = sliderWidth - thumbWidth;
    const thumbPosition =
      (currentIndex / (distanceOptions.length - 1)) * trackWidth;

    const panResponder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (evt, gestureState) => {
        const newPosition = Math.max(
          0,
          Math.min(trackWidth, gestureState.moveX - 50)
        );
        const newIndex = Math.round(
          (newPosition / trackWidth) * (distanceOptions.length - 1)
        );
        if (
          newIndex !== currentIndex &&
          newIndex >= 0 &&
          newIndex < distanceOptions.length
        ) {
          setDistance(distanceOptions[newIndex].value);
        }
      },
    });

    return (
      <View style={styles.sliderContainer}>
        <View style={styles.sliderTrack}>
          <View
            style={[styles.sliderThumb, { left: thumbPosition }]}
            {...panResponder.panHandlers}
          />
        </View>
        <View style={styles.sliderLabels}>
          <Text style={styles.sliderLabelLeft}>近い</Text>
          <Text style={styles.sliderLabelRight}>遠い</Text>
        </View>
      </View>
    );
  };

  // Budget range slider component
  const BudgetSlider = () => {
    const minIndex =
      budgetMin === null
        ? 0
        : budgetOptions.findIndex((option) => option.value === budgetMin);
    const maxIndex =
      budgetMax === null
        ? budgetOptions.length - 1
        : budgetOptions.findIndex((option) => option.value === budgetMax);

    const sliderWidth = 280;
    const thumbWidth = 24;
    const trackWidth = sliderWidth - thumbWidth;

    const minThumbPosition =
      (minIndex / (budgetOptions.length - 1)) * trackWidth;
    const maxThumbPosition =
      (maxIndex / (budgetOptions.length - 1)) * trackWidth;

    const createPanResponder = (isMin: boolean) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (evt, gestureState) => {
          const newPosition = Math.max(
            0,
            Math.min(trackWidth, gestureState.moveX - 50)
          );
          const newIndex = Math.round(
            (newPosition / trackWidth) * (budgetOptions.length - 1)
          );

          if (isMin) {
            if (newIndex <= maxIndex && newIndex >= 0) {
              setBudgetMin(budgetOptions[newIndex].value);
            }
          } else {
            if (newIndex >= minIndex && newIndex < budgetOptions.length) {
              setBudgetMax(budgetOptions[newIndex].value);
            }
          }
        },
      });

    const minPanResponder = createPanResponder(true);
    const maxPanResponder = createPanResponder(false);

    return (
      <View style={styles.sliderContainer}>
        <View style={styles.sliderTrack}>
          <View
            style={[
              styles.rangeTrack,
              {
                left: minThumbPosition,
                width: maxThumbPosition - minThumbPosition + thumbWidth,
              },
            ]}
          />
          <View
            style={[
              styles.sliderThumb,
              styles.rangeThumbMin,
              { left: minThumbPosition },
            ]}
            {...minPanResponder.panHandlers}
          />
          <View
            style={[
              styles.sliderThumb,
              styles.rangeThumbMax,
              { left: maxThumbPosition },
            ]}
            {...maxPanResponder.panHandlers}
          />
        </View>
        <View style={styles.sliderLabels}>
          <Text style={styles.sliderLabelLeft}>安い</Text>
          <Text style={styles.sliderLabelRight}>高い</Text>
        </View>
      </View>
    );
  };

  const formatBudgetRange = () => {
    const minLabel =
      budgetMin === null ? '下限なし' : `${budgetMin.toLocaleString()}円`;
    const maxLabel =
      budgetMax === null ? '上限なし' : `${budgetMax.toLocaleString()}円`;
    return `${minLabel} 〜 ${maxLabel}`;
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
      {/* Header */}
      <View style={{ ...styles.header, position: 'relative' }}>
        <Text style={styles.headerTitle}>どんな料理を探しましょう？🍴</Text>
      </View>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {/* Location Input */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <MapPin size={16} color="#1976D2" /> どのあたりで探す？ *
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
                  keyExtractor={(item) => item.placeId}
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
            <Clock size={16} color="#1976D2" /> 時間帯は？
          </Text>
          <View style={styles.chipGrid}>
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
          </View>
        </View>

        {/* Scene */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Users size={16} color="#1976D2" /> シーンは？
          </Text>
          <View style={styles.chipGrid}>
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
          </View>
        </View>

        {/* Mood */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Heart size={16} color="#1976D2" /> 気分は？
          </Text>
          <View style={styles.chipGrid}>
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
          </View>
        </View>

        {/* Advanced Filters Toggle */}
        <TouchableOpacity
          style={styles.advancedToggle}
          onPress={() => setShowAdvancedFilters(!showAdvancedFilters)}
        >
          {showAdvancedFilters ? (
            <ChevronUp size={20} color="#1976D2" />
          ) : (
            <ChevronDown size={20} color="#1976D2" />
          )}
          <Text style={styles.advancedToggleText}>
            {showAdvancedFilters ? '詳細検索を閉じる' : '詳細検索'}
          </Text>
        </TouchableOpacity>

        {/* Advanced Filters Section */}
        {showAdvancedFilters && (
          <>
            {/* Distance */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                <Distance size={16} color="#1976D2" /> 距離は？
              </Text>
              <View style={styles.sliderSection}>
                <Text style={styles.sliderValue}>
                  {
                    distanceOptions.find((option) => option.value === distance)
                      ?.label
                  }
                </Text>
                <DistanceSlider />
              </View>
            </View>

            {/* Budget */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                <DollarSign size={16} color="#1976D2" /> 予算は？
              </Text>
              <View style={styles.sliderSection}>
                <Text style={styles.sliderValue}>{formatBudgetRange()}</Text>
                <BudgetSlider />
              </View>
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
          </>
        )}
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
            <Text style={styles.fabText}>探して！</Text>
          </>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  scrollView: {
    flex: 1,
    paddingBottom: 80,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    backgroundColor: '#FFF',
    elevation: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1976D2',
    marginBottom: 6,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#49454F',
  },
  section: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1B1F',
    marginBottom: 8,
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
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginHorizontal: -3,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: '#E7E0EC',
    marginBottom: 6,
    marginHorizontal: 3,
  },
  selectedChip: {
    backgroundColor: '#1976D2',
    borderColor: '#1976D2',
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
    backgroundColor: '#1976D2',
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
    backgroundColor: '#9E9E9E',
  },
  fabText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
    marginLeft: 8,
  },
  sliderSection: {
    alignItems: 'center',
  },
  sliderValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1976D2',
    marginBottom: 4,
    textAlign: 'center',
  },
  sliderContainer: {
    width: 280,
    justifyContent: 'center',
  },
  sliderTrack: {
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    position: 'relative',
    marginHorizontal: 12,
  },
  sliderThumb: {
    position: 'absolute',
    width: 24,
    height: 24,
    backgroundColor: '#1976D2',
    borderRadius: 12,
    top: -10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  rangeTrack: {
    position: 'absolute',
    height: 4,
    backgroundColor: '#1976D2',
    borderRadius: 2,
    top: 0,
  },
  rangeThumbMin: {
    backgroundColor: '#1976D2',
  },
  rangeThumbMax: {
    backgroundColor: '#1976D2',
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 12,
  },
  sliderLabelLeft: {
    fontSize: 12,
    color: '#666',
  },
  sliderLabelRight: {
    fontSize: 12,
    color: '#666',
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E3F2FD',
    marginHorizontal: 20,
    marginVertical: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BBDEFB',
  },
  advancedToggleText: {
    fontSize: 14,
    color: '#1976D2',
    fontWeight: '500',
    marginLeft: 8,
  },
});
