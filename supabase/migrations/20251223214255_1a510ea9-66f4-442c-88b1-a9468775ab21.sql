-- Add email column to subscribers table
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS email TEXT;

-- Create index for email search
CREATE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email);