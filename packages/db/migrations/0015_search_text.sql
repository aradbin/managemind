-- Hand-written (phase-3-plan §3.7): the normalized form search compares, so
-- shoppers find a product however they spell a Bangla word. Immutable, so
-- trigram indexes can be built on it (migration 0016):
--   NFC, which also decomposes ড়, ঢ় and য় (composition exclusions), so the
--   precomposed and decomposed spellings become the same text;
--   lowercase;
--   zero-width non-joiner and joiner removed;
--   long vowel signs folded into short ones: ী -> ি, ূ -> ু.
CREATE FUNCTION app.search_text(input text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = ''
AS $$
  SELECT translate(lower(normalize(input, NFC)), U&'\09C0\09C2\200C\200D', U&'\09BF\09C1')
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.search_text(text) TO app_rw;
