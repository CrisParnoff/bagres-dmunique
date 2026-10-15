# FC BAGRES — Vercel + Supabase

O repositório está adaptado para publicar uma cópia independente na Vercel, com banco PostgreSQL e fotos no Supabase. **O site atual da OpenAI permanece separado e não é alterado por estes commits.**

Veja o [guia de deploy](docs/VERCEL-SUPABASE.md) para configurar o novo projeto.

## Identidade visual do clube

O frontend usa o remake visual do FC Bagres: camisa vinho, escudo, fonte Archivo local, detalhes dourados, equipes com textura de losangos e animações com suporte a movimento reduzido. A navegação mantém Início, Partida, Ranking, Stats, Destaques e Transparência, além do elenco no modo admin. No celular, todas as seções ficam acessíveis na barra inferior.

`ui.js` cuida apenas de animações e navegação visual; `app.js` e `artwork.js` mantêm as regras atuais, inclusive três times, nove jogos, seleção de mensalistas, histórico, gráficos, conquistas e arte dos times. O backend continua usando Supabase. O build reúne os três scripts e publica fontes, ícones e manifesto sem dependências adicionais.

Os testes incluem o contrato entre a interface e os controles do aplicativo, além das regras de futebol, artes e integração com Supabase.

## IA dos times e resumo do caixa

- **IA dos times (Gemini):** no modo admin, a tela Partida tem o botão “Montar com IA” e uma engrenagem para salvar a chave Gemini e o prompt da diretoria. Os dois ficam guardados só no servidor (junto do estado salvo, mas nunca devolvidos pela API) e a chamada ao Gemini sai do servidor. Se a chave atingir o limite, os admins veem um aviso para trocá-la. O limite do Gemini é por projeto do Google Cloud: a chave nova precisa ser de outro projeto ou outra conta.
- **Transparência:** `/api/transparency` lê a planilha pública do caixa (linha “CAIXA” e colunas Data, Descrição, Categoria, Tipo, Valor) e a aba mostra saldo, mensalistas pendentes do mês e as últimas entradas e saídas acima da planilha.

A montagem com IA usa raciocínio reduzido (`thinkingLevel: LOW`) para diminuir a espera, preservando o prompt de até 8.000 caracteres. Cada chamada ao Gemini tem limite de 15 segundos; falhas de rede, timeout e indisponibilidade temporária fazem o servidor tentar o próximo modelo, dentro de um orçamento total de 50 segundos iniciado antes da leitura das configurações. Chave recusada e cota esgotada encerram a tentativa com aviso específico. Se a montagem falhar, a tela mantém um diálogo com orientação para tentar novamente. Os logs registram apenas modelo, status e categoria da falha, sem chave, prompt ou resposta do Google.

Referências da integração: [raciocínio do Gemini](https://ai.google.dev/gemini-api/docs/generate-content/thinking) e [tratamento de falhas temporárias](https://ai.google.dev/gemini-api/docs/troubleshooting).

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

## Hospedagem e dados

A base funcional veio da versão 48 do Sites. As adaptações para Vercel + Supabase estão apenas neste repositório. Em 14/10/2026, o estado de dados da versão 233 e as 17 fotos dos jogadores foram copiados para o Supabase independente. Configure as variáveis de servidor da Vercel conforme o guia para consumir essa base. Os segredos e a hospedagem do site original permanecem separados.

- `npm run build:vercel`: gera os arquivos estáticos em `public/` e compila o backend.
- `npm test`: compila e verifica as regras e a integração com Supabase usando respostas simuladas.
- `npm run admin:credentials`: gera as credenciais do servidor a partir de uma senha informada com entrada oculta.
- `api/index.js`: função Node.js da Vercel; rewrites explícitos atendem a API e as URLs das fotos, incluindo caminhos aninhados.
- `server/supabase.mjs`: persistência PostgreSQL e fotos via APIs do Supabase.
- `supabase/migrations/0001_bagres.sql`: tabelas, permissões, salvamento atômico e bucket privado.

O login permanece por senha de administração com sessão assinada; esta integração não substitui o login por Supabase Auth. Configure `SUPABASE_URL` e `SUPABASE_SECRET_KEY` na Vercel; a chave `sb_secret_...` só é usada no servidor. A variável antiga `SUPABASE_SERVICE_ROLE_KEY` continua aceita como alternativa. A execução local padrão continua usando SQLite e fotos locais.
