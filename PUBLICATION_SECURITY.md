# Publicação segura — Aroeira G Fitness

## Regra obrigatória

Este projeto separa o **frontend público** dos **dados privados da academia**.

- `index.html`, `app.css`, `app.js` e `download.html` podem ser publicados no GitHub Pages.
- `private-data/aroeira_data.json` contém dados pessoais e **não deve ser publicado em repositório público**.
- O repositório que armazena `aroeira_data.json` deve ser privado.
- A API deve acessar o arquivo por `GITHUB_TOKEN` com o menor escopo possível.
- Nunca coloque `GITHUB_TOKEN` ou `SESSION_SECRET` no frontend.

## Deploy recomendado

1. Repositório público: somente frontend.
2. Repositório privado: dados da academia.
3. API no Render: `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_FILE`, `GITHUB_BRANCH`, `GITHUB_TOKEN`, `SESSION_SECRET`.
4. Configure `FRONTEND_ORIGIN` exatamente para o domínio publicado.
5. Faça um backup do JSON antes de qualquer migração.
6. Depois do primeiro login, troque a senha administrativa.

## Validação obrigatória

Testar:
- login;
- carregamento dos alunos;
- edição de aluno sem perda de histórico;
- novo pagamento;
- exclusão de pagamento;
- nova avaliação;
- exclusão de avaliação;
- backup/exportação;
- importação;
- sincronização;
- alteração de senha;
- bloqueio de `/api/sync` sem sessão.

## Proteção contra regressão

A edição de aluno deve alterar apenas os campos editáveis do cadastro. `evaluations`, `paymentHistory` e `gymHistory` são dados históricos e nunca devem ser substituídos por arrays vazios durante uma edição.
