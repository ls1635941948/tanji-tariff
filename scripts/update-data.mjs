#!/usr/bin/env node
/** Refresh the official snapshot and the offline bundle using Node 20+ only. */
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { getOfflineSnapshot, getStatus, refreshTariffs } from '../lib/tariff.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DATA_URL = 'https://hts.usitc.gov/reststop/exportList?from=0101&to=9999&format=JSON&styles=false';
const VERSION_URL = 'https://www.usitc.gov/harmonized_tariff_information';
const LICENSE_URL = 'https://catalog.data.gov/dataset/harmonized-tariff-schedule-of-the-united-states-2025';
const execFileAsync = promisify(execFile);
let inFlight;

async function download(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'TanjiTariff/1.0', Accept: 'application/json, text/html;q=0.9, */*;q=0.8' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`USITC returned HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > 50_000_000) throw new Error('Unexpectedly large official download');
    return { body: Buffer.from(await response.arrayBuffer()), transport: 'fetch' };
  } catch (fetchError) {
    // Optional system-CA fallback for environments whose corporate proxy is not
    // trusted by Node. Ordinary users with working fetch never need curl.
    try {
      const { stdout } = await execFileAsync('curl', [
        '--fail', '--location', '--silent', '--show-error', '--max-time', '90',
        '-A', 'TanjiTariff/1.0', url,
      ], { encoding: 'buffer', maxBuffer: 50_000_000, timeout: 95_000 });
      return { body: stdout, transport: 'curl-system-ca' };
    } catch {
      throw new Error(`Official download failed; previous snapshot retained. ${fetchError.message}`);
    }
  }
}

export function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length < 25_000) throw new Error('Incomplete USITC snapshot: fewer than 25,000 rows');
  const chapters = new Set();
  let referenceFound = false;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.description !== 'string') throw new Error('Malformed USITC row');
    const code = String(row.htsno || '').replace(/\D/g, '');
    if (code) chapters.add(Number(code.slice(0, 2)));
    if (code === '3925900000') referenceFound = true;
  }
  const missing = Array.from({ length: 99 }, (_, index) => index + 1).filter(chapter => chapter !== 77 && !chapters.has(chapter));
  if (missing.length) throw new Error(`Incomplete USITC snapshot: missing chapters ${missing.join(', ')}`);
  if (!referenceFound) throw new Error('Reference HTS code 3925900000 was not found');
}

export function parseRevision(html) {
  const match = html.match(/(20\d{2}) HTS Revision (\d+) was published on ([A-Za-z]+ \d{1,2}, 20\d{2})/);
  if (!match) throw new Error('Could not verify the official current HTS revision');
  const released = new Date(`${match[3]} 00:00:00 GMT`);
  if (Number.isNaN(released.getTime())) throw new Error('Invalid official publication date');
  return {
    version: `${match[1]} HTS Revision ${match[2]}`,
    year: Number(match[1]), revision: Number(match[2]),
    released_at: released.toISOString().slice(0, 10),
  };
}

async function atomicWrite(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, value); await rename(temp, file); }
  finally { await rm(temp, { force: true }).catch(() => {}); }
}

async function readPrevious(file) {
  try { return await readFile(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function performUpdate() {
  // The network and all validation happen before any current file is replaced.
  const [downloaded, announcement] = await Promise.all([download(DATA_URL), download(VERSION_URL)]);
  const rows = JSON.parse(downloaded.body.toString('utf8'));
  validateRows(rows);
  const revision = parseRevision(announcement.body.toString('utf8'));
  const metadata = {
    ...revision, fetched_at: new Date().toISOString(),
    source: DATA_URL, version_source: VERSION_URL,
    license: 'U.S. Government public domain', license_source: LICENSE_URL,
    raw_sha256: createHash('sha256').update(downloaded.body).digest('hex'),
    row_count: rows.length, coverage: 'HTS chapters 01–99, excluding reserved chapter 77',
    mode: 'official_snapshot', transport: downloaded.transport,
  };
  const files = {
    full: path.join(ROOT, 'data/hts-full.json'),
    metadata: path.join(ROOT, 'data/metadata.json'),
    offline: path.join(ROOT, 'public/data/hts-offline.json'),
  };
  const previous = new Map(await Promise.all(Object.values(files).map(async file => [file, await readPrevious(file)])));
  const committed = [];
  try {
    await atomicWrite(files.full, JSON.stringify({ ...metadata, rows }));
    committed.push(files.full);
    await atomicWrite(files.metadata, JSON.stringify(metadata, null, 2) + '\n');
    committed.push(files.metadata);
    await refreshTariffs();
    const offline = await getOfflineSnapshot();
    await atomicWrite(files.offline, JSON.stringify(offline));
    committed.push(files.offline);
  } catch (error) {
    for (const file of committed.reverse()) {
      const backup = previous.get(file);
      if (backup === null) await rm(file, { force: true });
      else await atomicWrite(file, backup);
    }
    await refreshTariffs().catch(() => {});
    throw new Error(`Snapshot update aborted; previous data restored. ${error.message}`);
  }
  return { ...getStatus(), transport: metadata.transport };
}

/** Safe to call in a background timer after the server is already listening. */
export function updateData() {
  if (inFlight) return inFlight;
  inFlight = performUpdate().finally(() => { inFlight = undefined; });
  return inFlight;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  updateData().then(status => {
    console.log(`已更新 ${status.version}：${status.rowCount.toLocaleString()} 行官方税则，${status.recordCount.toLocaleString()} 条离线查询记录，下载方式 ${status.transport}。`);
  }).catch(error => { console.error('数据更新失败：', error.message); process.exitCode = 1; });
}
