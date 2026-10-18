-- Muuvi: auditoria somente leitura das políticas e privilégios atuais.
-- Este arquivo NÃO altera dados, políticas ou permissões.
-- Execute no SQL Editor do projeto Supabase correto e revise o resultado antes de aplicar
-- a migração de moderação. Não compartilhe tokens, chaves ou dados pessoais nos resultados.

-- 1) Todas as políticas RLS que podem afetar a comunidade e as imagens.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where (schemaname = 'public' and tablename in (
    'posts',
    'post_comments',
    'post_likes',
    'post_reports',
    'community_moderators',
    'community_admins',
    'moderation_actions'
  ))
  or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, cmd, policyname;

-- 2) Privilégios explícitos de tabela para os papéis usados pela aplicação.
-- RLS e GRANT são camadas distintas; ambas precisam estar corretas.
select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where (
    (table_schema = 'public' and table_name in (
      'posts',
      'post_comments',
      'post_likes',
      'post_reports',
      'community_moderators',
      'community_admins',
      'moderation_actions'
    ))
    or (table_schema = 'storage' and table_name = 'objects')
  )
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_schema, table_name, grantee, privilege_type;

-- 3) Privilégios em nível de coluna para os campos protegidos pela moderação.
select
  table_schema,
  table_name,
  column_name,
  grantee,
  privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and (
    (table_name = 'posts' and column_name in (
      'moderation_status', 'moderated_at', 'moderated_by'
    ))
    or (table_name = 'post_reports' and column_name in (
      'review_status', 'reviewed_at', 'reviewed_by'
    ))
  )
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, column_name, grantee, privilege_type;

-- Interpretação:
-- * Políticas permissivas (permissive = PERMISSIVE) são combinadas por OR.
-- * Procure políticas adicionais de SELECT/DELETE em posts e de SELECT em storage.objects.
-- * Verifique especialmente políticas de SELECT no bucket post-images e políticas de DELETE
--   em posts; uma política adicional pode neutralizar a restrição proposta.
-- * Não remova nem altere políticas com base apenas no nome: valide o propósito e o uso no app.
