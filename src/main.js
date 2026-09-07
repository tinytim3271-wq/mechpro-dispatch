/**
 * MechPro unified entry — browser PWA and Electron desktop share this bundle.
 * Order: shared config + platform modules → legacy SPA.
 */
import { cognitoConfig, storageKeys } from './shared/config.js';
import './modules/register.js';

// __MECHPRO_CONFIG__ is set in config.js (before legacy.js runs in esbuild IIFE order).
import './runtime/legacy.js';
