import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_LOCAL_KEYS, wipeLocalKeys } from './localKeys.ts';

test('ALL_LOCAL_KEYS mencakup kunci Gemini, cache AI Coach, sepatu, jadwal, K5, backup, tanpa duplikat', () => {
  assert.equal(new Set(ALL_LOCAL_KEYS).size, ALL_LOCAL_KEYS.length);
  for (const required of [
    'pacelab_gemini_api_key',
    'pacelab_gemini_model',
    'pacelab_ai_coach_cache',
    'pacelab_shoes',
    'pacelab_shoe',
    'pacelab.schedule',
    'pacelab.k5',
    'pacelab.lastBackup',
  ]) {
    assert.ok(ALL_LOCAL_KEYS.includes(required), `harus mencakup ${required}`);
  }
});

test('wipeLocalKeys menghapus seluruh kunci dan tetap melanjutkan bila ada yang gagal', () => {
  const store = new Map<string, string>(ALL_LOCAL_KEYS.map((k) => [k, '1']));
  store.set('kunci_lain_bukan_pacelab', 'aman');
  let throwOnce = true;

  const failed = wipeLocalKeys({
    removeItem(k: string) {
      if (throwOnce && k === 'pacelab_gemini_api_key') {
        throwOnce = false;
        throw new Error('terkunci');
      }
      store.delete(k);
    },
  });

  assert.equal(failed, 1);
  assert.equal(store.get('kunci_lain_bukan_pacelab'), 'aman');
  assert.equal(store.has('pacelab_ai_coach_cache'), false);
  assert.equal(store.has('pacelab_gemini_api_key'), true);
});
