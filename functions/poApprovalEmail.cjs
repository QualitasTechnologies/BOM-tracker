'use strict';

// Pure builder for PO approval notification emails (no I/O, no provider calls).
// Layout, colours, copy and subjects match the original notifyPOApproval email.

const FROM = 'BOM Tracker <info@qualitastech.com>';
const DEFAULT_WORKSPACE_URL = 'https://visionbomtracker.web.app';
const WORKSPACE_NAMES = ['BOM Tracker', 'Pulse'];
const MODES = ['submitted', 'changes-requested'];

// Allowed deep-link roots: origin -> exact base path.
const ALLOWED_ROOTS = {
  'https://visionbomtracker.web.app': '',
  'https://eagle-eye.qualitastech.com': '/pulse/bom',
};

const MAX_ID = 512;
const MAX_NAME = 500;
const MAX_NOTE = 5000;
const MAX_RECIPIENTS = 50;
const MAX_EMAIL = 254;

const EMAIL_RE = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const NOTE_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatINR = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

function requireString(input, key, max, { optional = false, multiline = false } = {}) {
  // Only the unchanged legacy callable opts into its former permissive field rendering.
  if(input.legacyCompatibility===true){const value=input[key]||'';if(typeof value!=='string')throw new Error(`${key} must be a string`);return value;}
  const v = input[key];
  if (v === undefined || v === null || v === '') {
    if (optional) return '';
    throw new Error(`${key} is required`);
  }
  if (typeof v !== 'string') throw new Error(`${key} must be a string`);
  if (v.length > max) throw new Error(`${key} is too long`);
  if ((multiline ? NOTE_CONTROL_RE : CONTROL_RE).test(v)) {
    throw new Error(`${key} contains control characters`);
  }
  if (!v.trim()) throw new Error(`${key} is required`);
  return v;
}

function normalizeRecipients(to,legacy=false) {
  const list = typeof to === 'string' ? [to] : to;
  if (!Array.isArray(list) || list.length === 0 || list.length > (legacy?1000:MAX_RECIPIENTS)) {
    throw new Error('to must be 1-' + MAX_RECIPIENTS + ' email addresses');
  }
  for (const addr of list) {
    if (typeof addr !== 'string' || addr.length > MAX_EMAIL || !EMAIL_RE.test(addr)) {
      throw new Error('Invalid recipient address');
    }
  }
  return typeof to === 'string' ? to : Object.freeze([...list]);
}

function resolveBaseUrl(workspaceUrl) {
  if (workspaceUrl === undefined || workspaceUrl === null) return DEFAULT_WORKSPACE_URL;
  if (typeof workspaceUrl !== 'string' || !workspaceUrl || workspaceUrl.length > 200) {
    throw new Error('Invalid workspaceUrl');
  }
  if (/[\s\\?#]/.test(workspaceUrl) || CONTROL_RE.test(workspaceUrl)) {
    throw new Error('Invalid workspaceUrl');
  }
  let url;
  try {
    url = new URL(workspaceUrl);
  } catch {
    throw new Error('Invalid workspaceUrl');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid workspaceUrl');
  }
  const expectedPath = ALLOWED_ROOTS[url.origin];
  const path = url.pathname.replace(/\/+$/, '');
  if (path !== expectedPath && !path.endsWith('/bom')) throw new Error('workspaceUrl path not allowed');
  return url.origin + path;
}

function buildPOApprovalEmail(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('input must be an object');
  }
  const { mode } = input;
  if (!MODES.includes(mode)) throw new Error('Invalid mode');

  const projectId = requireString(input, 'projectId', MAX_ID);
  const projectName = requireString(input, 'projectName', MAX_NAME);
  const poId = requireString(input, 'poId', MAX_ID, { optional: true });
  const poNumber = requireString(input, 'poNumber', MAX_NAME);
  const vendorName = requireString(input, 'vendorName', MAX_NAME);
  const actorName = requireString(input, 'actorName', MAX_NAME);
  const note = requireString(input, 'note', MAX_NOTE, { optional: true, multiline: true });

  const totalAmount=input.legacyCompatibility===true ? input.totalAmount||0 : input.totalAmount;
  if (input.legacyCompatibility!==true && (typeof totalAmount !== 'number' || !Number.isFinite(totalAmount))) {
    throw new Error('totalAmount must be a finite number');
  }

  let workspaceName = 'BOM Tracker';
  if (input.workspaceName !== undefined && input.workspaceName !== null) {
    if (!WORKSPACE_NAMES.includes(input.workspaceName)) throw new Error('Invalid workspaceName');
    workspaceName = input.workspaceName;
  }
  const baseUrl = resolveBaseUrl(input.workspaceUrl);
  const to = normalizeRecipients(input.to,input.legacyCompatibility===true);

  const amount = formatINR(totalAmount);
  const brand = esc(workspaceName);

  const poRows = [
    `<tr><td style="padding:6px 0;color:#666;width:130px;vertical-align:top;">Project</td><td style="padding:6px 0;font-weight:600;">${esc(projectName)}</td></tr>`,
    `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">PO Number</td><td style="padding:6px 0;">${esc(poNumber)}</td></tr>`,
    `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">Vendor</td><td style="padding:6px 0;">${esc(vendorName)}</td></tr>`,
    `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">Amount</td><td style="padding:6px 0;font-weight:700;font-size:17px;color:#0066cc;">${amount}</td></tr>`,
  ].join('');
  const poSummary = `<table style="width:100%;font-size:14px;border-collapse:collapse;margin:16px 0;">${poRows}</table>`;

  const footer = `
      <div style="padding:16px 28px;background:#f8f9fa;border-top:1px solid #eee;font-size:12px;color:#888;text-align:center;">
        ${brand} — Qualitas Technologies Pvt Ltd
      </div>`;

  const link =
    `${baseUrl}/project/${encodeURIComponent(projectId)}/bom?tab=documents` +
    (poId ? `&po=${encodeURIComponent(poId)}` : '');
  const ctaBtn = (label) =>
    `<a href="${esc(link)}" style="display:inline-block;margin-top:16px;padding:10px 22px;background:#0066cc;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">${label} →</a>`;

  const actor = esc(actorName);
  let subject;
  let html;

  if (mode === 'submitted') {
    subject = `PO Approval Required — ${poNumber} (${amount})`;
    html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;margin:0;padding:0;background:#f4f4f4;">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);overflow:hidden;">
  <div style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:28px 32px;">
    <h1 style="margin:0;color:#fff;font-size:22px;">PO Approval Required</h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,.9);font-size:14px;">${actor} has submitted a purchase order for review</p>
  </div>
  <div style="padding:28px 32px;">${poSummary}
    <p style="color:#666;font-size:14px;margin:20px 0 0;">Log in to ${brand} to review and send this PO, or request changes.</p>
    ${ctaBtn('Review PO')}
  </div>${footer}
</div></body></html>`;
  } else {
    subject = `Changes Requested — PO ${poNumber}`;
    html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;margin:0;padding:0;background:#f4f4f4;">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);overflow:hidden;">
  <div style="background:#dc2626;padding:28px 32px;">
    <h1 style="margin:0;color:#fff;font-size:22px;">Changes Requested</h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,.9);font-size:14px;">${actor} has requested changes to your purchase order</p>
  </div>
  <div style="padding:28px 32px;">
    ${note ? `<div style="background:#fef2f2;border:1px solid #dc262644;border-radius:6px;padding:10px 16px;margin-bottom:20px;">
      <p style="margin:0;font-weight:600;color:#dc2626;">Note:</p>
      <p style="margin:4px 0 0;color:#333;">${esc(note)}</p>
    </div>` : ''}
    ${poSummary}
    <p style="color:#666;font-size:14px;margin:20px 0 0;">The PO has been reverted to draft. Please make the requested changes and resubmit for approval.</p>
    ${ctaBtn('Open PO')}
  </div>${footer}
</div></body></html>`;
  }

  return Object.freeze({ from: FROM, to, subject, html });
}

module.exports = { buildPOApprovalEmail };
