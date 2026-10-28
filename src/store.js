import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// One SQLite database is shared by stdio and HTTP processes. Revisions protect
// against stale proposals, including proposals created in another chat.
export class Store {
  constructor(dir) {
    if (dir !== ':memory:') mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = dir === ':memory:' ? dir : join(dir, 'state.sqlite');
    this.db = new DatabaseSync(path);
    if (dir !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));`);
  }
  get(kind, id = 'current') {
    const row = this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind, id);
    return row ? JSON.parse(row.body) : null;
  }
  list(kind) {
    return this.db.prepare('SELECT body FROM records WHERE kind=? ORDER BY id').all(kind).map(row => JSON.parse(row.body));
  }
  put(kind, value, id = 'current') {
    this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind, id, JSON.stringify(value));
    return value;
  }
  propose(plan, reason, baseRevision) {
    const proposal = { id: randomUUID(), createdAt: new Date().toISOString(), baseRevision, reason, plan };
    return this.put('proposal', proposal, proposal.id);
  }
  commit(id, revision) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const proposal = this.get('proposal', id);
      if (!proposal) throw new Error('Nie znaleziono propozycji.');
      if (proposal.committedAt) throw new Error('Ta propozycja została już zatwierdzona.');
      const current = this.get('plan');
      if (revision !== (current?.revision ?? 0) || proposal.baseRevision !== revision) throw new Error('Plan zmienił się od utworzenia propozycji. Pobierz aktualny plan i przygotuj nową propozycję.');
      if (Date.now() - Date.parse(proposal.createdAt) > 86400000) throw new Error('Propozycja wygasła po 24 godzinach. Przygotuj nową.');
      if (current) this.put('history', current, String(current.revision).padStart(8, '0'));
      const plan = { ...proposal.plan, revision: revision + 1, updatedAt: new Date().toISOString() };
      this.put('plan', plan);
      this.put('proposal', { ...proposal, committedAt: plan.updatedAt }, id);
      this.db.exec('COMMIT');
      return plan;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
