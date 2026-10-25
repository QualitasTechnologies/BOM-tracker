import { afterEach, expect, it, vi } from 'vitest';
import { nativeProjectDocumentsEnabled } from '../projectDocumentMode';

afterEach(() => vi.unstubAllEnvs());
const set = (env: Record<string, string>) => Object.entries(env).forEach(([key, value]) => vi.stubEnv(key, value));

it('native document edits need both the material edit switch and the document edit switch', () => {
  expect(nativeProjectDocumentsEnabled()).toBe(false);
  set({ VITE_BOM_SAFE_MATERIAL_EDITS_ENABLED: 'true' });
  expect(nativeProjectDocumentsEnabled()).toBe(false);
  set({ VITE_BOM_SAFE_DOCUMENT_EDITS_ENABLED: 'true' });
  expect(nativeProjectDocumentsEnabled()).toBe(true);
  set({ VITE_BOM_SAFE_MATERIAL_EDITS_ENABLED: 'false' });
  expect(nativeProjectDocumentsEnabled()).toBe(false);
});

it('read and native material command switches never enable document edits', () => {
  set({ VITE_BOM_SCOPED_READS_ENABLED: 'true', VITE_BOM_NATIVE_MATERIAL_MUTATIONS_ENABLED: 'true' });
  expect(nativeProjectDocumentsEnabled()).toBe(false);
  set({ VITE_BOM_SAFE_DOCUMENT_EDITS_ENABLED: 'true' });
  expect(nativeProjectDocumentsEnabled()).toBe(false);
});
