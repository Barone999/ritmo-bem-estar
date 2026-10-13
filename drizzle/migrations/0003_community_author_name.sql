-- Always derive community author names from the authenticated user's profile.
-- SECURITY DEFINER lets the trigger read the profile despite profile RLS; the
-- caller still cannot choose the name stored in posts or comments.
CREATE OR REPLACE FUNCTION public.set_community_author_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_name text;
BEGIN
  SELECT NULLIF(BTRIM(display_name), '')
    INTO profile_name
    FROM public.profiles
    WHERE id = NEW.user_id;

  IF profile_name IS NULL THEN
    RAISE EXCEPTION 'A valid profile is required to publish community content';
  END IF;

  NEW.author_name := profile_name;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_community_author_name() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER posts_set_author_name
BEFORE INSERT ON public.posts
FOR EACH ROW
EXECUTE FUNCTION public.set_community_author_name();

CREATE TRIGGER post_comments_set_author_name
BEFORE INSERT ON public.post_comments
FOR EACH ROW
EXECUTE FUNCTION public.set_community_author_name();
