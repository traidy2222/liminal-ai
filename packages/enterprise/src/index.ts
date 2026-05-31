/**
 * @liminal/enterprise — Liminal Enterprise Edition (EE) barrel.
 *
 * PROPRIETARY. Licensed under ./LICENSE-EE. Not FSL, not open source, and never
 * subject to the FSL MIT-future conversion that applies to the Community Edition.
 */
export { ENTERPRISE_FEATURES } from "./features.js";
export type { EnterpriseFeatureSpec } from "./features.js";
export {
  registerEnterpriseFeatures,
  selectEntitledFeatures,
} from "./enterprise_registration.js";
export type {
  EnterpriseRegistrationResult,
  RegisterEnterpriseOptions,
} from "./enterprise_registration.js";
