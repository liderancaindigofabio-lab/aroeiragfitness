# Aroeira G Fitness — publicação GitHub-only

## Arquitetura e limites

- O painel estático é publicado no GitHub Pages a partir da raiz de `main` do repositório público `liderancaindigofabio-lab/aroeiragfitness`.
- Os dados dos alunos continuam exclusivamente no repositório privado `liderancaindigofabio-lab/aroeiragfitness-data`, no arquivo `aroeira_data.json`.
- O painel acessa o arquivo privado pela GitHub Contents API, diretamente do navegador, usando um Fine-grained personal access token (PAT) criado pelo administrador.
- A API Render suspensa não faz parte deste fluxo e não deve ser tratada como restaurada.
- Este desenho não é um login OAuth de um clique: o administrador precisa criar e digitar o PAT no painel. Não há token administrativo embutido no site.

## Publicar o frontend

Mantenha os arquivos do painel no repositório público e no caminho raiz esperado pelo GitHub Pages:

- `index.html`
- `app.css`
- `app.js`
- `github-storage.js`
- `marketing-logo.png`
- `vendor/chart.umd.min.js`
- `vendor/qrcode.min.js`

Os scripts e assets usados pelo painel são servidos localmente. Não publique o repositório privado, o JSON de alunos, tokens, cópias de backup ou pendências locais junto ao frontend.

Em **Settings → Pages**, mantenha a publicação a partir do branch `main` e da raiz (`/`). Após cada publicação, aguarde o build do Pages e teste a URL oficial do site.

## Criar o acesso do administrador

No GitHub, crie um Fine-grained personal access token com estas restrições:

1. **Resource owner:** `liderancaindigofabio-lab`.
2. **Repository access:** `Only select repositories`, selecionando somente `aroeiragfitness-data`.
3. **Repository permissions:** `Contents` — `Read and write`; nenhuma outra permissão é necessária.
4. Escolha uma expiração curta compatível com a rotina e revogue o token se ele for perdido ou exposto.

O PAT Fine-grained restringe o repositório inteiro, não um arquivo individual. Por isso, mantenha a seleção limitada ao único repositório privado de dados. A pessoa que cria o token deve ter autorização/acesso ao repositório.

Abra o site oficial do painel e cole o PAT no campo protegido. O painel valida o acesso lendo o arquivo privado antes de aceitar o token. Ele fica apenas no `sessionStorage` daquela sessão do navegador; fechar a sessão/aba encerra o acesso. Nunca envie o token por mensagem, não o coloque em tickets/arquivos e nunca o inclua em commits ou no JavaScript público. Se o token aparecer em algum lugar indevido, revogue-o imediatamente no GitHub.

O proprietário deve fazer essa configuração no próprio navegador. Não envie a senha do GitHub nem o valor do token a terceiros.

## Sincronização e segurança de dados

- Leituras e gravações são feitas no Contents API para `aroeira_data.json` do repositório privado.
- Cada gravação envia o SHA observado do arquivo; se a versão remota mudar em paralelo, a gravação é recusada e a edição local fica como pendência para revisão. Não sobrescreva manualmente uma pendência sem conferir o arquivo exportado e a versão atual.
- Pendências locais permanecem no navegador para recuperação. Pendências legadas nunca são reaplicadas automaticamente; uma pendência atual também não é enviada se a versão-base remota mudou. Exporte e revise a cópia antes de removê-la.
- O painel não usa um cache persistente com a lista de alunos. A sessão autenticada mantém os dados em memória; cópias exportadas e pendências locais ainda exigem proteção do dispositivo do administrador.
- Alterações confirmadas pelo Contents API criam commits no histórico do repositório privado. Preserve os controles de acesso e a retenção desse repositório.
- O token é uma credencial do administrador mantida pelo navegador. Proteja a conta GitHub, o dispositivo e a sessão; não é possível oferecer proteção contra alguém com acesso ao navegador já autenticado.

## Verificação após publicação

1. Confirmar que a página publicada carrega os scripts locais e não solicita a API Render.
2. Sem PAT, confirmar que apenas a tela de conexão aparece e nenhum dado privado é exibido.
3. Com o PAT restrito, confirmar leitura do arquivo e carregamento do painel.
4. Verificar que o logout encerra a sessão e que não permanece um cache local persistente de alunos.
5. Para testar gravações reais, usar somente após autorização do administrador e com um procedimento de teste que não altere dados reais; esta validação deve ser feita pelo proprietário.
6. Não declarar sincronização de escrita validada até a etapa 5 ser testada com segurança.
