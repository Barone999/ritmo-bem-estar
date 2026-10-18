# Matriz de permissões — comunidade Muuvi

> **Documento de projeto; não é SQL executável.** Matriz preliminar baseada no frontend e na auditoria documental do Remix. Confirmar grants, RLS e policies reais antes de transformar isto em migração.

## Princípios

- RLS e privilégios SQL são controles distintos; os dois precisam estar corretos.
- Policies permissivas aplicáveis ao mesmo comando podem combinar-se por OR. Auditar todas as policies existentes antes de substituir ou acrescentar qualquer uma.
- Operações privilegiadas devem ser feitas por RPC com validação de autorização no servidor.
- Não confiar na interface como fronteira de segurança.
- Não usar GUC customizado como prova de autorização.
- Não executar nem aplicar SQL com base apenas nesta matriz.

## Matriz de comportamento por papel

| Recurso/operação | Usuário comum autenticado | Moderador | Administrador |
| --- | --- | --- | --- |
| Consultar posts visíveis | Sim | Sim | Sim |
| Consultar posts ocultos/removidos | Não | Sim, para revisão | Sim, para revisão |
| Criar post próprio | Sim | Sim | Sim |
| Atualizar diretamente estado de moderação | Não | Não | Não; usar RPC |
| Excluir post fisicamente | Não | Não | Não; usar remoção lógica |
| Consultar comentários de posts visíveis | Sim | Sim | Sim |
| Criar comentário próprio em post visível | Sim | Sim | Sim |
| Excluir comentário próprio | Confirmar fluxo/policy existente | Confirmar fluxo/policy existente | Confirmar fluxo/policy existente |
| Criar curtida própria em post visível | Sim | Sim | Sim |
| Remover curtida própria | Sim | Sim | Sim |
| Comentar/curtir post oculto ou removido | Não | A política do produto deve decidir; por padrão, não necessário para moderação | A política do produto deve decidir; por padrão, não necessário para moderação |
| Criar denúncia própria em post visível | Sim | Sim | Sim |
| Consultar denúncias | Não | Sim | Sim |
| Alterar diretamente estado de revisão da denúncia | Não | Não; usar RPC | Não; usar RPC |
| Executar ação de moderação autorizada via RPC | Não | Sim | Sim |
| Consultar histórico de moderação | Não | Sim | Sim |
| Inserir/alterar/excluir histórico diretamente | Não | Não | Não |
| Consultar a própria associação de moderador | Sim, somente a própria linha | Sim | Sim |
| Listar equipe de moderadores | Não | Não, salvo decisão explícita futura | Sim |
| Adicionar/remover moderadores | Não | Não | Sim, via RPC |
| Remover da moderação a conta administradora inicial | Não | Não | Não pela RPC comum; requer procedimento administrativo alternativo aprovado |

## Privilégios mínimos a validar

A tabela abaixo indica o objetivo, não os comandos SQL finais. Os privilégios reais atuais precisam ser capturados antes de definir os REVOKE/GRANT.

| Tabela/recurso | Operações de cliente que precisam continuar funcionando | Operações a negar ao cliente |
| --- | --- | --- |
| `posts` | SELECT conforme RLS; INSERT somente colunas de criação necessárias | UPDATE direto de moderação; DELETE físico; escrita em campos protegidos |
| `post_comments` | SELECT conforme visibilidade; INSERT próprio; DELETE próprio se usado pela UI | Escrita em linhas de outro usuário; interação com post oculto/removido por usuário comum |
| `post_likes` | SELECT conforme visibilidade; INSERT próprio; DELETE da própria curtida | Escrita em curtida de outro usuário; interação com post oculto/removido por usuário comum |
| `post_reports` | INSERT de denúncia própria, com colunas necessárias | SELECT para usuários comuns; UPDATE/DELETE direto; escrita em campos de revisão |
| `community_moderators` | SELECT da própria associação; administrador consulta equipe conforme policy | INSERT/UPDATE/DELETE direto por todos os clientes |
| `community_admins` | SELECT da própria associação para determinar capacidades de UI | INSERT/UPDATE/DELETE direto por todos os clientes |
| `moderation_actions` | SELECT para moderadores/admins conforme RLS | INSERT/UPDATE/DELETE direto por todos os clientes |
| `storage.objects` / `post-images` | Upload próprio e leitura de imagem de post visível segundo a regra final | Leitura indevida de objetos; upload em pasta alheia; não assumir que policy invalida URL assinada já emitida |

## RPCs esperadas

### `moderate_community_post`

- Apenas usuário autenticado que pertença à equipe de moderação.
- Ações permitidas explicitamente: `hide`, `restore`, `remove`, `dismiss_reports`.
- Motivo obrigatório, aparado e dentro dos limites de tamanho.
- Bloquear IDs inexistentes e ações inválidas.
- Bloquear ou definir explicitamente comportamento idempotente para transições repetidas.
- Atualizar status, processar denúncias e inserir evento de auditoria atomicamente.
- Capturar a quantidade de denúncias afetadas imediatamente após o UPDATE relevante.
- Não permitir que falha de auditoria deixe a mudança de status persistida.

### `set_community_moderator`

- Apenas usuário autenticado que pertença a `community_admins`.
- Adicionar/remover moderador sem expor escrita direta nas tabelas de papéis.
- Validar o usuário alvo e impedir remoção acidental do último administrador/moderador necessário conforme a regra de bootstrap aprovada.
- Não permitir que moderadores comuns gerenciem papéis ou se promovam.
- Gravar auditoria de gestão de papéis? Decisão ainda pendente; recomendação: registrar quem adicionou/removeu quem, em evento administrativo separado ou no histórico de auditoria apropriado.

## Questões pendentes antes do SQL final

1. Confirmar se a comunidade permite que moderadores comentem/curtam conteúdo oculto durante a revisão. Padrão recomendado: não, salvo requisito claro.
2. Confirmar se usuários podem editar ou excluir comentários próprios; a matriz não deve conceder operação que a UI não usa.
3. Definir retenção e visibilidade dos eventos de gestão de moderadores.
4. Definir se um administrador pode também ser moderador e como garantir que a conta inicial não perca acesso.
5. Capturar policies completas e grants efetivos, incluindo `PUBLIC`, privilégios por coluna, permissões de sequência e funções.
6. Confirmar comportamento de upload/leitura de Storage e URLs assinadas de 3600 segundos.
7. Confirmar o mecanismo real de migração no Remix antes de criar SQL executável.

## Próxima fase de validação

Converter cada linha relevante em testes de integração usando somente contas e publicações fictícias no projeto isolado. Os testes Vitest estáticos atuais não substituem os testes reais de PostgreSQL/RLS/Storage. Nenhuma tabela de ciclo menstrual faz parte desses testes.

## Auditoria estática adicional do frontend (18/10/2026)

A leitura de `src/routes/_authenticated/comunidade.moderacao.tsx` identificou um requisito importante para o bootstrap:

- A rota exige associação em `community_moderators` para liberar a tela, mesmo quando a conta também aparece em `community_admins`.
- A seção de gestão da equipe só aparece para quem tem associação em `community_admins`.
- Portanto, a conta administradora inicial precisa ter as duas associações (`community_admins` e `community_moderators`) ou o frontend deve ser alterado deliberadamente para tratar administradores como moderadores. A decisão deve ser explícita; não presumir que ser admin já libera a tela.
- A interface lista UUIDs dos moderadores e pede o UUID para adicionar/remover. A RPC continua sendo a fronteira de autorização; esconder ou mostrar botões não protege o banco.
- A tela lê denúncias pendentes, posts denunciados, posts ocultos/removidos e até 100 eventos recentes de histórico. As policies/RPCs precisam cobrir essas leituras para moderadores e impedir que usuários comuns consultem os mesmos dados.
- O rascunho SQL existente permite a moderadores comentar/curtir posts ocultos ou removidos. Isso diverge da recomendação preliminar desta matriz. Não alterar essa regra silenciosamente: definir a política final e alinhar SQL, policies e testes.

## Próxima sequência de trabalho

1. Fechar as decisões de produto ainda pendentes (interações em posts ocultos, exclusão de comentário próprio e auditoria de alterações na equipe).
2. Fazer uma captura somente leitura e atualizada dos grants, privilégios por coluna, nomes/expressões de todas as policies e policies de Storage no Remix isolado.
3. Confirmar o fluxo de migração executado pelo Lovable Cloud/CI. O `package.json` não define scripts de migração, e o placeholder `drizzle/schema.ts` não é suficiente para provar o pipeline.
4. Só então preparar uma nova proposta de migração e atualizar os testes estáticos para rejeitar GUC/`set_config`; ainda sem executar SQL.
