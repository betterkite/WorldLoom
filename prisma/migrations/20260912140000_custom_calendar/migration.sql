-- C-2 自定义历法：世界级历法定义 + 事件月/日
ALTER TABLE worlds ADD COLUMN IF NOT EXISTS "calendarJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE chronicle_events ADD COLUMN IF NOT EXISTS "epochMonth" INTEGER;
ALTER TABLE chronicle_events ADD COLUMN IF NOT EXISTS "epochDay" INTEGER;
