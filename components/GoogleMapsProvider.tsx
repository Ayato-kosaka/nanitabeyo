import React from 'react';
import { LoadScript } from '@react-google-maps/api';
import { Env } from '@/constants/Env';

interface GoogleMapsProviderProps {
  children: React.ReactNode;
}

const libraries: ("places" | "geometry" | "drawing" | "visualization")[] = ['places'];

export default function GoogleMapsProvider({ children }: GoogleMapsProviderProps) {
  return (
    <LoadScript 
      googleMapsApiKey={Env.GOOGLE_MAPS_API_KEY || ''}
      libraries={libraries}
    >
      {children}
    </LoadScript>
  );
}