'use strict';

const db = {
  games: new Map(),
  quests: new Map(),
  gameQuests: new Map(),

  outbox: new Map(),
  nextGameId: 1,
  nextQuestId: 1,
  nextOutboxId: 1
};

module.exports = db;