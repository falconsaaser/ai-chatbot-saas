CREATE TABLE "end_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"botId" uuid NOT NULL,
	"endUserId" varchar(128) NOT NULL,
	"name" text,
	"email" varchar(254),
	"phone" varchar(32),
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endUserRefId" uuid NOT NULL,
	"botId" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"sourceMessageId" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "end_user" ADD CONSTRAINT "end_user_botId_bot_id_fk" FOREIGN KEY ("botId") REFERENCES "public"."bot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_endUserRefId_end_user_id_fk" FOREIGN KEY ("endUserRefId") REFERENCES "public"."end_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_botId_bot_id_fk" FOREIGN KEY ("botId") REFERENCES "public"."bot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_sourceMessageId_message_id_fk" FOREIGN KEY ("sourceMessageId") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "end_user_bot_end_user_uniq" ON "end_user" USING btree ("botId","endUserId");--> statement-breakpoint
CREATE INDEX "observation_end_user_idx" ON "observation" USING btree ("endUserRefId","createdAt");--> statement-breakpoint
CREATE INDEX "observation_bot_idx" ON "observation" USING btree ("botId");--> statement-breakpoint
CREATE INDEX "observation_embedding_idx" ON "observation" USING hnsw ("embedding" vector_cosine_ops) WHERE "observation"."embedding" IS NOT NULL;