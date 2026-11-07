import { EnvironmentProviders, Provider } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Normal builds: no demo code. The `demo` build configuration replaces this file with
 * demo.providers.demo.ts (fileReplacements in angular.json).
 */
export const DEMO_INTERCEPTORS: HttpInterceptorFn[] = [];
export const DEMO_PROVIDERS: (Provider | EnvironmentProviders)[] = [];
