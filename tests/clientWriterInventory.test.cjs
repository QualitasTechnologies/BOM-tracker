const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectClientWriterCountsFromSources,
  compareWriterManifest,
} = require('../scripts/checkClientWriterManifest.cjs');

test('client writer scanner counts Firestore and Storage mutations in TS/TSX calls', () => {
  const result = collectClientWriterCountsFromSources([
    {
      path: 'src/a.ts',
      source: `
        import { setDoc, updateDoc } from 'firebase/firestore';
        import { uploadBytes } from 'firebase/storage';
        setDoc(ref, value);
        updateDoc(ref, value);
        uploadBytes(ref, file);
      `,
    },
    {
      path: 'src/B.tsx',
      source: `
        import { deleteDoc } from 'firebase/firestore';
        import { uploadBytes as upload } from 'firebase/storage';
        // deleteDoc(ref) is disabled
        const text = "uploadBytes(ref, file)";
        deleteDoc(ref);
        upload(ref, file);
      `,
    },
  ]);

  assert.deepEqual(result, {
    firestore: {
      'src/B.tsx': { deleteDoc: 1 },
      'src/a.ts': { setDoc: 1, updateDoc: 1 },
    },
    storage: {
      'src/a.ts': { uploadBytes: 1 },
      'src/B.tsx': { uploadBytes: 1 },
    },
  });
});

test('client writer scanner follows Firebase import aliases, namespace imports, batches and transactions', () => {
  const result = collectClientWriterCountsFromSources([{
    path: 'src/writes.ts',
    source: `
      import { setDoc as save, writeBatch as makeBatch, runTransaction as transact } from 'firebase/firestore';
      import * as storage from 'firebase/storage';
      const batch = makeBatch(db);
      batch.set(ref, value);
      batch.update(ref, value);
      batch.delete(ref);
      await transact(db, async (transaction) => {
        transaction.set(ref, value);
        transaction.update(ref, value);
        transaction.delete(ref);
      });
      save(ref, value);
      storage.uploadBytes(ref, file);
      function deleteObject(value) { return value; }
      deleteObject(ref);
    `,
  }]);

  assert.deepEqual(result, {
    firestore: {
      'src/writes.ts': {
        'batch.delete': 1,
        'batch.set': 1,
        'batch.update': 1,
        'runTransaction': 1,
        'setDoc': 1,
        'transaction.delete': 1,
        'transaction.set': 1,
        'transaction.update': 1,
        'writeBatch': 1,
      },
    },
    storage: {
      'src/writes.ts': { uploadBytes: 1 },
    },
  });
});

test('client writer scanner rejects malformed source instead of silently undercounting', () => {
  assert.throws(() => collectClientWriterCountsFromSources([{
    path: 'src/broken.ts',
    source: 'import { setDoc } from "firebase/firestore"; const broken = (',
  }]), /Unable to parse src\/broken\.ts/);
});

test('manifest comparison reports added, removed and changed client writers', () => {
  const expected = {
    firestore: { 'src/a.ts': { setDoc: 1, updateDoc: 1 } },
    storage: { 'src/a.ts': { uploadBytes: 1 } },
  };
  const actual = {
    firestore: { 'src/a.ts': { setDoc: 2 }, 'src/new.ts': { addDoc: 1 } },
    storage: {},
  };

  assert.deepEqual(compareWriterManifest(expected, actual), [
    'firestore src/a.ts setDoc: expected 1, found 2',
    'firestore src/a.ts updateDoc: expected 1, found 0',
    'firestore src/new.ts addDoc: expected 0, found 1',
    'storage src/a.ts uploadBytes: expected 1, found 0',
  ]);
});
