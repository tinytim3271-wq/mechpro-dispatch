/**
 * MechPro unified entry — browser PWA and Electron desktop share this bundle.
 * Order: shared config + platform modules → legacy SPA.
 */
import { cognitoConfig, storageKeys } from './shared/config.js';
import './modules/register.js';

window.__MECHPRO_CONFIG__ = { cognito: cognitoConfig, storage: storageKeys };
import './runtime/legacy.js';
