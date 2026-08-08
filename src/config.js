/**
 * Config file management.
 * Reads/writes .bookmarks-config.json in the repo root.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', '.bookmarks-config.json');

const DEFAULTS = {
  batchSize: 5,
  listingPages: 10,
  batteryThreshold: 50,
  outputDir: './bookmarks',
  birdPath: null,
  authToken: null,
  ct0: null
};

export function loadConfig() {
  let config = { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    config = { ...DEFAULTS, ...raw };
  } catch {}
  return config;
}

export function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

export function getConfigPath() {
  return CONFIG_PATH;
}
