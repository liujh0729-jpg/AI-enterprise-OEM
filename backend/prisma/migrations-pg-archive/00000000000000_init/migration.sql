-- Harbor bootstrap. No User model: stores userId strings only.
CREATE TABLE "_schema_meta" (
    "key" VARCHAR(64) NOT NULL,
    "value" VARCHAR(200) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_schema_meta_pkey" PRIMARY KEY ("key")
);
