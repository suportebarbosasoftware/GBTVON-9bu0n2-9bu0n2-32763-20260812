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

## Limitação e verificação pendente
As mudanças reduzem esperas introduzidas pelo aplicativo, mas não garantem resposta instantânea quando o serviço de funções está indisponível. Nenhum teste instalado de iOS/Android ou teste automatizado foi executado nesta sessão.

Para investigar a infraestrutura, encaminhar a contact@onspace.ai o domínio `hlvwfhpydzwqdlqzhlvw.backend.onspace.ai`, os horários aproximados das falhas (28/10/2026, logs entre 21:46 e 21:52 UTC), as funções `admin-api` e `device-check`, e os códigos 499/esperas de 120 segundos. Não enviar senhas ou tokens.

Após a publicação, comparar os novos logs `[panel-edge] start/end` com o gateway: início ausente ajuda a localizar falhas antes da execução; duração elevada com início/fim exige investigar o trecho executado. Testar login, bloqueio, exclusão e troca de fonte em dispositivo instalado e confirmar as alterações no Cloud, sem repetir uma escrita cuja confirmação foi perdida.
