# Publicar a cópia do FC Bagres na Vercel

Esta preparação não publica no Sites/OpenAI nem modifica sua base de dados. Não execute os comandos de hospedagem do Sites. `.openai/hosting.json` é a configuração histórica e não participa do deploy da Vercel.

## 1. Criar o Supabase

1. Crie um novo projeto no plano Free; prefira uma região próxima dos jogadores.
2. No SQL Editor, execute o conteúdo completo de `supabase/migrations/0001_bagres.sql`.
3. Confira as tabelas `site_state`, `admin_attempts` e o bucket privado `bagres-player-photos`.
4. Copie a URL do projeto e a chave **legacy service_role JWT** em Settings > API Keys > Legacy keys. Este adaptador não usa a chave anon/publishable.

As tabelas usam RLS sem acesso para clientes anônimos ou usuários comuns. O servidor recebe acesso por service_role. O salvamento compara a versão em uma operação atômica, evitando sobrescrita entre dispositivos.

O bucket aceita JPG, PNG e WebP de até 2 MB. As fotos são exibidas publicamente pela API do site; apenas admins autenticados podem enviar ou remover. Não torne o bucket público nem exponha a chave de servidor no navegador.

## 2. Credenciais da administração

Com Node.js 24 instalado, execute:

```sh
npm run admin:credentials
```

Informe uma nova senha de 12 a 128 caracteres com entrada oculta. Copie os valores ADMIN_PASSWORD_HASH e ADMIN_SESSION_KEY exibidos para a Vercel. Guarde a senha escolhida. Não há senha padrão de produção.

As sessões usam cookies HttpOnly, Secure e SameSite=Strict, com duração de 12 horas. A limitação de tentativas considera o IP fornecido pela Vercel. Trocar ADMIN_SESSION_KEY encerra as sessões.

## 3. Importar na Vercel

1. Import Project > GitHub > CrisParnoff/bagres-dmunique.
2. Root Directory: raiz do repositório.
3. Framework Preset: **Other**; Node.js: **24.x**.
4. `vercel.json` define Build Command `npm run build:vercel` e Output Directory `public`. Não use `npm start` para servir na Vercel.
5. Cadastre estas variáveis no ambiente do deploy:

| Variável | Valor |
| --- | --- |
| SUPABASE_URL | URL HTTPS do novo projeto |
| SUPABASE_SERVICE_ROLE_KEY | Chave legacy service_role JWT |
| SUPABASE_STORAGE_BUCKET | bagres-player-photos |
| ADMIN_PASSWORD_HASH | Gerado pelo comando de credenciais |
| ADMIN_SESSION_KEY | Gerado pelo comando de credenciais |

As chaves ficam apenas no servidor. Não use prefixo NEXT_PUBLIC_ e não publique arquivos .env. O arquivo .env.example não contém segredos. Para editar dados em Preview, use um Supabase de teste separado: uma Preview com o mesmo banco pode alterar dados da nova produção.

6. Faça o deploy. Mudanças posteriores nas variáveis exigem um novo deploy.

## 4. Conferir a nova cópia

- Página inicial e logos carregam.
- /api/session responde {"admin":false} antes do login.
- A nova senha permite entrar como admin.
- Edite um nome, recarregue e confira a persistência.
- Envie uma foto, confira a exibição e teste sua remoção.
- Confira rankings, Stats e artes.

Sem configurar banco e credenciais, a interface pode carregar, mas a API responde 503. O build não depende de segredos e não os incorpora.

## Histórico do site original

Esta etapa prepara o código. Ainda precisamos exportar o estado do D1 e as fotos do R2 para o Supabase. Até lá, a nova cópia inicia com o elenco do código e sem partidas antigas. Ela não se conecta nem sincroniza com o site OpenAI.

Preserve uma cópia dos dados e fotos durante a migração. Não troque o link divulgado ao grupo antes de conferir o histórico. O plano Free não substitui um backup independente.

## Verificação

`npm test` compila e executa testes de futebol, artes e integração. A integração usa respostas Supabase simuladas e cobre login, origem, limitação de tentativas, conflitos de versão e envio/leitura/remoção de fotos. O SQL e as rotas da Vercel precisam ser validados nos serviços reais após configurá-los.

Referências oficiais:
- https://vercel.com/docs/functions
- https://vercel.com/docs/project-configuration/vercel-json
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/reference/self-hosting-storage
