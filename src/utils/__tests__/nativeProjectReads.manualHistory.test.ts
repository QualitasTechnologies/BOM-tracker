import { describe, expect, it, vi } from 'vitest';
import { createNativeProjectReadClient } from '../nativeProjectReads';

const activity = { id: 'a1', projectId: 'p1', projectName: 'Build', type: 'note', summary: 'S', meetingDate: '2026-10-01', source: 'transcript', transcriptId: 't1', createdBy: 'u9', createdByName: 'Bob' };
const activities = { ok: true, project_id: 'p1', actor_uid: 'u1', project_version: '1:2', activities: [activity], next_cursor: null };
const transcript = { id: 't1', rawText: '<script>x</script>\n List<String>', meetingDate: '2026-10-01', processed: true, createdBy: 'u9' };
const read = { ok: true, project_id: 'p1', actor_uid: 'u1', project_version: '1:2', transcript, linked_project_count: 2, transcript_version: '3:4' };

function setup(reply: unknown) {
  const callable = vi.fn(async () => ({ data: reply }));
  return { client: createNativeProjectReadClient({ currentUid: () => 'u1', callable }), callable };
}

describe('native manual history read client', () => {
  it('sends exact activities and transcript requests', async () => {
    const a = setup(activities);
    expect((await a.client.activities('p1', { limit: 5, cursor: 'c' }, 'u1')).activities).toEqual([activity]);
    expect(a.callable).toHaveBeenCalledWith({ operation: 'activities', project_id: 'p1', limit: 5, cursor: 'c' }, 'u1', undefined);
    const t = setup(read);
    const result = await t.client.transcript('p1', 't1', 'u1');
    expect(result.transcript.rawText).toBe(transcript.rawText);
    expect(result.linked_project_count).toBe(2);
    expect(t.callable).toHaveBeenCalledWith({ operation: 'transcript', project_id: 'p1', transcript_id: 't1' }, 'u1', undefined);
  });

  it.each([
    ['wrong actor', { ...activities, actor_uid: 'u2' }],
    ['wrong project', { ...activities, project_id: 'p2' }],
    ['row for another project', { ...activities, activities: [{ ...activity, projectId: 'p2' }] }],
    ['unknown activity key', { ...activities, activities: [{ ...activity, secret: 1 }] }],
    ['bad type', { ...activities, activities: [{ ...activity, type: 'email' }] }],
    ['duplicate rows', { ...activities, activities: [activity, activity] }],
    ['extra envelope key', { ...activities, other: 1 }],
    ['too many rows', { ...activities, activities: [activity, { ...activity, id: 'a2' }, { ...activity, id: 'a3' }] }],
  ])('rejects activities reply: %s', async (_name, reply) => {
    const { client } = setup(reply);
    await expect(client.activities('p1', { limit: 2 }, 'u1')).rejects.toMatchObject({ code: 'integrity' });
  });

  it.each([
    ['other transcript', { ...read, transcript: { ...transcript, id: 't9' } }],
    ['non-string text', { ...read, transcript: { ...transcript, rawText: { a: 1 } } }],
    ['unknown key', { ...read, transcript: { ...transcript, internal: 'x' } }],
    ['zero linked projects', { ...read, linked_project_count: 0 }],
    ['project ids leaked', { ...read, linked_projects: ['q'] }],
    ['bad revision', { ...read, transcript_version: 'x' }],
  ])('rejects transcript reply: %s', async (_name, reply) => {
    const { client } = setup(reply);
    await expect(client.transcript('p1', 't1', 'u1')).rejects.toMatchObject({ code: 'integrity' });
  });

  it('rejects an oversized body with an explicit size message', async () => {
    const { client } = setup({ ...read, transcript: { ...transcript, rawText: 'x'.repeat(1048577) } });
    await expect(client.transcript('p1', 't1', 'u1')).rejects.toThrow(/larger than the allowed size/);
    const exact = setup({ ...read, transcript: { ...transcript, rawText: 'x'.repeat(1048576) } });
    expect((await exact.client.transcript('p1', 't1', 'u1')).transcript.rawText.length).toBe(1048576);
  });

  it.each([
    ['manual_history_forbidden', 'access'], ['manual_transcript_unavailable', 'not_found'], ['manual_transcript_too_large', 'integrity'],
    ['invalid_manual_history_state', 'integrity'], ['project_forbidden', 'access'], ['project_reads_disabled', 'paused'],
  ])('maps server error %s to %s', async (error, code) => {
    const { client } = setup({ ok: false, error, status: 403 });
    await expect(client.transcript('p1', 't1', 'u1')).rejects.toMatchObject({ code });
  });

  it('validates ids and cursor shape before any call', async () => {
    const { client, callable } = setup(read);
    await expect(client.transcript('p1', '../t', 'u1')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(client.activities('p1', { limit: 101 }, 'u1')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(callable).not.toHaveBeenCalled();
  });

  it('refuses a reply after the signed-in account changed', async () => {
    let uid = 'u1';
    const callable = vi.fn(async () => { uid = 'u2'; return { data: read }; });
    const client = createNativeProjectReadClient({ currentUid: () => uid, callable });
    await expect(client.transcript('p1', 't1', 'u1')).rejects.toMatchObject({ code: 'identity_changed' });
  });
});
