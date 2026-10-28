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

## Limitação e verificação pendente
As mudanças reduzem esperas introduzidas pelo aplicativo, mas não garantem resposta instantânea quando o serviço de funções está indisponível. Nenhum teste instalado de iOS/Android ou teste automatizado foi executado nesta sessão.

Para investigar a infraestrutura, encaminhar a contact@onspace.ai o domínio `hlvwfhpydzwqdlqzhlvw.backend.onspace.ai`, os horários aproximados das falhas (28/10/2026, logs entre 21:46 e 21:52 UTC), as funções `admin-api` e `device-check`, e os códigos 499/esperas de 120 segundos. Não enviar senhas ou tokens.

Após a publicação, comparar os novos logs `[panel-edge] start/end` com o gateway: início ausente ajuda a localizar falhas antes da execução; duração elevada com início/fim exige investigar o trecho executado. Testar login, bloqueio, exclusão e troca de fonte em dispositivo instalado e confirmar as alterações no Cloud, sem repetir uma escrita cuja confirmação foi perdida.
