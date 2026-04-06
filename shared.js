'use strict';

const crypto = require('crypto');

const ENUMS = {
  gameStatus: new Set(['BACKLOG', 'PLAYING', 'COMPLETED', 'DROPPED']),
  platform: new Set(['PC', 'PS', 'XBOX', 'SWITCH', 'MOBILE']),
  questState: new Set(['TODO', 'IN_PROGRESS', 'DONE']),
  questPriority: new Set(['LOW', 'MEDIUM', 'HIGH']),
  questType: new Set(['STORY', 'ACHIEVEMENT', 'GRIND', 'CUSTOM'])
};

const isoNow = () => new Date().toISOString();
const isStr = v => typeof v === 'string' && v.trim().length > 0;
const toInt = (v, fallback) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback);
const randomId = () => crypto.randomUUID();

function sendError(res, status, code, message, details = null) {
  return res.status(status).json({ error: { code, message, details } });
}

const err400 = (res, message, details) => sendError(res, 400, 'BAD_REQUEST', message, details);
const err404 = (res, message) => sendError(res, 404, 'NOT_FOUND', message);
const err409 = (res, message, details) => sendError(res, 409, 'CONFLICT', message, details);
const err422 = (res, message, details) => sendError(res, 422, 'VALIDATION_ERROR', message, details);
const err500 = (res) => sendError(res, 500, 'INTERNAL_ERROR', 'Unexpected error');

function parsePagination(req, res) {
  const page = toInt(req.query.page, 1);
  const pageSize = toInt(req.query.pageSize, 20);

  if (page < 1) return { ok: false, res: err400(res, 'Invalid "page". Must be >= 1') };
  if (pageSize < 1 || pageSize > 200) return { ok: false, res: err400(res, 'Invalid "pageSize". Must be 1..200') };

  return { ok: true, page, pageSize };
}

function parseSort(sortStr, allowed, defField = 'updatedAt', defDir = 'desc') {
  if (!sortStr) return { field: defField, dir: defDir };

  const [fieldRaw, dirRaw] = String(sortStr).split(',');
  const field = (fieldRaw || '').trim();
  const dir = ((dirRaw || '').trim().toLowerCase() || defDir);

  if (!allowed.has(field)) return { field: defField, dir: defDir };
  if (dir !== 'asc' && dir !== 'desc') return { field: defField, dir: defDir };

  return { field, dir };
}

function sortItems(items, { field, dir }) {
  const mul = dir === 'asc' ? 1 : -1;
  return items.sort((a, b) => {
    const av = a[field];
    const bv = b[field];

    if (av == null && bv == null) return 0;
    if (av == null) return -1 * mul;
    if (bv == null) return 1 * mul;

    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul;
    return String(av).localeCompare(String(bv)) * mul;
  });
}

function paginate(items, page, pageSize) {
  const total = items.length;
  const start = (page - 1) * pageSize;
  return {
    data: items.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize)
  };
}

function validate(body, rules, { partial = false } = {}) {
  const errors = [];

  for (const r of rules) {
    const val = body[r.field];

    if (val === undefined) {
      if (r.required && !partial) errors.push({ field: r.field, message: 'Required' });
      continue;
    }

    if (r.type === 'string') {
      if (!isStr(val)) errors.push({ field: r.field, message: 'Must be a non-empty string' });
      continue;
    }

    if (r.type === 'string|null') {
      if (val !== null && typeof val !== 'string') errors.push({ field: r.field, message: 'Must be string or null' });
      continue;
    }

    if (r.type === 'enum') {
      if (!r.set.has(val)) errors.push({ field: r.field, message: `Must be one of: ${Array.from(r.set).join(', ')}` });
      continue;
    }

    if (r.type === 'number') {
      const n = Number(val);
      if (!Number.isFinite(n)) errors.push({ field: r.field, message: 'Must be a number' });
      else if (r.min != null && n < r.min) errors.push({ field: r.field, message: `Must be >= ${r.min}` });
      else if (r.max != null && n > r.max) errors.push({ field: r.field, message: `Must be <= ${r.max}` });
      continue;
    }

    if (r.type === 'date|null') {
      if (val === null) continue;
      const d = new Date(val);
      if (Number.isNaN(d.getTime())) errors.push({ field: r.field, message: 'Must be a valid ISO date string or null' });
      continue;
    }
  }

  return errors;
}

const GAME_RULES = [
  { field: 'ownerId', type: 'number', required: true, min: 1 },
  { field: 'title', type: 'string', required: true },
  { field: 'platform', type: 'enum', set: ENUMS.platform, required: false },
  { field: 'status', type: 'enum', set: ENUMS.gameStatus, required: false },
  { field: 'rating', type: 'number', required: false, min: 0, max: 10 },
  { field: 'notes', type: 'string|null', required: false }
];

const QUEST_RULES = [
  { field: 'title', type: 'string', required: true },
  { field: 'description', type: 'string|null', required: false },
  { field: 'type', type: 'enum', set: ENUMS.questType, required: true },
  { field: 'state', type: 'enum', set: ENUMS.questState, required: true },
  { field: 'priority', type: 'enum', set: ENUMS.questPriority, required: true },
  { field: 'dueDate', type: 'date|null', required: false }
];

function normalizeGameInput(body) {
  return {
    ownerId: body.ownerId !== undefined ? Number(body.ownerId) : undefined,
    title: body.title !== undefined && body.title !== null ? String(body.title).trim() : undefined,
    platform: body.platform ?? undefined,
    status: body.status ?? undefined,
    rating: body.rating ?? undefined,
    notes: body.notes ?? undefined
  };
}

function normalizeQuestInput(body) {
  return {
    title: body.title !== undefined && body.title !== null ? String(body.title).trim() : undefined,
    description: body.description ?? undefined,
    type: body.type ?? undefined,
    state: body.state ?? undefined,
    priority: body.priority ?? undefined,
    dueDate: body.dueDate ?? undefined
  };
}

module.exports = {
  ENUMS,
  isoNow,
  randomId,
  err400,
  err404,
  err409,
  err422,
  err500,
  parsePagination,
  parseSort,
  sortItems,
  paginate,
  validate,
  GAME_RULES,
  QUEST_RULES,
  normalizeGameInput,
  normalizeQuestInput
};