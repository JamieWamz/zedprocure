exports.up = pgm => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS support_issue_comments (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      issue_id UUID NOT NULL REFERENCES support_issues(id) ON DELETE CASCADE,
      author_user_id UUID NOT NULL,
      author_user_type VARCHAR(32) NOT NULL
        CHECK (author_user_type IN ('platform_admin','tenant_user','supplier_user')),
      author_name VARCHAR(150),
      author_email VARCHAR(255) NOT NULL,
      body TEXT NOT NULL CHECK (char_length(body) BETWEEN 2 AND 4000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS support_issue_comments_issue_created_idx
      ON support_issue_comments(issue_id, created_at ASC);
  `);
};

exports.down = pgm => {
  pgm.sql('DROP TABLE IF EXISTS support_issue_comments;');
};
