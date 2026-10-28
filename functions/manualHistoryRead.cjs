'use strict';

// Read-only projection of the global manual `transcripts` / `transcriptActivities` history for one
// project. Nothing here is inferred: a transcript is served only when a stored activity names both
// the requested project and the transcript. Stored fields are copied by whitelist, strings verbatim.
const ACTIVITY_TYPES = ['progress', 'blocker', 'decision', 'action', 'note'];
const ACTIVITY_SOURCES = ['transcript', 'manual'];
const MAX_TRANSCRIPT_BYTES = 1048576;
const MAX_LINKED_ACTIVITIES = 1000;

function createManualHistoryRead({ fault, plain, validId, version }) {
  const invalid = () => fault('invalid_manual_history_state', 409);
  const text = (data, key, required) => {
    if (!Object.hasOwn(data, key) || data[key] === undefined) { if (required) throw invalid(); return undefined; }
    if (typeof data[key] !== 'string' || required && !data[key]) throw invalid();
    return data[key];
  };
  const pick = (target, data, keys) => { for (const key of keys) { const value = text(data, key, false); if (value !== undefined) target[key] = value; } return target; };

  function activityView(id, raw, projectId) {
    if (!plain(raw) || raw.projectId !== projectId || !ACTIVITY_TYPES.includes(raw.type) || !ACTIVITY_SOURCES.includes(raw.source)) throw invalid();
    const view = { id, projectId, type: raw.type, summary: text(raw, 'summary', true), meetingDate: text(raw, 'meetingDate', true), source: raw.source };
    pick(view, raw, ['projectName', 'rawExcerpt', 'speaker', 'timestamp', 'createdAt', 'createdBy', 'createdByName']);
    if (Object.hasOwn(raw, 'transcriptId') && raw.transcriptId !== undefined) {
      if (!validId(raw.transcriptId)) throw invalid();
      view.transcriptId = raw.transcriptId;
    }
    return view;
  }

  async function activitiesPage({ transaction, db, projectId, start, limit, encode }) {
    let query = db.collection('transcriptActivities').where('projectId', '==', projectId).orderBy('__name__');
    if (start) query = query.startAfter(start);
    const rows = await transaction.get(query.limit(limit + 1)), page = rows.docs.slice(0, limit);
    const activities = page.map(row => activityView(row.id, row.data(), projectId));
    return { activities, next_cursor: rows.docs.length > limit ? encode(page.at(-1).id) : null };
  }

  function transcriptView(id, snapshot) {
    const raw = snapshot.data();
    if (!plain(raw)) throw invalid();
    const rawText = text(raw, 'rawText', false);
    if (rawText === undefined) throw invalid();
    // Firestore documents are capped at 1 MiB, so a larger body is an inconsistent source, never truncated.
    if (Buffer.byteLength(rawText, 'utf8') > MAX_TRANSCRIPT_BYTES) throw fault('manual_transcript_too_large', 409);
    const view = { id, rawText, meetingDate: text(raw, 'meetingDate', true), processed: raw.processed === true };
    pick(view, raw, ['fileName', 'meetingTitle', 'processedAt', 'createdAt', 'createdBy', 'createdByName']);
    for (const key of ['extractedProjectCount', 'extractedActivityCount']) {
      if (raw[key] === undefined) continue;
      if (!Number.isSafeInteger(raw[key]) || raw[key] < 0) throw invalid();
      view[key] = raw[key];
    }
    return view;
  }

  async function transcript({ transaction, db, projectId, transcriptId }) {
    const unavailable = () => fault('manual_transcript_unavailable', 404);
    // Link evidence comes only from stored activities that name this transcript.
    const links = await transaction.get(db.collection('transcriptActivities').where('transcriptId', '==', transcriptId).limit(MAX_LINKED_ACTIVITIES + 1));
    if (links.docs.length > MAX_LINKED_ACTIVITIES) throw invalid();
    const projects = new Set();
    for (const row of links.docs) {
      const data = row.data();
      if (!plain(data) || !validId(data.projectId)) throw invalid();
      projects.add(data.projectId);
    }
    if (!projects.has(projectId)) throw unavailable();
    const snapshot = await transaction.get(db.collection('transcripts').doc(transcriptId));
    if (!snapshot.exists) throw unavailable();
    return { transcript: transcriptView(transcriptId, snapshot), linked_project_count: projects.size, transcript_version: version(snapshot) };
  }

  return { activitiesPage, transcript };
}

module.exports = { createManualHistoryRead, MAX_TRANSCRIPT_BYTES };
