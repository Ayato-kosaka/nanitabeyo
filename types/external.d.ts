declare module '@googlemaps/places';
declare module '@nestjs/common';
declare module '@nestjs/core';
declare module '@nestjs/platform-express';
declare module 'reflect-metadata';
declare module 'rxjs';
declare module '@google-cloud/vision';
declare module 'nanoid';
declare module 'dotenv';
declare module '@types/node';
declare var process: any;

// Minimal zod typing
declare module 'zod' {
  const z: any;
  namespace z {
    type infer<T> = any;
  }
  export { z };
}

declare module 'react';
declare module 'react-native';
declare module '@react-google-maps/api';
declare module 'react-native-maps';
declare module 'expo-constants';
