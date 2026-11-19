# Teste: sequências e votação

Base anterior ao teste: `2dec7807b8f60fa8f47500d7dbd42d1af411aaff`.
Para retirar este teste, reverta o commit que adiciona estas funcionalidades; não faça reset do histórico. Os registros de jogos são preservados. Votos permanecem em `voting` no estado, privados no servidor durante este teste.

- Início: até três categorias de sequência, apenas participantes do último dia encerrado, mínimo duas rodadas. Empate conta como invencibilidade. Ausências não incrementam nem interrompem a sequência pessoal. Três times contam uma rodada.
- Stats: recordes do histórico de partidas, sem totais manuais.
- Votação: admin escolhe dia encerrado e abre/encerra/reabre. Participantes são fotografados no momento da abertura; alterações posteriores na escalação não mudam a lista da votação.
- Cada participante escolhe seu nome e envia um MVP e um Bagre. O teste permite votar em si e na mesma pessoa nas duas categorias. Identificação declarada, sem autenticação individual.
- Votos individuais não saem pela API, inclusive para admin. Parciais e identificação de quem já votou são públicas.
- Admin pode remover o envio completo de uma pessoa, sem ver suas escolhas. Novo envio exige votação aberta.
- Nenhum resultado é aplicado automaticamente às premiações oficiais, inclusive em caso de empate.
- Gravação usa controle de versão e tentativas em caso de concorrência; não requer nova tabela. Votos também avançam a versão do estado. Se um admin estiver com dados antigos, o salvamento normal pode pedir recarregamento em vez de sobrescrever dados.

Validação: `npm test`, incluindo `tests/community.mjs` para duplicidade, concorrência, permissões, privacidade, remoção/reenvio, reabertura, preservação e sequências.
