CREATE TABLE "award_matches" (
	"award_id" integer NOT NULL,
	"piece_id" integer NOT NULL,
	"match_score" real NOT NULL,
	CONSTRAINT "award_matches_award_id_piece_id_pk" PRIMARY KEY("award_id","piece_id")
);
--> statement-breakpoint
ALTER TABLE "award_matches" ADD CONSTRAINT "award_matches_award_id_awards_id_fk" FOREIGN KEY ("award_id") REFERENCES "public"."awards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_matches" ADD CONSTRAINT "award_matches_piece_id_pieces_id_fk" FOREIGN KEY ("piece_id") REFERENCES "public"."pieces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "award_matches_piece_idx" ON "award_matches" USING btree ("piece_id");