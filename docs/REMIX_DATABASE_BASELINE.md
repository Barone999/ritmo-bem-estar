# Baseline documental do banco — Muuvi Remix de testes

> **Somente documentação.** Este arquivo descreve a auditoria de leitura informada para o projeto Remix de testes. Não é uma migração e não deve ser executado como SQL.

## Escopo e segurança

- O Remix possui uma instância Lovable Cloud separada do projeto original.
- O banco está ativo e, na auditoria, não havia usuários em `auth.users`.
- A estrutura foi copiada, mas os registros do banco não foram copiados.
- Não executar migrações nem SQL de escrita como parte desta documentação.
- Não conectar o projeto de testes ao backend original.
- Não modificar tabelas de ciclo menstrual para testar moderação.

## Tabelas existentes

A auditoria identificou nove tabelas no schema `public`, todas com RLS ativo:

- `profiles`
- `cycle_logs`
- `cycle_settings`
- `workout_sessions`
- `recipe_favorites`
- `posts`
- `post_comments`
- `post_likes`
- `post_reports`

Este inventário é o resumo disponível da auditoria; consultar o schema do projeto de testes antes de preparar qualquer migração.

## Relacionamentos e restrições reportados

- `post_comments.post_id` referencia `posts.id` com `ON DELETE CASCADE`.
- `post_likes.post_id` referencia `posts.id` com `ON DELETE CASCADE`.
- `post_reports.post_id` referencia `posts.id` com `ON DELETE CASCADE`.
- `profiles` referencia `auth.users` com `ON DELETE CASCADE`.
- `post_reports` possui restrição única em `(post_id, user_id)`.
- `post_likes` possui chave composta `(post_id, user_id)`.
- `cycle_logs` possui restrição única em `(user_id, log_date)`.

As cascatas de publicações tornam essencial preferir remoção lógica para conteúdo moderado, preservando comentários, curtidas e denúncias.

## RLS, privilégios e políticas atuais relevantes

A auditoria reportou privilégios amplos de tabela para os papéis `anon` e `authenticated`, enquanto as políticas RLS restringem as linhas. Uma migração futura precisa revisar grants e policies em conjunto: retirar permissões de tabela sem conceder de volta as operações necessárias pode quebrar o app, e permissões amplas podem permitir operações não pretendidas.

### Publicações

- Política de leitura permite leitura para usuários autenticados (`USING true`).
- Política de inserção restringe a própria publicação.
- A política de exclusão existente permite ao autor excluir sua publicação.
- Não foi identificada política de UPDATE na auditoria.

### Denúncias

- Política identificada permite inserir a própria denúncia.
- O cliente cria denúncias com `post_id`, `user_id` e `reason`; esse fluxo precisa continuar funcionando.
- A leitura das denúncias deve ser restrita à equipe autorizada após a implementação da moderação.

### Storage

- Bucket `post-images`, privado, limite reportado de 10 MB.
- Leitura atual permitida a usuários autenticados.
- Upload limitado à pasta do próprio usuário.
- O app usa URLs assinadas. Uma URL assinada já emitida pode continuar válida até expirar; a política de Storage não invalida retroativamente URLs existentes. O fluxo de geração e duração dessas URLs precisa ser revisado antes de prometer que imagens ocultas ficam imediatamente inacessíveis.

## Funções e triggers reportados

- Funções: `handle_new_user()` e `set_community_author_name()`.
- Triggers: `posts_set_author_name` e `post_comments_set_author_name`, reportados como `BEFORE INSERT OR UPDATE`.
- A auditoria não encontrou trigger ligado a `auth.users` para chamar `handle_new_user()`. Assim, o provisionamento automático de `profiles` precisa ser investigado e corrigido em uma etapa separada, com testes, sem misturá-lo silenciosamente à migração de moderação.

## Migrações e versionamento

- O histórico Drizzle `drizzle.__drizzle_migrations` foi reportado vazio.
- `drizzle/schema.ts` foi deixado como placeholder vazio no Remix.
- A auditoria informou que o mecanismo ativo de migrações deste projeto é Drizzle Kit e que `supabase/migrations/` é herdada/histórica. Confirmar isso no pipeline real antes de qualquer aplicação.
- Os arquivos em `supabase/migrations/` não devem ser tratados automaticamente como o histórico aplicado deste banco.
- Este documento é uma fotografia descritiva, não um baseline executável. Não registrar migrações diretamente na tabela de histórico.

## Estruturas de moderação ausentes na auditoria

Não foram identificadas:

- `community_moderators`
- `community_admins`
- `moderation_actions`
- coluna `posts.moderation_status`
- campos de revisão em `post_reports`
- RPC `moderate_community_post`

A lista reflete a auditoria informada e deve ser confirmada antes de qualquer implementação.

## Condições antes de preparar/aplicar uma migração

1. Confirmar o mecanismo de migração executado pelo projeto de testes.
2. Capturar o schema real completo, grants, policies, triggers e funções.
3. Projetar grants mínimos sem quebrar criação de posts, comentários, curtidas e denúncias.
4. Revisar todas as policies permissivas, pois policies permissivas aplicáveis podem se combinar por OR.
5. Não usar um marcador GUC customizado como única prova de autorização para alterações protegidas; essa abordagem foi rejeitada para esta implementação.
6. Definir como as alterações protegidas serão feitas por uma RPC autenticada e autorizada no servidor, com auditoria transacional.
7. Testar acesso a imagens e URLs assinadas de conteúdo oculto/removido.
8. Testar somente com contas e conteúdo fictícios no Remix isolado.
9. Não inicializar o administrador até o SQL e o procedimento privilegiado serem revisados e aprovados.

## Estado

Este arquivo documenta a auditoria reportada. Não altera nem comprova o estado atual do banco em tempo real. Nenhuma migração ou SQL de escrita foi executada ao criar este documento.
