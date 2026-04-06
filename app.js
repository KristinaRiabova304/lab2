'use strict';

const express = require('express');
const path = require('path');

const db = require('./db');
const {
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
} = require('./shared');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  req.traceId = randomId();
  res.setHeader('x-trace-id', req.traceId);
  next();
});

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/ui', express.static(path.join(process.cwd(), 'ui')));

function addOutboxEvent(type, aggregateType, aggregateId, payload, traceId) {
  const id = String(db.nextOutboxId++);

  const event = {
    id,
    eventId: randomId(),
    type,
    aggregateType,
    aggregateId: String(aggregateId),
    payload,
    traceId: traceId || null,
    createdAt: isoNow(),
    sentAt: null,
    status: 'PENDING'
  };

  db.outbox.set(id, event);
  return event;
}

function getGame(res, gameId) {
  const id = String(gameId);
  const game = db.games.get(id);
  if (!game) return { ok: false, res: err404(res, `Game ${id} not found`) };
  return { ok: true, game };
}

function getQuest(res, gameId, questId) {
  const gid = String(gameId);
  const qid = String(questId);

  const quest = db.quests.get(qid);
  if (!quest) return { ok: false, res: err404(res, `Quest ${qid} not found`) };

  if (String(quest.gameId) !== gid) {
    return { ok: false, res: err409(res, 'Quest does not belong to this game', { gameId: gid, questId: qid }) };
  }

  return { ok: true, quest };
}

app.get('/health', (req, res) => {
  res.json({ ok: true, time: isoNow(), traceId: req.traceId });
});

app.post('/games', (req, res) => {
  const body = normalizeGameInput(req.body || {});
  const errs = validate(body, GAME_RULES, { partial: false });
  if (errs.length) return err422(res, 'Game validation failed', errs);

  const id = String(db.nextGameId++);
  const createdAt = isoNow();

  const game = {
    id,
    ownerId: body.ownerId,
    title: body.title,
    platform: body.platform ?? 'PC',
    status: body.status ?? 'BACKLOG',
    rating: body.rating ?? null,
    notes: body.notes ?? null,
    createdAt,
    updatedAt: createdAt
  };

  db.games.set(id, game);
  if (!db.gameQuests.has(id)) db.gameQuests.set(id, new Set());

  addOutboxEvent('game.created', 'game', id, game, req.traceId);

  res.status(201).json(game);
});

app.get('/games', (req, res) => {
  const pg = parsePagination(req, res);
  if (!pg.ok) return;
  const { page, pageSize } = pg;

  const status = req.query.status ? String(req.query.status) : null;
  const platform = req.query.platform ? String(req.query.platform) : null;
  const search = req.query.search ? String(req.query.search).toLowerCase() : null;

  if (status && !ENUMS.gameStatus.has(status)) return err400(res, 'Invalid "status" filter');
  if (platform && !ENUMS.platform.has(platform)) return err400(res, 'Invalid "platform" filter');

  let items = Array.from(db.games.values());

  if (status) items = items.filter(x => x.status === status);
  if (platform) items = items.filter(x => x.platform === platform);
  if (search) {
    items = items.filter(x =>
      (x.title && x.title.toLowerCase().includes(search)) ||
      (x.notes && x.notes.toLowerCase().includes(search))
    );
  }

  const sort = parseSort(req.query.sort, new Set(['updatedAt', 'createdAt', 'title', 'status', 'platform', 'rating']));
  sortItems(items, sort);

  res.json(paginate(items, page, pageSize));
});

app.get('/games/:gameId', (req, res) => {
  const r = getGame(res, req.params.gameId);
  if (!r.ok) return;
  res.json(r.game);
});

app.put('/games/:gameId', (req, res) => {
  const id = String(req.params.gameId);
  const existing = db.games.get(id);
  if (!existing) return err404(res, `Game ${id} not found`);

  const body = normalizeGameInput(req.body || {});
  const errs = validate(body, GAME_RULES, { partial: false });
  if (errs.length) return err422(res, 'Game validation failed', errs);

  const updatedAt = isoNow();
  const game = {
    ...existing,
    ownerId: body.ownerId,
    title: body.title,
    platform: body.platform ?? 'PC',
    status: body.status ?? 'BACKLOG',
    rating: body.rating ?? null,
    notes: body.notes ?? null,
    updatedAt
  };

  db.games.set(id, game);
  addOutboxEvent('game.updated', 'game', id, game, req.traceId);

  res.json(game);
});

app.patch('/games/:gameId', (req, res) => {
  const id = String(req.params.gameId);
  const existing = db.games.get(id);
  if (!existing) return err404(res, `Game ${id} not found`);

  const body = normalizeGameInput(req.body || {});
  const errs = validate(body, GAME_RULES, { partial: true });
  if (errs.length) return err422(res, 'Game validation failed', errs);

  const game = {
    ...existing,
    ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)),
    updatedAt: isoNow()
  };

  db.games.set(id, game);
  addOutboxEvent('game.updated', 'game', id, game, req.traceId);

  res.json(game);
});

app.delete('/games/:gameId', (req, res) => {
  const id = String(req.params.gameId);
  if (!db.games.has(id)) return err404(res, `Game ${id} not found`);

  const qset = db.gameQuests.get(id);
  if (qset) {
    for (const qid of qset) {
      db.quests.delete(qid);
      addOutboxEvent('quest.deleted', 'quest', qid, { id: qid, gameId: id }, req.traceId);
    }
  }

  db.gameQuests.delete(id);
  db.games.delete(id);
  addOutboxEvent('game.deleted', 'game', id, { id }, req.traceId);

  res.status(204).send();
});

app.post('/games/:gameId/quests', (req, res) => {
  const gid = String(req.params.gameId);

  const g = getGame(res, gid);
  if (!g.ok) return;

  const body = normalizeQuestInput(req.body || {});
  const errs = validate(body, QUEST_RULES, { partial: false });
  if (errs.length) return err422(res, 'Quest validation failed', errs);

  const id = String(db.nextQuestId++);
  const createdAt = isoNow();

  const quest = {
    id,
    gameId: gid,
    title: body.title,
    description: body.description ?? null,
    type: body.type,
    state: body.state,
    priority: body.priority,
    dueDate: body.dueDate ?? null,
    createdAt,
    updatedAt: createdAt
  };

  db.quests.set(id, quest);
  if (!db.gameQuests.has(gid)) db.gameQuests.set(gid, new Set());
  db.gameQuests.get(gid).add(id);

  addOutboxEvent('quest.created', 'quest', id, quest, req.traceId);

  res.status(201).json(quest);
});

app.get('/games/:gameId/quests', (req, res) => {
  const gid = String(req.params.gameId);
  const g = getGame(res, gid);
  if (!g.ok) return;

  const pg = parsePagination(req, res);
  if (!pg.ok) return;
  const { page, pageSize } = pg;

  const state = req.query.state ? String(req.query.state) : null;
  const priority = req.query.priority ? String(req.query.priority) : null;
  const search = req.query.search ? String(req.query.search).toLowerCase() : null;

  if (state && !ENUMS.questState.has(state)) return err400(res, 'Invalid "state" filter');
  if (priority && !ENUMS.questPriority.has(priority)) return err400(res, 'Invalid "priority" filter');

  const qids = db.gameQuests.get(gid) || new Set();
  let items = Array.from(qids).map(id => db.quests.get(id)).filter(Boolean);

  if (state) items = items.filter(x => x.state === state);
  if (priority) items = items.filter(x => x.priority === priority);
  if (search) {
    items = items.filter(x =>
      (x.title && x.title.toLowerCase().includes(search)) ||
      (x.description && x.description.toLowerCase().includes(search))
    );
  }

  const sort = parseSort(req.query.sort, new Set(['updatedAt', 'createdAt', 'title', 'state', 'priority', 'type']));
  sortItems(items, sort);

  res.json(paginate(items, page, pageSize));
});

app.get('/games/:gameId/quests/:questId', (req, res) => {
  const gid = String(req.params.gameId);

  const g = getGame(res, gid);
  if (!g.ok) return;

  const q = getQuest(res, gid, req.params.questId);
  if (!q.ok) return;

  res.json(q.quest);
});

app.put('/games/:gameId/quests/:questId', (req, res) => {
  const gid = String(req.params.gameId);

  const g = getGame(res, gid);
  if (!g.ok) return;

  const q = getQuest(res, gid, req.params.questId);
  if (!q.ok) return;

  const body = normalizeQuestInput(req.body || {});
  const errs = validate(body, QUEST_RULES, { partial: false });
  if (errs.length) return err422(res, 'Quest validation failed', errs);

  const quest = {
    ...q.quest,
    title: body.title,
    description: body.description ?? null,
    type: body.type,
    state: body.state,
    priority: body.priority,
    dueDate: body.dueDate ?? null,
    updatedAt: isoNow()
  };

  db.quests.set(String(req.params.questId), quest);
  addOutboxEvent('quest.updated', 'quest', req.params.questId, quest, req.traceId);

  res.json(quest);
});

app.patch('/games/:gameId/quests/:questId', (req, res) => {
  const gid = String(req.params.gameId);

  const g = getGame(res, gid);
  if (!g.ok) return;

  const q = getQuest(res, gid, req.params.questId);
  if (!q.ok) return;

  const body = normalizeQuestInput(req.body || {});
  const errs = validate(body, QUEST_RULES, { partial: true });
  if (errs.length) return err422(res, 'Quest validation failed', errs);

  const quest = {
    ...q.quest,
    ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)),
    updatedAt: isoNow()
  };

  db.quests.set(String(req.params.questId), quest);
  addOutboxEvent('quest.updated', 'quest', req.params.questId, quest, req.traceId);

  res.json(quest);
});

app.delete('/games/:gameId/quests/:questId', (req, res) => {
  const gid = String(req.params.gameId);

  const g = getGame(res, gid);
  if (!g.ok) return;

  const q = getQuest(res, gid, req.params.questId);
  if (!q.ok) return;

  const qid = String(req.params.questId);
  db.quests.delete(qid);

  const set = db.gameQuests.get(gid);
  if (set) set.delete(qid);

  addOutboxEvent('quest.deleted', 'quest', qid, { id: qid, gameId: gid }, req.traceId);

  res.status(204).send();
});

app.get('/outbox', (req, res) => {
  res.json(Array.from(db.outbox.values()));
});

app.use((err, req, res, next) => {
  console.error(err);
  err500(res);
});

module.exports = app;