/**
 * Mirrors @expo/eas-json's error classes. The names matter: `eas build` and
 * `eas submit` both branch on `MissingProfileError` vs `MissingParentProfileError`
 * to decide whether a missing profile is fatal or falls back to a default.
 */
export class MissingEasJsonError extends Error {}
export class InvalidEasJsonError extends Error {}
export class MissingProfileError extends Error {}
export class MissingParentProfileError extends Error {}
