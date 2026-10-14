# FC BAGRES — projeto completo para uso local

## Como abrir

1. Instale o **Node.js 24 ou superior**: https://nodejs.org/ (inclui o npm).
2. Clone o repositório e entre na pasta. Não abra somente o index.html.
3. No Windows, dê dois cliques em `INICIAR-WINDOWS.bat`. Alternativamente, abra um terminal dentro da pasta do projeto e execute `npm start` (também funciona no macOS e Linux).
4. Abra **http://localhost:8787** no navegador.
5. O terminal mostra a senha de admin da sua cópia local. Use o botão “Entrar como admin”. Mantenha o terminal aberto enquanto usar o site.

Não precisa de conta Cloudflare, Git, instalação de pacotes ou conexão com a internet após instalar o Node.js. A senha é criada automaticamente na primeira execução e preservada na pasta `.local`. A senha de produção não acompanha este pacote.

## O que está incluído

Todos os arquivos versionados do projeto atual, incluindo código-fonte, HTML, CSS, JavaScript, logos, migrações, configuração de hospedagem e Worker compilado. O pacote acrescenta um servidor local e este guia. A cópia corresponde ao commit `0b89fb9e02b42e8ae2dd04c8fe11d03d3af84314`, com a identidade FC BAGRES e o prêmio Bagre.

Funcionam localmente: cadastro e edição de jogadores, fotos, administração, seleção de disponíveis, goleiros fixos, sorteio e troca de times, resultados, gols, assistências, MVP/Bagre, rankings mensal/anual, destaques e Stats.

## Dados locais e dados do site online

O repositório contém o projeto; o banco e as fotos cadastradas no site online ficam nos serviços de hospedagem e **não são exportados neste pacote**. A cópia local inicia com o elenco inicial do código e sem partidas registradas. Ela não se conecta nem sincroniza com o site online.

Na primeira execução, o servidor cria `.local/site.sqlite` para os registros e `.local/photos/` para fotos. Esses arquivos continuam disponíveis depois de fechar e reabrir. Para fazer backup da sua cópia local, encerre o servidor e copie a pasta `.local` inteira, junto com o projeto. Cada computador tem seu próprio banco e sua própria senha.

## Organização

- `index.html`, `styles.css`, `app.js`: interface e comportamento do site.
- `assets/`: logos.
- `server/worker.template.mjs`: backend original para hospedagem.
- `build.mjs`: compila interface e backend em `dist/server/index.js`.
- `drizzle/`: migrações do banco.
- `.openai/hosting.json`: vínculo original de hospedagem; o servidor local não o utiliza.
- `scripts/local-server.mjs`: executa o mesmo Worker com SQLite e fotos no disco.
- `package.json`: comandos de execução, sem dependências externas.

Depois de editar o código, pare com Ctrl+C e execute `npm start` novamente. Para somente compilar: `npm run build`.

## Problemas comuns

- **Node.js antigo:** instale a versão 24 ou superior e reabra o terminal.
- **Porta ocupada:** encerre a outra instância; ou use `PORT=8788 npm start` no macOS/Linux e `$env:PORT=8788; npm start` no PowerShell. Abra a porta escolhida no navegador.
- **Senha local:** consulte o terminal ou `.local/admin.json` do seu computador.
- **Aviso experimental de SQLite:** algumas versões do Node exibem esse aviso; o servidor continua funcionando.

O servidor escuta apenas no próprio computador. Hospedar para outras pessoas exige configurar o backend e os recursos de banco/fotos, como no site original; não basta enviar o index.html.

Referência técnica da execução local: https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html

## Versão atual e Railway

Este código corresponde à versão 48 do site, incluindo as rodadas de três times, Stats, conquistas, mensalistas, mascote e geração de artes com fotos originais. Execute `npm test` para verificar as regras da aplicação.

A migração para Railway ainda não foi implementada. Será necessário exportar o banco D1 e as fotos R2 de produção, adaptar os recursos DB/BUCKET ao banco e armazenamento escolhidos, configurar os segredos de administração e servir na interface e porta exigidas pelo Railway. O servidor incluído é para execução local.

A hospedagem atual permanece no Sites: https://fcbagres.gabrielparnoff.chatgpt.site/
