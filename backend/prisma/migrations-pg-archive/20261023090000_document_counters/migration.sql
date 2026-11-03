CREATE TABLE "document_counters" ("key" VARCHAR(32) PRIMARY KEY, "value" INTEGER NOT NULL CHECK ("value" > 0));
