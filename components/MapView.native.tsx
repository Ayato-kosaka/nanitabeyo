import React from 'react';
import { View, StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

interface MapViewComponentProps {
  latitude: number;
  longitude: number;
  title: string;
  description: string;
}

export default function MapViewComponent({ latitude, longitude, title, description }: MapViewComponentProps) {
  return (
    <MapView
      style={styles.map}
      initialRegion={{
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }}
    >
      <Marker
        coordinate={{
          latitude,
          longitude,
        }}
        title={title}
        description={description}
      />
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});