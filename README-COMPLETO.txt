AROEIRA G FITNESS — VERSÃO REFINADA 3.0

Objetivo
--------
Esta versão mantém o mesmo escopo do sistema original e foi reconstruída para ficar mais organizada, segura, responsiva e consistente.

FUNCIONALIDADES PRESERVADAS
---------------------------
- Login administrativo
- Dashboard com indicadores
- Cadastro, edição e exclusão de alunos
- Busca e filtros de alunos
- Perfil individual do aluno
- Histórico de pagamentos
- Confirmação de pagamento
- Geração de Pix copia e cola + QR Code
- Avaliação física e histórico de avaliações
- Dashboard de recebimentos diário/mensal/anual
- Gráficos de recebimentos
- Exportação CSV
- Backup JSON
- Importação de backup JSON
- Alteração de senha
- Sincronização com armazenamento persistente

PRINCIPAIS MELHORIAS
--------------------
- Frontend separado em index.html + app.css + app.js.
- Backend separado e organizado em API.
- Senha não é mais armazenada no localStorage.
- API exige sessão autenticada para ler ou gravar os dados.
- Sessões assinadas com HMAC e validade de 8 horas.
- Rate limit para tentativas de login.
- Hash scrypt para a credencial persistente.
- Cabeçalhos básicos de segurança.
- CORS restrito às origens autorizadas.
- Validação e normalização dos dados no backend.
- Proteção contra payloads excessivamente grandes.
- Fila de gravação para evitar colisões de atualização no GitHub.
- Normalização de valores monetários e correção do texto corrompido de “CRÉDITO 15 DIAS”.
- Layout responsivo para desktop, tablet e celular.
- Tabelas, cards, modais, badges e estados vazios padronizados.
- Uso de toasts em vez de alertas para operações normais.
- Cache local apenas como contingência; credencial não é armazenada no navegador.

DADOS
-----
O arquivo aroeira_data.json contém os dados atuais preservados do projeto. A senha original continua sendo 123456, porém foi convertida para hash antes da entrega.

API / RENDER
-----------
Diretório: api/
Comando de inicialização: npm start
Node: >= 18.20.0

Variáveis recomendadas:
GITHUB_TOKEN       Token com permissão para ler e gravar o arquivo do repositório.
GITHUB_OWNER       liderancaindigofabio-lab (opcional, já possui padrão)
GITHUB_REPO       aroeiragfitness-data (repositório privado, opcional)
GITHUB_FILE       aroeira_data.json (opcional)
GITHUB_BRANCH     main (opcional)
FRONTEND_ORIGIN   https://liderancaindigofabio-lab.github.io
SESSION_SECRET    segredo aleatório longo e permanente para as sessões
ADMIN_USER        admin (opcional)

ADMIN_PASSWORD é opcional apenas como credencial de emergência/primeira migração. Se o arquivo já possui passwordHash, o hash do arquivo tem prioridade.

No Render, publique apenas a pasta api como Web Service. A variável PORT é fornecida automaticamente pelo Render.

FRONTEND / GITHUB PAGES
-----------------------
Publique somente index.html, app.css, app.js e download.html no repositório público do frontend.
O frontend já aponta por padrão para:
https://aroeira-gfitness-sync.onrender.com

Se a API mudar de endereço, defina antes do carregamento:
window.AROEIRA_API_URL = 'https://SEU-ENDPOINT';

IMPORTANTE
----------
O arquivo aroeira_data.json não deve ser exposto como uma página pública de consulta. O frontend refinado não usa esse arquivo para autenticação nem para leitura direta; a leitura operacional passa pela API autenticada.

TESTE LOCAL DA API
------------------
Para testar sem GitHub:
STORAGE_MODE=local PORT=18765 node api/server.js

Nesse modo a API usa ./aroeira_data.json como armazenamento local.

LOGIN INICIAL
-------------
Usuário: admin
Senha: 123456

Recomenda-se alterar a senha imediatamente depois da primeira publicação.
