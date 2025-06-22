// Minimal stubs for external libraries used in the API package

declare module '@nestjs/common' {
  export const Controller: any;
  export const Get: any;
  export const Query: any;
  export const BadRequestException: any;
  export const Injectable: any;
  export const Module: any;
  export const Global: any;
  export class Logger {
    log(message?: any, context?: string): void;
  }
  export interface INestApplication<T = any> {
    init(): Promise<any>;
    getHttpServer(): any;
  }
  export enum VersioningType { URI }
}

declare module '@nestjs/core' {
  export const NestFactory: any;
}

declare module '@nestjs/testing' {
  export const Test: any;
  export interface TestingModule {
    createNestApplication(): any;
    get<T>(token: any): T;
    compile(): Promise<TestingModule>;
  }
}

declare module '@googlemaps/places' {
  export class PlacesClient {
    constructor(config: any);
    searchNearby(params: any): Promise<any>;
    getPlace(params: any): Promise<any>;
  }
}

declare module '@google-cloud/vision' {
  const vision: any;
  export default vision;
}

declare module 'nanoid' {
  export function nanoid(size?: number): string;
}

declare module 'dotenv' {
  export function config(): void;
}

declare module 'supertest' {
  function request(app: any): any;
  export = request;
}

declare module 'supertest/types' {
  export type App = any;
}

declare module 'reflect-metadata';
declare module 'rxjs';

declare var process: any;

declare module 'zod' {
  export const z: any;
  export namespace z {
    type infer<T> = any;
  }
}

// Jest globals used in spec files
declare const describe: any;
declare const beforeEach: any;
declare const it: any;
declare const expect: any;
