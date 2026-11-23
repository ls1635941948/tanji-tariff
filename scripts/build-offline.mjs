import { mkdir, writeFile } from 'node:fs/promises';
import { getOfflineSnapshot } from '../lib/tariff.mjs';

const snapshot = await getOfflineSnapshot();
const target = new URL('../public/data/hts-offline.json', import.meta.url);
await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
await writeFile(target, JSON.stringify(snapshot));
console.log(`Saved offline snapshot: ${snapshot.items.length.toLocaleString()} searchable US HTS lines, ${snapshot.version}`);
