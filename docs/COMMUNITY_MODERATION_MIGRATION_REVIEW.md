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

O SQL em `supabase/migrations/20261015190000_add_community_moderation.sql` continua sendo apenas uma proposta de revisão. Em 18/10/2026, o rascunho foi atualizado no GitHub para remover o GUC customizado e bloquear INSERT de comentários/curtidas quando o post não estiver `visible`. **Não aplicar esse arquivo**: o mecanismo de migração ainda não foi confirmado, as policies/grants reais precisam ser auditadas e o SQL ainda requer revisão integral.

Nenhum SQL foi executado no banco ao criar este documento.


## Direção técnica após revisão do código atual (ainda sem SQL novo)

A revisão estática da proposta SQL existente e do frontend encontrou pontos que precisam orientar o redesenho:

### Autorização das alterações protegidas sem GUC

A versão anterior usava `set_config('muuvi.moderation_rpc', ...)` e um trigger que confiava nesse marcador. Essa estratégia está rejeitada. O rascunho atual no GitHub removeu esse mecanismo; a versão continua sem aprovação para execução.

A direção preferida para a nova proposta é **usar privilégios mínimos como fronteira principal**, não um marcador de sessão:

1. Revogar os grants de tabela amplos em `posts` e `post_reports` antes de conceder de volta o mínimo.
2. Conceder ao cliente apenas INSERT nas colunas normais necessárias para criar posts (`user_id`, `author_name`, `content`, `image_url`, `image_path`) e denúncias (`post_id`, `user_id`, `reason`), após confirmar os payloads reais.
3. Não conceder UPDATE direto nas tabelas/colunas de estado de moderação e revisão. A função `SECURITY DEFINER` validada executa as mudanças privilegiadas como sua proprietária; a autorização deve ser validada dentro da função a cada chamada.
4. Não criar um trigger que tente distinguir a RPC por um GUC customizado. Se uma trigger adicional for mantida por outra regra de integridade, ela não pode confiar num valor configurável pela sessão como prova de autorização.
5. Confirmar privilégios efetivos, incluindo grants herdados de `PUBLIC`, grants por coluna e permissões do proprietário da função. A ausência de um grant UPDATE ao papel cliente precisa ser comprovada em teste, não presumida.

Essa direção ainda exige validar o fluxo de publicação e os privilégios reais do ambiente. Não é uma autorização para alterar ou aplicar SQL.

### Funções SECURITY DEFINER

Para `moderate_community_post` e `set_community_moderator`:

- Usar `SECURITY DEFINER` apenas com um proprietário confiável.
- Definir um `search_path` seguro e qualificar referências a tabelas e funções por schema quando aplicável.
- Revogar EXECUTE de `PUBLIC` e `anon`, concedendo-o explicitamente a `authenticated` quando a função for destinada a usuários autenticados.
- Verificar autorização com `auth.uid()` no corpo da função; nunca confiar na UI.
- Executar atualização de status, revisão das denúncias e gravação de auditoria numa única transação.
- Para a contagem de denúncias afetadas, capturar `ROW_COUNT` imediatamente após o UPDATE correspondente, antes de executar outra instrução SQL.
- Definir explicitamente a política para ações repetidas, por exemplo ocultar uma publicação já oculta, e registrar os status anterior/novo de forma consistente.
- Impedir que o administrador inicial seja removido da equipe de moderação sem um procedimento administrativo alternativo aprovado.

### Pontos encontrados no código frontend atual

- `src/routes/_authenticated/comunidade.tsx` filtra `moderation_status = 'visible'` e possui fallback para schema antigo quando a coluna está ausente. Esse fallback é apenas compatibilidade temporária; não substitui RLS e deve ser removido ou limitado depois que a migração for aplicada e validada.
- O frontend gera URLs assinadas do bucket `post-images` com TTL de 3600 segundos. Uma URL já emitida pode continuar funcionando até expirar, mesmo que a publicação seja ocultada depois. A política de Storage não revoga retroativamente uma URL assinada. A solução precisa ser explícita sobre esse intervalo de exposição.
- O frontend insere posts com `user_id`, `author_name`, `content` e `image_path`; insere denúncias com `post_id`, `user_id` e `reason`; comentários e curtidas usam INSERT/DELETE. Grants mínimos devem preservar esses fluxos.
- O código de comentários e curtidas ignora alguns erros de resposta. Isso não é necessariamente parte da migração SQL, mas os testes devem confirmar os resultados e a interface deve reportar falhas relevantes.
- O arquivo `src/lib/community-moderation-migration.test.ts` ainda exige a presença do GUC e do `set_config`. Quando a proposta for redesenhada, esse contrato estático deve ser atualizado para rejeitar a abordagem antiga e testar os grants/RPCs esperados. O teste estático não prova a autorização real no PostgreSQL.

### Outras verificações necessárias antes de redigir o SQL final

- Auditar todas as policies existentes de comentários, curtidas, posts, denúncias e Storage; remover/substituir uma policy pelo nome não neutraliza policies permissivas adicionais que se combinam por OR.
- Rever os grants para `post_comments` e `post_likes`, incluindo DELETE necessário para retirar curtidas e comentários próprios, sem conceder operações adicionais desnecessárias.
- Confirmar se `image_path` armazena exatamente o nome do objeto do Storage e como são tratadas imagens órfãs ou reutilizadas.
- Manter a correção do trigger ausente de `auth.users`/criação de `profiles` como uma tarefa separada até ser especificada e testada.
- Confirmar novamente o mecanismo de migração executado pelo projeto isolado antes de colocar a proposta num diretório executável.

Nenhuma destas observações executa SQL, altera o banco ou autoriza a aplicação da migração.


## Resultado da auditoria estática complementar (18/10/2026)

### Fluxo de migração: ainda não confirmado

A leitura do código da branch encontrou:

- drizzle.config.ts define PostgreSQL, usa ./drizzle/schema.ts como schema e ./drizzle/migrations como diretório de saída.
- drizzle/schema.ts está intencionalmente vazio.
- package.json não define scripts de migração; há scripts de desenvolvimento, build, lint, format e testes, mas nenhum db:migrate, drizzle-kit migrate ou equivalente.
- A proposta atual está em supabase/migrations/, mas não há evidência suficiente no repositório inspecionado de que esse diretório seja executado pelo fluxo do Lovable Cloud/Remix.

**Conclusão:** não criar ainda uma migração executável nem mover o arquivo existente. É necessário confirmar no ambiente de teste qual mecanismo o Lovable Cloud realmente aplica. A configuração do Drizzle, por si só, não prova que exista uma rotina de aplicação automática.

### Contrato obrigatório para novas interações

A decisão aprovada pelo responsável do projeto é que posts com moderation_status = 'hidden' ou 'removed' rejeitem novas curtidas e comentários de **todos** os papéis, inclusive moderadores e administradores. Ao restaurar para 'visible', novas interações voltam a ser permitidas conforme as regras normais de autoria.

A proposta SQL atual ainda viola essa decisão: as políticas own comment ins e own like ins permitem interação quando o post está oculto/removido se o usuário estiver em community_moderators. Isso precisa ser corrigido na futura proposta e coberto por testes para cada papel. A leitura de conteúdo oculto para revisão continua sendo uma permissão separada da permissão de interagir.

### Limitações e riscos observados no frontend

- O fluxo de publicação envia user_id, author_name, content e image_path; não envia image_url nesse trecho, apesar de a proposta conceder INSERT nessa coluna. Confirmar se a coluna é necessária para algum outro fluxo antes de definir grants mínimos.
- As funções de curtir e comentar não verificam o campo error retornado pelo Supabase; o comentário é limpo e a lista invalidada mesmo se o INSERT falhar. Corrigir isso no frontend numa alteração revisada, para que rejeições legítimas de RLS sejam mostradas corretamente e não pareçam sucesso.
- O feed gera URLs assinadas de imagens por 3600 segundos. A autorização de Storage controla novas solicitações, mas não invalida URLs já emitidas. Esse risco precisa ser documentado e aceito ou mitigado antes de declarar que imagens ocultas ficam imediatamente inacessíveis.
- A busca de posts do feed tem fallback sem filtro de status se a coluna moderation_status não existir. Isso só é aceitável como compatibilidade temporária antes da implantação; depois da implantação validada, deve ser removido ou protegido para não voltar a exibir posts ocultos diante de regressões.

### Próximas verificações (somente leitura)

1. Obter no projeto Remix os resultados da consulta docs/COMMUNITY_MODERATION_AUDIT.sql para políticas RLS, grants de tabela e privilégios por coluna; nenhuma consulta de escrita é necessária.
2. Confirmar o caminho real de migração do Lovable Cloud antes de escolher o diretório da proposta.
3. Redesenhar a proposta sem GUC customizado e sem exceção de INSERT para moderadores em posts ocultos/removidos.
4. Atualizar os testes estáticos para rejeitar current_setting('muuvi.moderation_rpc', true) e set_config('muuvi.moderation_rpc', ...), e verificar o contrato aprovado para posts ocultos/removidos. Esses testes não substituem testes reais de RLS no banco isolado.
5. Manter todo teste de banco limitado ao Remix isolado, com contas e conteúdo fictícios, sem tabelas de ciclo menstrual.

Nenhum SQL foi executado; esta auditoria foi somente de leitura do repositório.


## Atualização da revisão estática (18/10/2026, GitHub)

Sem executar SQL e sem alterar qualquer banco, foram feitas duas alterações na branch `feature/moderacao-comunidade`:

- O rascunho SQL deixou de usar `current_setting/set_config('muuvi.moderation_rpc', ...)` e removeu o trigger que confiava nesse marcador. A proposta passa a depender dos privilégios mínimos concedidos ao cliente e das RPCs `SECURITY DEFINER` validadas. Isso ainda precisa de revisão dos privilégios efetivos e do proprietário das funções.
- As policies propostas de INSERT para `post_comments` e `post_likes` agora exigem exclusivamente que o post relacionado esteja `visible`, sem exceção para moderador/administrador.
- O teste estático deixou de exigir o GUC, passou a rejeitar seu uso e verifica que as policies de INSERT não contêm exceções por papel.

**Limitações restantes:** estes testes são verificações textuais, não executam PostgreSQL e não provam RLS. Policies permissivas adicionais podem combinar-se por OR; os resultados da auditoria somente leitura ainda precisam confirmar o estado real. O fluxo de migração do Lovable continua não confirmado. O arquivo em `supabase/migrations/` permanece uma proposta não aprovada: não executar em nenhum banco até concluir a auditoria e confirmar o pipeline.

Nenhum SQL foi executado. Nenhum banco foi alterado.
