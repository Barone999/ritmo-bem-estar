# Plano de testes de integração — moderação da comunidade Muuvi

> **Não executar em produção.** Use um projeto de teste separado e contas/dados fictícios. A migração ainda está em revisão e não foi aplicada ao banco real.

## Preparação do ambiente isolado

1. Crie/seleciona um projeto de teste no Lovable Cloud/Supabase que não contenha dados reais.
2. Confirme o identificador do projeto antes de qualquer SQL.
3. Faça backup do projeto de teste e aplique a migração somente nesse ambiente após revisão.
4. Crie três contas fictícias: administrador inicial, moderador e usuário comum. Crie duas publicações fictícias e duas denúncias para uma delas.
5. Registre os UUIDs fictícios usados, sem copiar UUIDs de usuários reais.

## Matriz de autorização

| Caso | Conta | Ação | Resultado esperado |
| --- | --- | --- | --- |
| AUTH-01 | Usuário comum | Consultar `community_moderators` | Só pode consultar a própria associação; não consegue listar a equipe |
| AUTH-02 | Usuário comum | Consultar `post_reports` | Nenhuma denúncia retornada |
| AUTH-03 | Usuário comum | Chamar `moderate_community_post` | Erro de permissão; status e histórico inalterados |
| AUTH-04 | Moderador | Chamar `set_community_moderator` | Erro de permissão; lista de moderadores inalterada |
| AUTH-05 | Administrador | Adicionar moderador fictício via RPC | Associação criada |
| AUTH-06 | Administrador | Remover moderador fictício via RPC | Associação removida |
| AUTH-07 | Administrador | Remover a própria conta da tabela de moderadores | Erro; a conta administradora mantém acesso |
| AUTH-08 | Usuário comum | Inserir uma publicação com `moderation_status = 'hidden'` | Operação rejeitada ou o campo fica no valor padrão `visible`; nunca deve criar conteúdo oculto sem autorização |
| AUTH-09 | Usuário comum | Atualizar diretamente `moderation_status` ou campos de revisão | Operação rejeitada |
| AUTH-10 | Usuário comum | Inserir/atualizar diretamente linhas de `moderation_actions` | Operação rejeitada |
| AUTH-11 | Usuário comum | Excluir fisicamente publicação/denúncia | Operação rejeitada |
| AUTH-12 | Usuário comum | Usar caminho de imagem de publicação oculta/removida | Imagem inacessível |
| AUTH-13 | Usuário comum | Criar comentário/curtida em publicação oculta/removida | Operação rejeitada |
| AUTH-14 | Moderador | Ler histórico e denúncias | Permitido |
| AUTH-15 | Moderador | Alterar status por RPC com motivo válido | Permitido e registrado no histórico |

## Regra de interação em conteúdo oculto/removido

Esta regra foi aprovada para todos os papéis, sem exceção: usuário comum, moderador e administrador não podem criar novos comentários ou curtidas em posts `hidden` ou `removed`.

| Caso | Estado do post | Papel | Operação | Resultado esperado |
| --- | --- | --- | --- | --- |
| INT-01 | `visible` | Usuário comum | Inserir comentário próprio | Permitido conforme RLS e validação de autoria |
| INT-02 | `visible` | Moderador | Inserir comentário próprio | Permitido conforme RLS e validação de autoria |
| INT-03 | `visible` | Administrador | Inserir comentário próprio | Permitido conforme RLS e validação de autoria |
| INT-04 | `visible` | Usuário comum/moderador/administrador | Inserir curtida própria | Permitido conforme RLS e validação de autoria |
| INT-05 | `hidden` | Usuário comum | Inserir comentário ou curtida | Rejeitado no banco |
| INT-06 | `hidden` | Moderador | Inserir comentário ou curtida | Rejeitado no banco |
| INT-07 | `hidden` | Administrador | Inserir comentário ou curtida | Rejeitado no banco |
| INT-08 | `removed` | Usuário comum | Inserir comentário ou curtida | Rejeitado no banco |
| INT-09 | `removed` | Moderador | Inserir comentário ou curtida | Rejeitado no banco |
| INT-10 | `removed` | Administrador | Inserir comentário ou curtida | Rejeitado no banco |
| INT-11 | `hidden`/ `removed` | Todos os papéis | Consultar conteúdo/histórico | Usuário comum não vê o post nem interações; equipe autorizada pode revisar conforme RLS |
| INT-12 | Restaurado para `visible` | Todos os papéis | Inserir nova interação | Permitido de novo, conforme as policies de autoria |
| INT-13 | `hidden`/ `removed` | Todos os papéis | Verificar comentários/curtidas anteriores | Registros existentes permanecem preservados |

Os testes precisam chamar a API/banco diretamente com sessão de cada papel; testar apenas a UI não comprova a política. Para INT-05 a INT-10, verificar que nenhuma linha é criada. Nenhuma tabela de ciclo menstrual deve ser acessada ou modificada.

## Matriz de auditoria e reversibilidade

1. Com duas denúncias pendentes numa publicação fictícia, o moderador executa `hide` com motivo válido.
2. Confirme que o status passa para `hidden`, as denúncias pendentes passam para `reviewed`, e o histórico registra moderador, ação, status anterior/novo, motivo e `reports_affected = 2`.
3. Restaure a publicação usando `restore`; confirme novo registro de histórico e status `visible`.
4. Execute `remove`; confirme status `removed`, sem exclusão física da publicação.
5. Use `dismiss_reports` numa publicação fictícia com denúncias pendentes; confirme que as denúncias ficam `dismissed` e a publicação mantém seu status.
6. Force uma chamada inválida (ação desconhecida, motivo vazio ou usuário sem permissão); confirme que não há alteração parcial nem registro de ação falso.
7. Confirme que comentários, curtidas, denúncias e histórico anteriores continuam presentes após ocultar/remover logicamente.

## Critérios de aprovação

- Todos os casos AUTH-01 a AUTH-15 produzem o resultado esperado.
- Todos os casos INT-01 a INT-13 produzem o resultado esperado, incluindo bloqueio no banco para moderadores e administradores em posts ocultos/removidos.
- Nenhum teste modifica tabelas de ciclo menstrual ou outros dados pessoais.
- Nenhuma ação de moderação é possível sem a RPC autorizada.
- Nenhuma alteração de status protegida contorna o histórico.
- A aplicação e as políticas RLS mostram resultados consistentes para administrador, moderador e usuário comum.
- O responsável revisa os resultados e só então decide se aprova uma implantação separada em produção.

## Limitações do CI atual

Os testes Vitest do repositório verificam contratos estáticos do SQL, além de lint/formatação e build. Eles **não executam PostgreSQL nem provam o comportamento real de RLS, privilégios, triggers ou RPCs**. Este plano precisa ser executado num projeto isolado antes de qualquer implantação.
