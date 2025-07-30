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
      <View style={styles.header}>
        <Text style={styles.headerTitle}>どんな料理を探しましょう？</Text>
        <Text style={styles.headerSubtitle}>あなたの好みに合わせて最適なお店を見つけます</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {/* Location Input */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <MapPin size={20} color="#5EA2FF" />
            <Text style={styles.sectionTitle}>どのあたりで探す？</Text>
            <View style={styles.requiredBadge}>
              <Text style={styles.requiredText}>必須</Text>
            </View>
          </View>
          <View style={styles.locationInputContainer}>
            <TextInput
              style={styles.locationInput}
              placeholder="場所を入力してください"
              placeholderTextColor="#A0A0A0"
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
              <Navigation size={20} color="#5EA2FF" />
            </TouchableOpacity>
          </View>

          {showLocationSuggestions && (
            <View style={styles.suggestionsContainer}>
              {isLocationSearching ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color="#5EA2FF" />
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
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Clock size={20} color="#5EA2FF" />
            <Text style={styles.sectionTitle}>時間帯は？</Text>
          </View>
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
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Users size={20} color="#5EA2FF" />
            <Text style={styles.sectionTitle}>シーンは？</Text>
          </View>
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
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Heart size={20} color="#5EA2FF" />
            <Text style={styles.sectionTitle}>気分は？</Text>
          </View>
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
            <ChevronUp size={20} color="#5EA2FF" />
          ) : (
            <ChevronDown size={20} color="#5EA2FF" />
          )}
          <Text style={styles.advancedToggleText}>
            {showAdvancedFilters ? '詳細検索を閉じる' : '詳細検索'}
          </Text>
        </TouchableOpacity>

        {/* Advanced Filters Section */}
        {showAdvancedFilters && (
          <>
            {/* Distance */}
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Distance size={20} color="#5EA2FF" />
                <Text style={styles.sectionTitle}>距離は？</Text>
              </View>
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
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <DollarSign size={20} color="#5EA2FF" />
                <Text style={styles.sectionTitle}>予算は？</Text>
              </View>
              <View style={styles.sliderSection}>
                <Text style={styles.sliderValue}>{formatBudgetRange()}</Text>
                <BudgetSlider />
              </View>
            </View>

            {/* Restrictions */}
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>制約条件</Text>
              </View>
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
      <View pointerEvents="box-none" style={styles.searchFabContainer}>
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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  scrollView: {
    flex: 1,
    paddingBottom: 100,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 32,
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 20,
    marginVertical: 8,
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
    marginLeft: 8,
    flex: 1,
  },
  requiredBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  requiredText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#DC2626',
  },
  locationInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  locationInput: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 16,
    fontSize: 16,
    color: '#1A1A1A',
  },
  currentLocationButton: {
    padding: 16,
    borderLeftWidth: 0.5,
    borderLeftColor: '#E5E7EB',
  },
  suggestionsContainer: {
    marginTop: 12,
    backgroundColor: '#FFF',
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: '#E5E7EB',
    maxHeight: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  loadingText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#6B7280',
  },
  suggestionsList: {
    maxHeight: 200,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F3F4F6',
  },
  suggestionText: {
    marginLeft: 16,
    flex: 1,
  },
  suggestionMain: {
    fontSize: 16,
    color: '#1A1A1A',
    fontWeight: '600',
  },
  suggestionSecondary: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  selectedChip: {
    backgroundColor: '#5EA2FF',
    borderColor: '#5EA2FF',
    shadowColor: '#5EA2FF',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  chipEmoji: {
    fontSize: 16,
    marginRight: 8,
  },
  chipText: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '600',
  },
  selectedChipText: {
    color: '#FFF',
    fontWeight: '700',
  },
  restrictionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  restrictionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 8,
  },
  selectedRestrictionChip: {
    backgroundColor: '#EF4444',
    borderColor: '#EF4444',
  },
  restrictionChipText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
    marginLeft: 8,
    marginRight: 8,
  },
  selectedRestrictionChipText: {
    color: '#FFF',
    fontWeight: '700',
  },
  searchFabContainer: {
    position: 'absolute',
    bottom: 32,
    right: 20,
    left: 20,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchFab: {
    background: 'linear-gradient(135deg, #5EA2FF 0%, #357AFF 100%)',
    backgroundColor: '#5EA2FF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 20,
    borderRadius: 32,
    shadowColor: '#5EA2FF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
  },
  disabledFab: {
    backgroundColor: '#D1D5DB',
    shadowOpacity: 0.1,
  },
  fabText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
    marginLeft: 12,
    letterSpacing: 0.5,
  },
  sliderSection: {
    alignItems: 'center',
  },
  sliderValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#5EA2FF',
    marginBottom: 8,
    textAlign: 'center',
  },
  sliderContainer: {
    width: 300,
    justifyContent: 'center',
  },
  sliderTrack: {
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    position: 'relative',
    marginHorizontal: 16,
  },
  sliderThumb: {
    position: 'absolute',
    width: 28,
    height: 28,
    backgroundColor: '#5EA2FF',
    borderRadius: 14,
    top: -11,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  rangeTrack: {
    position: 'absolute',
    height: 6,
    backgroundColor: '#5EA2FF',
    borderRadius: 3,
    top: 0,
  },
  rangeThumbMin: {
    backgroundColor: '#5EA2FF',
  },
  rangeThumbMax: {
    backgroundColor: '#5EA2FF',
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingHorizontal: 16,
  },
  sliderLabelLeft: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  sliderLabelRight: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F8FF',
    marginHorizontal: 24,
    marginVertical: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DBEAFE',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  advancedToggleText: {
    fontSize: 15,
    color: '#5EA2FF',
    fontWeight: '600',
    marginLeft: 12,
  },
});
