# Revisão de arquitetura — migração de moderação da comunidade

> **Documento de planejamento. Não é SQL executável.** A proposta final deve ser revisada antes de qualquer migração.

## Decisões já estabelecidas

- Desenvolver e testar no Remix do Muuvi, com backend separado e dados fictícios.
- Não alterar `main`, mesclar o PR ou publicar sem autorização explícita.
- Não executar SQL no banco de produção.
- Não usar `set_config('muuvi.moderation_rpc', ...)` / GUC customizado como mecanismo de confiança para autorizar alterações protegidas.
- Preferir remoção lógica para preservar comentários, curtidas, denúncias e auditoria.
- Não alterar dados reais de ciclo menstrual.
- Não inserir UUID de administrador na migração.
- O primeiro administrador deve ser inicializado por um procedimento privilegiado, revisado e executado separadamente após aprovação.

## Problemas que a nova proposta precisa resolver

### 1. Modelo de privilégios

A auditoria informou grants amplos de SELECT/INSERT/UPDATE/DELETE para `anon` e `authenticated` nas tabelas. A proposta deve:

- inventariar grants atuais e privilégios por coluna;
- revogar somente após listar todas as operações legítimas usadas pelo cliente;
- conceder explicitamente o mínimo necessário;
- garantir que revogar grants não quebre criação de posts, comentários, curtidas e denúncias;
- impedir escrita direta em tabelas de permissões e auditoria;
- testar tanto acesso por REST/PostgREST como as políticas RLS.

Não confiar apenas em RLS: grants e RLS são camadas distintas.

### 2. Funções e autorização

As RPCs de moderação devem:

- usar `SECURITY DEFINER` somente quando necessário;
- fixar um `search_path` seguro e qualificar objetos por schema;
- validar `auth.uid()` e associação de moderador dentro da função;
- validar a ação e o motivo;
- executar alteração de status e inserção de auditoria na mesma transação;
- revogar EXECUTE de `PUBLIC`/papéis não autorizados e conceder somente o necessário;
- não depender de marcador de sessão configurável pelo cliente como única proteção;
- ter testes para chamadas sem sessão, usuário comum, moderador e administrador.

### 3. Separação administrador/moderador

- Administradores podem gerenciar a equipe de moderadores.
- Moderadores podem moderar conteúdo e consultar denúncias/histórico conforme a política.
- Moderadores não podem adicionar/remover moderadores nem elevar privilégios.
- Usuários comuns não podem atribuir papéis a si mesmos.
- A inicialização do primeiro administrador não deve ser feita por cadastro público nem embutida como UUID fixo na migração.
- O procedimento de bootstrap deve exigir contexto privilegiado e falhar de modo seguro se a conta alvo não for encontrada de forma inequívoca.

### 4. Remoção lógica e histórico

- Estados de conteúdo devem ter restrições explícitas.
- A moderação não deve executar DELETE físico de posts.
- Registros de auditoria devem ser append-only para clientes, com leitura restrita.
- Comentários, curtidas e denúncias devem permanecer associados ao post removido.
- A RPC deve registrar autor da ação, ação, status anterior/novo, motivo, timestamp e quantidade de denúncias afetadas, quando aplicável.
- Falhas durante a ação não podem deixar status atualizado sem auditoria.

### 5. Policies existentes e lógica OR

Antes de criar/substituir policies, inventariar todas as policies de `posts`, `post_comments`, `post_likes`, `post_reports` e `storage.objects` para `post-images`. Policies permissivas para o mesmo comando podem se combinar por OR; criar uma policy restritiva não neutraliza automaticamente uma policy permissiva antiga.

### 6. Imagens e URLs assinadas

A policy de Storage pode controlar novas leituras, mas não invalida URLs assinadas já emitidas. A implementação deve revisar:

- como o frontend gera URLs assinadas;
- validade/TTL;
- se o app mantém URLs assinadas persistidas ou as gera sob demanda;
- se o acesso a objetos pode ser associado de forma confiável a posts visíveis;
- como evitar que uma imagem de post oculto seja revelada a usuários comuns por uma URL ainda válida.

Não prometer revogação imediata sem um mecanismo que realmente a garanta.

### 7. Cadastro e perfis

A auditoria reportou `handle_new_user()` sem trigger em `auth.users`. Tratar o provisionamento de `profiles` como uma correção separada ou justificar e testar explicitamente sua inclusão; não esconder essa mudança dentro da migração de moderação.

### 8. Migrações

- Confirmar o fluxo efetivo do Drizzle Kit antes de escrever um arquivo de migração.
- Não criar uma migração baseline que execute CREATE TABLE para tabelas já existentes.
- Não escrever manualmente na tabela `drizzle.__drizzle_migrations` para fingir que uma migração foi aplicada.
- Manter `supabase/migrations/` sem alterações enquanto seu papel histórico é documentado.
- A migração futura deve ser criada no mecanismo efetivamente executado pelo ambiente isolado.

## Testes de aceitação obrigatórios

- Usuário comum não consegue listar a equipe nem consultar denúncias/histórico.
- Usuário comum não consegue alterar diretamente status de moderação, estado de denúncia ou registros de auditoria.
- Usuário comum não consegue apagar fisicamente posts.
- Usuário comum não consegue se promover.
- Moderador consegue executar ações válidas por RPC e não consegue gerenciar papéis.
- Administrador consegue adicionar/remover moderadores por RPC.
- A conta administradora mantém acesso à moderação.
- Post oculto/removido e seus comentários/curtidas ficam invisíveis para usuários comuns.
- Imagens de conteúdo oculto/removido não ficam acessíveis de forma indevida, considerando URLs assinadas já emitidas.
- Denúncias e auditoria são preservadas após remoção lógica.
- Ação inválida ou sem permissão não causa atualização parcial nem evento de auditoria falso.
- Criação de post, comentário, curtida e denúncia continua funcionando com grants mínimos.
- O fluxo de criação de `profiles` é verificado separadamente.
- Nenhum teste toca tabelas de ciclo menstrual.

## Estado atual

O SQL em `supabase/migrations/20261015190000_add_community_moderation.sql` é uma proposta anterior de revisão e ainda contém a abordagem de GUC customizado. Não aplicar esse arquivo. Antes de qualquer execução, ele deve ser redesenhado para o mecanismo de migração confirmado e para o modelo de autorização aprovado.

Nenhum SQL foi executado no banco ao criar este documento.
