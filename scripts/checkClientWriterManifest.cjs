const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const FIRESTORE_MODULES = new Set(['firebase/firestore', 'firebase/firestore/lite']);
const STORAGE_MODULES = new Set(['firebase/storage']);
const WRITER_METHODS = {
  firestore: new Set(['setDoc', 'addDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction']),
  storage: new Set(['uploadBytes', 'uploadBytesResumable', 'uploadString', 'deleteObject', 'updateMetadata']),
};
const BATCH_METHODS = new Set(['set', 'update', 'delete']);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

function sortCounts(counts) {
  return Object.fromEntries(Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, methods]) => [file, Object.fromEntries(Object.entries(methods)
      .sort(([left], [right]) => left.localeCompare(right)))]));
}

function scriptKindFor(filePath) {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.ts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function createBindings(sourceFile) {
  const bindings = {
    firestore: new Map(),
    storage: new Map(),
    firestoreNamespaces: new Set(),
    storageNamespaces: new Set(),
  };

  function addModuleBindings(moduleName, clause) {
    const category = FIRESTORE_MODULES.has(moduleName)
      ? 'firestore'
      : STORAGE_MODULES.has(moduleName)
        ? 'storage'
        : null;
    if (!category || !clause) return;

    const namedBindings = clause.namedBindings;
    if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      bindings[`${category}Namespaces`].add(namedBindings.name.text);
    } else if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        const importedName = element.propertyName?.text || element.name.text;
        bindings[category].set(element.name.text, importedName);
      }
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      addModuleBindings(node.moduleSpecifier.text, node.importClause);
    }
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.name) && ts.isIdentifier(node.initializer.expression) && node.parent) {
      const moduleName = node.initializer.expression.text === 'require' &&
        node.initializer.arguments[0] && ts.isStringLiteral(node.initializer.arguments[0])
        ? node.initializer.arguments[0].text
        : null;
      if (moduleName) {
        const category = FIRESTORE_MODULES.has(moduleName)
          ? 'firestore'
          : STORAGE_MODULES.has(moduleName)
            ? 'storage'
            : null;
        if (category) bindings[`${category}Namespaces`].add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return bindings;
}

function importedMethod(bindings, category, expression) {
  if (ts.isIdentifier(expression)) return bindings[category].get(expression.text) || null;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) &&
      bindings[`${category}Namespaces`].has(expression.expression.text)) {
    return expression.name.text;
  }
  return null;
}

function collectClientWriterCountsFromSources(sources) {
  const counts = { firestore: {}, storage: {} };

  for (const { path: relativePath, source } of sources) {
    const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, scriptKindFor(relativePath));
    if (sourceFile.parseDiagnostics.length > 0) {
      const diagnostic = sourceFile.parseDiagnostics[0];
      const detail = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      throw new Error(`Unable to parse ${relativePath}: ${detail}`);
    }

    const bindings = createBindings(sourceFile);
    const batchReceivers = new Set();
    const transactionReceivers = new Set();

    function collectReceivers(node) {
      if (ts.isCallExpression(node)) {
        const method = importedMethod(bindings, 'firestore', node.expression);
        if (method === 'writeBatch' && ts.isVariableDeclaration(node.parent) &&
            node.parent.initializer === node && ts.isIdentifier(node.parent.name)) {
          batchReceivers.add(node.parent.name.text);
        }
        if (method === 'runTransaction') {
          const callback = node.arguments[1];
          if ((ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
              callback.parameters.length > 0 && ts.isIdentifier(callback.parameters[0].name)) {
            transactionReceivers.add(callback.parameters[0].name.text);
          }
        }
      }
      ts.forEachChild(node, collectReceivers);
    }
    collectReceivers(sourceFile);

    function increment(category, method) {
      counts[category][relativePath] ||= {};
      counts[category][relativePath][method] = (counts[category][relativePath][method] || 0) + 1;
    }

    function visit(node) {
      if (ts.isCallExpression(node)) {
        const firestoreMethod = importedMethod(bindings, 'firestore', node.expression);
        if (firestoreMethod && WRITER_METHODS.firestore.has(firestoreMethod)) {
          increment('firestore', firestoreMethod);
        }

        const storageMethod = importedMethod(bindings, 'storage', node.expression);
        if (storageMethod && WRITER_METHODS.storage.has(storageMethod)) {
          increment('storage', storageMethod);
        }

        if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
          const receiver = node.expression.expression.text;
          const method = node.expression.name.text;
          if (BATCH_METHODS.has(method) && batchReceivers.has(receiver)) increment('firestore', `batch.${method}`);
          if (BATCH_METHODS.has(method) && transactionReceivers.has(receiver)) increment('firestore', `transaction.${method}`);
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return {
    firestore: sortCounts(counts.firestore),
    storage: sortCounts(counts.storage),
  };
}

function isTestSource(relativePath) {
  return /(^|\/)(__tests__|tests|test|fixtures)(\/|$)|\.(test|spec)\.[^.]+$/i.test(relativePath);
}

function listSourceFiles(root, directory = 'src') {
  const absoluteRoot = path.resolve(root);
  const absoluteDirectory = path.join(absoluteRoot, directory);
  const sources = [];

  function walk(currentDirectory) {
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = path.relative(absoluteRoot, absolutePath).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (!isTestSource(relativePath)) walk(absolutePath);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !isTestSource(relativePath)) {
        sources.push({ path: relativePath, source: fs.readFileSync(absolutePath, 'utf8') });
      }
    }
  }

  walk(absoluteDirectory);
  return sources.sort((left, right) => left.path.localeCompare(right.path));
}

function collectClientWriterCounts(root) {
  return collectClientWriterCountsFromSources(listSourceFiles(root));
}

function compareWriterManifest(expected, actual) {
  const differences = [];

  for (const category of ['firestore', 'storage']) {
    const expectedFiles = expected[category] || {};
    const actualFiles = actual[category] || {};
    const files = [...new Set([...Object.keys(expectedFiles), ...Object.keys(actualFiles)])].sort();

    for (const file of files) {
      const expectedMethods = expectedFiles[file] || {};
      const actualMethods = actualFiles[file] || {};
      const methods = [...new Set([...Object.keys(expectedMethods), ...Object.keys(actualMethods)])].sort();

      for (const method of methods) {
        const expectedCount = expectedMethods[method] || 0;
        const actualCount = actualMethods[method] || 0;
        if (expectedCount !== actualCount) {
          differences.push(`${category} ${file} ${method}: expected ${expectedCount}, found ${actualCount}`);
        }
      }
    }
  }

  return differences;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const manifestPath = path.join(root, 'docs', 'bom-client-writer-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const actual = collectClientWriterCounts(root);
  const differences = compareWriterManifest(manifest, actual);

  if (differences.length > 0) {
    console.error('Client writer inventory drift detected:');
    for (const difference of differences) console.error(`- ${difference}`);
    process.exitCode = 1;
  } else {
    const count = category => Object.values(actual[category])
      .flatMap(methods => Object.values(methods))
      .reduce((sum, value) => sum + value, 0);
    console.log(`Client writer manifest matches: ${count('firestore')} Firestore and ${count('storage')} Storage call sites.`);
  }
}

module.exports = {
  collectClientWriterCounts,
  collectClientWriterCountsFromSources,
  compareWriterManifest,
};
