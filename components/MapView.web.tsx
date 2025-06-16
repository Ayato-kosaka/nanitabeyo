import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MapPin, ExternalLink } from 'lucide-react-native';

interface MapViewComponentProps {
  latitude: number;
  longitude: number;
  title: string;
  description: string;
}

export default function MapViewComponent({ latitude, longitude, title, description }: MapViewComponentProps) {
  const handleOpenMaps = () => {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(description)}`;
    if (typeof window !== 'undefined') {
      window.open(mapsUrl, '_blank');
    }
  };

  return (
    <View style={styles.mapPlaceholder}>
      <MapPin size={48} color="#007AFF" />
      <Text style={styles.mapPlaceholderText}>{title}</Text>
      <Text style={styles.mapPlaceholderAddress}>{description}</Text>
      <TouchableOpacity style={styles.openMapsButton} onPress={handleOpenMaps}>
        <ExternalLink size={16} color="#007AFF" />
        <Text style={styles.openMapsButtonText}>Google Mapsで開く</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  mapPlaceholder: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  mapPlaceholderText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 12,
    textAlign: 'center',
  },
  mapPlaceholderAddress: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  openMapsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F8FF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 16,
  },
  openMapsButtonText: {
    fontSize: 14,
    color: '#007AFF',
    marginLeft: 6,
    fontWeight: '500',
  },
});