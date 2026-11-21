-- Hand-written (ADR 0035, DECISIONS.md "What to build next"): Bangla and
-- Banglish search. app.search_key turns a title or a query, in Bangla or in
-- Latin letters, into a rough key of its sounds, so "কড়াই", "korai",
-- "karai" and "kadai" meet:
--   app.search_text first (NFC, lowercase, ী -> ি, ূ -> ু);
--   Latin spellings of one sound folded (ch, kh, sh, ph, ng, ee, oo, ck, x);
--   Bangla letters mapped to the Latin ones (ক খ -> k, শ ষ স -> s, ...);
--   a and o left out on both sides, as অ, আ and ও are spelled every way in
--   Latin; e and i made one; doubled letters counted once;
--   ড় and ঢ়, written r or d in Latin, give the key both ways ("kri kdi").
-- app.search_key_matches says whether every word of a query's key starts a
-- word of a title's key (a word of one or two letters must be the whole
-- word, so "cha" doesn't match everything that starts with c).
CREATE FUNCTION app.search_key(input text) RETURNS text
  LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = ''
AS $$
DECLARE
  t text := app.search_text(input);
BEGIN
  -- Letters with a nukta stay decomposed after NFC: ড় and ঢ় are written r or d in Latin.
  t := replace(t, U&'\09A1\09BC', 'R');
  t := replace(t, U&'\09A2\09BC', 'R');
  t := replace(t, U&'\09AF\09BC', '');
  -- ক্ষ sounds k(h); য-ফলা adds no letter in Latin (ব্যাগ, bag).
  t := replace(t, U&'\0995\09CD\09B7', 'k');
  t := replace(t, U&'\09CD\09AF', '');
  -- Latin spellings of one sound.
  t := regexp_replace(t, 'chh|ch', 'C', 'g');
  t := replace(t, 'ck', 'k');
  t := regexp_replace(t, 'kh', 'k', 'g');
  t := regexp_replace(t, 'gh', 'g', 'g');
  t := regexp_replace(t, 'jh', 'j', 'g');
  t := regexp_replace(t, 'th', 't', 'g');
  t := regexp_replace(t, 'dh', 'd', 'g');
  t := regexp_replace(t, 'ph', 'f', 'g');
  t := regexp_replace(t, 'bh', 'b', 'g');
  t := regexp_replace(t, 'sh', 's', 'g');
  t := regexp_replace(t, 'ng', 'n', 'g');
  t := regexp_replace(t, 'ee', 'i', 'g');
  t := regexp_replace(t, 'oo', 'u', 'g');
  t := regexp_replace(t, 'x', 'ks', 'g');
  t := translate(t, 'cvzqwyao', 'kbjk');
  t := replace(t, 'C', 'c');
  -- Bangla: vowels, then consonants. অ, আ, া, ও, ো are left out, as a and o
  -- are in Latin: Banglish spells them every way.
  t := replace(t, U&'\098B', 'ri');
  t := replace(t, U&'\09C3', 'ri');
  t := translate(t,
    U&'\0987\0988\09BF\0989\098A\09C1\098F\09C7\0990\09C8\0994\09CC\0985\0986\09BE\0993\09CB',
    'iiiuuueeiiuu');
  t := translate(t,
    U&'\0995\0996\0997\0998\0999\0982\099A\099B\099C\099D\09AF\099E\09A3\09A8\099F\09A0\09A4\09A5\09CE\09A1\09A2\09A6\09A7\09AA\09AB\09AC\09AD\09AE\09B0\09B2\09B6\09B7\09B8\09B9',
    'kkggnnccjjjnnnttttTddddpfbbmrlsssh');
  t := replace(t, 'T', 't');
  -- e and i swap in Banglish (peyaj, piaj): one letter.
  t := translate(t, 'e', 'i');
  -- Bangla marks go (hasanta, chandrabindu, visarga, nukta); anything else
  -- left (punctuation, a hyphen) parts words. Doubled letters count once.
  t := translate(t, U&'\09CD\0981\0983\09BC', '');
  t := regexp_replace(t, '[^a-zR0-9]+', ' ', 'g');
  t := regexp_replace(t, '(.)\1+', '\1', 'g');
  t := btrim(regexp_replace(t, ' +', ' ', 'g'));
  IF position('R' in t) > 0 THEN
    t := replace(t, 'R', 'r') || ' ' || replace(t, 'R', 'd');
  END IF;
  RETURN t;
END
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.search_key(text) TO app_rw;
--> statement-breakpoint
CREATE FUNCTION app.search_key_matches(key text, query text) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = ''
AS $$
  SELECT query <> '' AND NOT EXISTS (
    SELECT 1 FROM unnest(string_to_array(query, ' ')) w
     WHERE w <> '' AND NOT EXISTS (
       SELECT 1 FROM unnest(string_to_array(key, ' ')) k
        WHERE CASE WHEN length(w) <= 2 THEN k = w ELSE left(k, length(w)) = w END))
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.search_key_matches(text, text) TO app_rw;
