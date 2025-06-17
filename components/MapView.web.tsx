import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { GoogleMap, Marker } from '@react-google-maps/api';

interface MapViewComponentProps {
  latitude: number;
  longitude: number;
  title: string;
  description: string;
}

const mapContainerStyle = {
  width: '100%',
  height: '100%',
};

export default function MapViewComponent({ latitude, longitude, title, description }: MapViewComponentProps) {
  const center = {
    lat: latitude,
    lng: longitude,
  };

  const onLoad = useCallback((map: google.maps.Map) => {
    // Optional: You can store the map instance if needed
  }, []);

  const onUnmount = useCallback((map: google.maps.Map) => {
    // Cleanup if needed
  }, []);

  return (
    <GoogleMap
      mapContainerStyle={mapContainerStyle}
      center={center}
      zoom={15}
      onLoad={onLoad}
      onUnmount={onUnmount}
      options={{
        disableDefaultUI: false,
        zoomControl: true,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      }}
    >
      <Marker
        position={center}
        title={title}
      />
    </GoogleMap>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
});