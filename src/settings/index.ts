/**
 * Settings: the form moderators fill in (definitions.ts), what each setting is checked for on saving
 * (validation.ts), and the validated AppConfig the app reads from what they saved (config.ts).
 */
export { createConfigLoader, type AppConfig, type ConfigLoader } from "./config.js";
export { settingsDefinitions, type ModActionChoices } from "./definitions.js";
