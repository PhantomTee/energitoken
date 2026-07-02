/**
 * Custom entry point: polyfills MUST execute before expo-router loads any
 * route module. In release builds expo-router eagerly requires every route
 * at startup, and screens that import ethers/Privy touch the `crypto` global
 * at module scope — without this ordering the app crashes on launch with
 * "Property 'crypto' doesn't exist".
 */
import "./src/polyfills";
import "expo-router/entry";
