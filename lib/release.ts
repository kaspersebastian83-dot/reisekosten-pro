// Embedded at build time from package.json and the build commit, never fetched
// from a newer deployment while this app is running.
declare const __APP_RELEASE__: { version: string; commit: string };
export const appRelease = __APP_RELEASE__;
