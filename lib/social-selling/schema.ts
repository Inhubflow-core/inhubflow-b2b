import type Database from "better-sqlite3";

export type SocialSellingPostStatus = "draft" | "scheduled" | "publishing" | "published" | "failed";
export type SocialSellingMediaType = "none" | "image" | "document";

export interface SocialSellingPost {
  id: string;
  user_id: string | null;
  account_id: string;
  topic: string | null;
  content: string;
  image_prompt?: string | null;
  media_url: string | null;
  media_type: SocialSellingMediaType;
  original_post_url: string | null;
  original_author: string | null;
  original_content: string | null;
  original_metrics_json: string | null;
  scheduled_at: string;
  status: SocialSellingPostStatus;
  linkedin_post_urn: string | null;
  error_message: string | null;
  created_at: string;
  published_at: string | null;
}

export function applySocialSellingSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_selling_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      topic TEXT,
      content TEXT NOT NULL,
      image_prompt TEXT,
      media_url TEXT,
      media_type TEXT NOT NULL DEFAULT 'none' CHECK(media_type IN ('none', 'image', 'document')),
      original_post_url TEXT,
      original_author TEXT,
      original_content TEXT,
      original_metrics_json TEXT,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('draft', 'scheduled', 'publishing', 'published', 'failed')),
      linkedin_post_urn TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_social_selling_posts_account_status ON social_selling_posts(account_id, status);
    CREATE INDEX IF NOT EXISTS idx_social_selling_posts_scheduled_at ON social_selling_posts(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_social_selling_posts_user ON social_selling_posts(user_id);
  `);

  try {
    db.exec(`ALTER TABLE social_selling_posts ADD COLUMN image_prompt TEXT;`);
  } catch {
    // Ya existe la columna
  }
}
