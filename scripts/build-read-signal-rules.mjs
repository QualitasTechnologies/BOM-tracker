import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASELINE_SHA256 = '58bd2d80afa51cf4a3f8849ae72ae2b50652b4855298b6162a02e69710dc9a50';
const BEGIN = '    // BEGIN approved content-free notices';
const END = '    // END approved content-free notices\n';
const normalize = text => text.replace(/\r\n/g, '\n');
export function stripReadSignalAddition(candidate) {
  const start = candidate.indexOf(BEGIN), end = candidate.indexOf(END);
  if (start < 0 || end < start || candidate.indexOf(BEGIN, start + BEGIN.length) >= 0 || candidate.indexOf(END, end + END.length) >= 0) throw Error('ambiguous_notice_addition');
  return candidate.slice(0, start) + candidate.slice(end + END.length);
}
export function buildReadSignalRules(baselineText, sourceText) {
  const baseline = normalize(baselineText), source = normalize(sourceText);
  if (createHash('sha256').update(baseline).digest('hex') !== BASELINE_SHA256) throw Error('live_baseline_changed');
  const marker = '    // Content-free refresh notices', start = source.indexOf(marker), end = source.indexOf('    match /clients/', start);
  if (start < 0 || end < start || source.indexOf(marker, start + marker.length) >= 0) throw Error('notice_boundary_missing_or_ambiguous');
  const addition = source.slice(start, end).trimEnd();
  const matches = [...addition.matchAll(/match \/([A-Za-z]+)/g)].map(row => row[1]);
  if (JSON.stringify(matches) !== JSON.stringify(['pulseReadSignals', 'pulseUserReadSignals', 'pulseReadCatalog'])) throw Error('unexpected_notice_matches');
  const helper = text => text.match(/    function projectSubcollectionAccess\(projectId\) \{[\s\S]*?\n    \}/g);
  const oldHelpers = helper(baseline), currentHelpers = helper(source);
  if (oldHelpers?.length !== 1 || currentHelpers?.length !== 1 || oldHelpers[0] !== currentHelpers[0]) throw Error('notice_project_access_predicate_changed');
  const offset = baseline.lastIndexOf('  }\n}');
  if (offset < 0 || baseline.slice(offset) !== '  }\n}\n') throw Error('live_baseline_footer_changed');
  const candidate = baseline.slice(0, offset) + BEGIN + '\n' + addition + '\n' + END + baseline.slice(offset);
  if (stripReadSignalAddition(candidate) !== baseline) throw Error('baseline_preservation_failed');
  return candidate;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const generated = buildReadSignalRules(await readFile('firestore.legacy-po.rules', 'utf8'), await readFile('firestore.rules', 'utf8'));
  if (process.argv.includes('--check')) {
    if (normalize(await readFile('firestore.read-signals.rules', 'utf8')) !== generated) throw Error('notice_release_artifact_stale');
  } else await writeFile('firestore.read-signals.rules', generated);
}
