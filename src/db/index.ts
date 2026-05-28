import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "../config.js";

mkdirSync(dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  user_id TEXT,
  message_id TEXT,
  text TEXT NOT NULL,
  reply_to_message_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reply_bank (
  id TEXT PRIMARY KEY,
  reply_text TEXT NOT NULL,
  clean_reply_text TEXT NOT NULL,
  normalized_hash TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  source_chat_id TEXT,
  source_user_id TEXT,
  source_message_id TEXT,
  category TEXT,
  intent TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 1,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS reply_pairs (
  id TEXT PRIMARY KEY,
  trigger_text TEXT NOT NULL,
  clean_trigger_text TEXT NOT NULL,
  reply_id TEXT NOT NULL,
  reply_text TEXT NOT NULL,
  source TEXT NOT NULL,
  source_chat_id TEXT,
  source_user_id TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(reply_id) REFERENCES reply_bank(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bot_response_history (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  user_id TEXT,
  user_message_id TEXT,
  user_message_text TEXT NOT NULL,
  bot_message_id TEXT,
  bot_response_text TEXT NOT NULL,
  was_approved INTEGER NOT NULL DEFAULT 0,
  was_rejected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_context (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  user_id TEXT,
  message_id TEXT,
  text TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS reply_bank_fts USING fts5(
  clean_reply_text,
  content='reply_bank',
  content_rowid='rowid'
);

CREATE VIRTUAL TABLE IF NOT EXISTS reply_pairs_fts USING fts5(
  clean_trigger_text,
  content='reply_pairs',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS reply_bank_ai AFTER INSERT ON reply_bank BEGIN
  INSERT INTO reply_bank_fts(rowid, clean_reply_text) VALUES (new.rowid, new.clean_reply_text);
END;
CREATE TRIGGER IF NOT EXISTS reply_bank_ad AFTER DELETE ON reply_bank BEGIN
  INSERT INTO reply_bank_fts(reply_bank_fts, rowid, clean_reply_text) VALUES('delete', old.rowid, old.clean_reply_text);
END;
CREATE TRIGGER IF NOT EXISTS reply_bank_au AFTER UPDATE ON reply_bank BEGIN
  INSERT INTO reply_bank_fts(reply_bank_fts, rowid, clean_reply_text) VALUES('delete', old.rowid, old.clean_reply_text);
  INSERT INTO reply_bank_fts(rowid, clean_reply_text) VALUES (new.rowid, new.clean_reply_text);
END;

CREATE TRIGGER IF NOT EXISTS reply_pairs_ai AFTER INSERT ON reply_pairs BEGIN
  INSERT INTO reply_pairs_fts(rowid, clean_trigger_text) VALUES (new.rowid, new.clean_trigger_text);
END;
CREATE TRIGGER IF NOT EXISTS reply_pairs_ad AFTER DELETE ON reply_pairs BEGIN
  INSERT INTO reply_pairs_fts(reply_pairs_fts, rowid, clean_trigger_text) VALUES('delete', old.rowid, old.clean_trigger_text);
END;
CREATE TRIGGER IF NOT EXISTS reply_pairs_au AFTER UPDATE ON reply_pairs BEGIN
  INSERT INTO reply_pairs_fts(reply_pairs_fts, rowid, clean_trigger_text) VALUES('delete', old.rowid, old.clean_trigger_text);
  INSERT INTO reply_pairs_fts(rowid, clean_trigger_text) VALUES (new.rowid, new.clean_trigger_text);
END;
`);

export function nowIso(): string {
  return new Date().toISOString();
}
