# Diagnóstico da lentidão dos painéis — 28/10/2026

## Evidências observadas
- O banco respondeu às consultas de leitura: 142 dispositivos, 7 representantes, 27 fontes e 59 planos.
- Os logs recentes do gateway registraram HTTP 499 tanto em `admin-api` quanto em `device-check`.
- No Live Preview, algumas chamadas de `device-check` ficaram cerca de 120 segundos pendentes antes de `Failed to fetch`; outras responderam em aproximadamente 0,4–1,5 segundos.
- Isso indica interrupções/ausência de resposta no caminho das funções. HTTP 499 significa encerramento da conexão pelo cliente/gateway; sozinho não identifica a causa interna. O timeout de 18 segundos do painel também pode produzir cancelamentos.
- Não há evidência de exclusão dos cadastros nem de que o volume atual do banco explique os atrasos de 120 segundos. Não houve alteração de registros por SQL nesta sessão.

## Correções no aplicativo
- Ações confirmadas publicam a linha retornada pelo banco e não aguardam outra leitura de todos os clientes/fontes.
- Salvar um cliente administrativo usa uma chamada e uma atualização, em vez de até quatro chamadas concorrentes.
- Consultas idênticas são deduplicadas; falhas de transporte provocam intervalo progressivo de polling, sem repetir automaticamente escritas ou login.
- Exclusão/bloqueio/troca de fonte conferem erros e a linha/IDs realmente afetados. Não há confirmação falsa/otimista.
- Respostas anteriores a uma alteração confirmada são descartadas.
- As funções registram início/fim por ação e duração sem senhas, tokens ou MACs.
- Índice não exclusivo adicionado para a busca de planos por rede/servidor/usuário. Dados e filtros de leitura de admin raiz/sub-admin preservados.

## Verificação adicional — renovação/desativação (22:18 UTC)
- O gateway continuou registrando HTTP 499 em `admin-api` entre 22:17 e 22:18 UTC. O Live Preview registrou falhas de transporte em cerca de 120 segundos, intercaladas com respostas de login/listas entre 0,597 e 1,022 segundo. Não há captura de renovação/desativação instalada que permita medir seu tempo após esta mudança.
- A renovação anterior fazia cinco acessos sequenciais ao banco: autenticar representante, ler MAC, atualizar prazo, debitar créditos e registrar consumo. Agora uma chamada RPC faz esses passos dentro de uma transação e devolve o MAC e o saldo confirmados; a tela não depende de uma nova lista para mostrar o vencimento/saldo.
- A desativação do representante passou de dois acessos ao banco para uma chamada RPC com autenticação e confirmação. A administrativa já usava uma atualização com retorno e continua usando o mesmo filtro de rede.
- Novas leituras de polling aguardam ações pendentes em ambos os painéis; ações nunca aguardam leituras. Toques idênticos durante uma operação pendente compartilham uma confirmação, sem nova escrita. Não há repetição automática após timeout, nem garantia de idempotência após uma confirmação perdida.
- Verificados por SQL somente leitura: ausência de consultas aguardando locks na amostra, função criada, negação de execução para `anon`/`authenticated`, recusa de chamadas sem credenciais e conversão correta de um custo de 1 crédito. Nenhum cliente foi renovado/desativado por ferramentas de diagnóstico.
- A estrutura existente usa créditos inteiros. A função preserva essa conversão, não arredonda custos fracionados silenciosamente e recusa um débito incompatível antes de alterar o prazo. Nenhum tipo de coluna ou saldo existente foi alterado.
- Há testes puros da prioridade de requisições em `services/panelRequestGate.test.ts`; não foram executados aqui. Testes de renovação de MAC de teste, saldo, rollback e isolamento com credenciais reais permanecem pendentes em ambiente controlado.

## Sincronização automática — correção adicional (23:20 UTC)
- Identificados no código: o administrador aguardava o primeiro intervalo ao recuperar foco; somente clientes eram consultados pelo polling administrativo, não as abas já abertas; algumas ações atualizavam a linha local sem revalidar os dados relacionados; ativações/testes retornavam apenas sucesso e dependiam de outra lista; várias solicitações forçadas podiam invalidar a leitura pendente repetidamente.
- Ambos os painéis agora iniciam leitura ao entrar/recuperar foco e ao voltar ao primeiro plano. O ciclo automático continua a cada 10 segundos após a conclusão da leitura, inclusive depois de erro, com uma única leitura por seção em andamento.
- Um aviso interno, emitido somente após resposta de sucesso de uma escrita, revalida automaticamente clientes e seções afetadas. Ele compara a identidade da sessão; não envia dados de admin raiz para sub-admin nem de outro representante. Login, consultas e relatórios de conteúdo não geram esses avisos.
- Exclusão, bloqueio, desativação, renovação e troca de fonte continuam aplicando imediatamente a linha/IDs confirmados. Ativação e teste do representante também passam a devolver o MAC e o saldo confirmados na própria resposta, sem aguardar a lista inteira para exibi-los.
- Leituras anteriores a uma mudança são descartadas, com uma nova leitura coalescida garantida, inclusive se o pedido chegar durante a finalização da consulta. Sair da sessão cancela a publicação de respostas anteriores. Escritas não são repetidas automaticamente.
- A revalidação após ação/entrada e o botão de atualização podem consultar mesmo durante o intervalo de recuo de polling. As abas administrativas já utilizadas são revalidadas automaticamente com cache de 60 segundos, sem segurar o ciclo dos MACs. Contadores por fonte/plano/representante são derivados da mesma lista de MACs confirmada.
- Removidos recarregamentos manuais redundantes após ações administrativas; o disparo automático cobre também serviços chamados diretamente pela página. O horário exibido continua sendo de uma leitura completa confirmada, não de uma atualização otimista.
- Diagnóstico somente leitura nesta sessão: 144 dispositivos, 130 vinculados a representantes e 37 vistos nos últimos 5 minutos na amostra. Nenhum cadastro, vínculo, saldo ou isolamento foi alterado por SQL.
- O gateway ainda registrou HTTP 499 em `admin-api` às 23:20 UTC e a última captura do Live Preview teve uma falha de transporte em 120,258 segundos. Estas alterações não comprovam resolução da infraestrutura.
- Adicionados testes puros de leitura única, revalidação coalescida, recuperação após erro, pedido durante finalização, descarte de sessão antiga e notificações isoladas em `services/panelSyncQueue.test.ts` e `services/panelChangeService.test.ts`. Os testes não foram executados nesta sessão.
- Validar em uma versão atualizada do app: entrar sem tocar em sincronizar; ativar conta/teste, renovar, bloquear, desativar, excluir e trocar fonte; conferir MAC, saldo e contadores sem sair do painel; voltar do segundo plano; simular falha de rede e verificar recuperação automática. Repetir para raiz, sub-admin e representante sem usar clientes reais em testes destrutivos.

## Limitação e verificação pendente
As mudanças reduzem esperas introduzidas pelo aplicativo, mas não garantem resposta instantânea quando o serviço de funções está indisponível. Nenhum teste instalado de iOS/Android ou teste automatizado foi executado nesta sessão.

Para investigar a infraestrutura, encaminhar a contact@onspace.ai o domínio `hlvwfhpydzwqdlqzhlvw.backend.onspace.ai`, os horários aproximados das falhas (28/10/2026, logs entre 21:46 e 21:52 UTC), as funções `admin-api` e `device-check`, e os códigos 499/esperas de 120 segundos. Não enviar senhas ou tokens.

Após a publicação, comparar os novos logs `[panel-edge] start/end` com o gateway: início ausente ajuda a localizar falhas antes da execução; duração elevada com início/fim exige investigar o trecho executado. Testar login, bloqueio, exclusão e troca de fonte em dispositivo instalado e confirmar as alterações no Cloud, sem repetir uma escrita cuja confirmação foi perdida.
