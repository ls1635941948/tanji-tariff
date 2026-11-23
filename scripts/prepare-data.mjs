import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const execute = promisify(execFile);

async function exists(filename) {
  try { await access(filename); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function prepareData() {
  const rawPath = path.join(ROOT, 'data/hts-full.json');
  const offlinePath = path.join(ROOT, 'public/data/hts-offline.json');
  let restored = false;
  if (!await exists(rawPath)) {
    const bytes = gunzipSync(await readFile(path.join(ROOT, 'data/hts-full.json.gz')), { maxOutputLength: 64 * 1024 * 1024 });
    const snapshot = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(snapshot.rows) || snapshot.rows.length < 25000 || !snapshot.version || !Number.isFinite(Date.parse(snapshot.fetched_at))) throw new Error('压缩税则快照校验失败，未写入数据。');
    if (Number.isInteger(snapshot.row_count) && snapshot.row_count !== snapshot.rows.length) throw new Error('压缩税则的行数与元数据不一致。');
    await mkdir(path.dirname(rawPath), { recursive: true });
    try { await writeFile(rawPath, bytes, { flag: 'wx' }); restored = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  let generatedOffline = false;
  if (!await exists(offlinePath)) {
    const { stdout } = await execute(process.execPath, [path.join(ROOT, 'scripts/build-offline.mjs')], { cwd: ROOT });
    if (stdout.trim()) console.log(stdout.trim());
    generatedOffline = true;
  }
  return { restored, generatedOffline };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareData();
  console.log(result.restored ? '官方税则已从仓库压缩快照恢复。' : '保留已有官方税则，未用压缩快照覆盖。');
  if (result.generatedOffline) console.log('离线基础税则已生成。');
}
