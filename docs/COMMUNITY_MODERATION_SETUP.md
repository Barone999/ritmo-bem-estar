# Configuração da moderação da comunidade Muuvi

> **Estado:** proposta em branch para revisão. Não execute a migração no banco real antes de revisar e aprovar o SQL.

## O que a migração faz

- Cria `community_admins` para administradores e `community_moderators` para moderadores; são níveis distintos.
- Expõe `set_community_moderator`, RPC que só aceita chamadas de um administrador autenticado, para adicionar/remover moderadores sem escrita direta nas tabelas de permissões.
- Cria `moderation_actions` como histórico de auditoria, sem escrita direta pelo cliente.
- Adiciona `moderation_status` às publicações (`visible`, `hidden`, `removed`) e campos de auditoria.
- Adiciona estado de análise às denúncias (`pending`, `reviewed`, `dismissed`).
- Restringe a leitura de denúncias e do histórico a moderadores.
- Oculta publicações não visíveis e seus comentários/curtidas do restante da comunidade.
- Expõe a RPC `moderate_community_post`, que verifica a autorização no servidor, aplica a ação e registra o motivo e a quantidade de denúncias afetadas no histórico na mesma transação.
- Protege os campos de moderação e revisão por triggers de banco: alterações protegidas só passam enquanto a RPC de moderação validada está executando, para impedir que até um moderador contorne o histórico. Como `REVOKE` em nível de coluna não anula um eventual `UPDATE` concedido à tabela inteira, a migração também revoga os privilégios de escrita amplos e concede somente os campos necessários para criar publicações e denúncias.
- Não apaga permanentemente publicações nem modifica tabelas de ciclo menstrual.
- Remove a política de exclusão direta de publicações por clientes comuns, evitando exclusões físicas acidentais e cascatas em comentários, curtidas e denúncias. A moderação usa remoção lógica.

## Configurar o primeiro administrador após aprovação da migração

Faça isto apenas no SQL Editor autenticado do projeto Supabase/Lovable Cloud correto, por uma pessoa que já tenha acesso administrativo ao projeto. Não exponha credenciais de serviço no frontend.

1. Crie/identifique a conta que será a primeira administradora e faça login no Muuvi ao menos uma vez.
2. No SQL Editor, confirme o e-mail exato dessa conta. Substitua `EMAIL_EXATO_DA_CONTA` pelo e-mail real. O bloco falha se não encontrar exatamente uma conta; ele não cria usuários nem concede acesso por cadastro público.
3. Após a migração ser aprovada e aplicada, execute:

```sql
do $$
declare
  v_user_id uuid;
begin
  select id
    into strict v_user_id
    from auth.users
   where lower(email) = lower('EMAIL_EXATO_DA_CONTA');

  insert into public.community_admins (user_id, created_by)
  values (v_user_id, null)
  on conflict (user_id) do nothing;

  -- O administrador inicial também recebe acesso à fila de moderação.
  insert into public.community_moderators (user_id, created_by)
  values (v_user_id, null)
  on conflict (user_id) do nothing;
end
$$;
```

4. Entre nessa conta no Muuvi e abra Comunidade. A entrada **Moderação** deve aparecer.
5. Na tela **Comunidade → Moderação**, a seção **Equipe de moderação** aparece somente para a conta administradora e permite adicionar/remover moderadores informando o UUID da conta. A RPC `set_community_moderator(p_user_id, p_is_moderator)` valida a autorização novamente no banco; usuários comuns e moderadores não administradores devem receber erro de permissão. Confirme o fluxo com contas fictícias antes de produção.
6. Confirme que uma conta comum não consegue abrir a fila nem executar `moderate_community_post`. A autorização é validada no banco; esconder o link não é a proteção.
7. Teste ocultar, restaurar, remoção lógica e arquivamento de denúncias com publicações e contas fictícias. Verifique o histórico, incluindo `reports_affected`, e que a publicação removida pode ser restaurada por um moderador.

## Antes de executar em produção

- Revise o SQL da migração `20261015190000_add_community_moderation.sql`.
- Antes de produção, inventarie todas as políticas RLS de `posts`, `post_comments`, `post_likes` e `storage.objects` para o bucket `post-images`. Políticas permissivas adicionais podem se combinar por OR e anular parte das restrições desta migração. Confirme também se a política `delete own post` é a única política de exclusão física de publicações.
- Faça primeiro um teste em um projeto/ambiente de teste com contas fictícias.
- Após aplicar, teste explicitamente com duas contas diferentes: usuário comum e moderador.
- Não use a conta da esposa nem altere registros de ciclo menstrual para testar a moderação.
