# Aroeira G Fitness — publicação da versão refinada

## 1. Backend

Publique a pasta `api/` como Web Service no Render.

Comando:

`npm start`

Configure:

- `GITHUB_TOKEN`
- `FRONTEND_ORIGIN=https://liderancaindigofabio-lab.github.io`
- `SESSION_SECRET=<segredo longo e aleatório>`
- `GITHUB_OWNER=liderancaindigofabio-lab`
- `GITHUB_REPO=aroeiragfitness-data`
- `GITHUB_FILE=aroeira_data.json`
- `GITHUB_BRANCH=main`

Não é necessário configurar `ADMIN_PASSWORD` porque o arquivo de dados já possui `passwordHash`.

## 2. Frontend

Publique:

- `index.html`
- `app.css`
- `app.js`
- `download.html`

O frontend usa por padrão:

`https://aroeira-gfitness-sync.onrender.com`

Se o endereço da API mudar, altere `API_BASE` no início de `app.js` ou defina `window.AROEIRA_API_URL` antes do carregamento do app.

## 3. Dados

Mantenha `aroeira_data.json` no repositório privado usado pelo backend. O token do GitHub deve ter somente as permissões necessárias para esse repositório.

## 4. Primeiro acesso

Usuário: `admin`
Senha inicial: `123456`

Depois do primeiro acesso, altere a senha pelo menu de configurações.

## 5. Validação pós-publicação

1. Abrir o frontend.
2. Fazer login.
3. Confirmar que os 126 alunos aparecem.
4. Abrir um perfil.
5. Editar um aluno e confirmar persistência.
6. Cadastrar um aluno e confirmar persistência.
7. Registrar um pagamento e verificar Dashboard + Histórico.
8. Excluir um pagamento e verificar os totais.
9. Criar uma avaliação e verificar histórico.
10. Gerar Pix e copiar o código.
11. Exportar CSV.
12. Baixar backup JSON.
13. Importar um backup de teste.
14. Alterar a senha e entrar novamente.
15. Testar no celular.
16. Verificar `/api/health`.
17. Confirmar que `/api/sync` sem Bearer responde 401.
