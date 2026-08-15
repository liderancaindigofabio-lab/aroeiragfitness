# Instruções para revisar e publicar — Aroeira G Fitness v4

Este projeto é independente do MultiGym. Não adicione funcionalidades do MultiGym e não transforme o sistema em outro produto.

## Objetivo
Manter o escopo atual e entregar um sistema enxuto, bonito, profissional e funcional.

## Correção já aplicada
A edição de aluno foi corrigida para preservar:
- `evaluations`
- `paymentHistory`
- `gymHistory`

Não reverta essa regra.

## Dados
O arquivo `private-data/aroeira_data.json` é material privado de migração e contém dados pessoais. NÃO o publique em GitHub Pages nem em repositório público.

O recomendado é:
- frontend em repositório público;
- JSON de dados em repositório privado;
- API no Render com token de acesso ao repositório privado.

## Antes de publicar
1. Instale dependências da API.
2. Execute a API localmente.
3. Faça build/teste do frontend.
4. Teste login.
5. Teste GET/POST `/api/sync` autenticado.
6. Confirme que `/api/sync` sem Bearer retorna 401.
7. Edite um aluno que tenha pagamentos e avaliações e confirme que nenhum histórico é perdido.
8. Crie pagamento e confirme que aparece no perfil e nos indicadores.
9. Crie/exclua avaliação.
10. Teste backup/exportação/importação.
11. Teste alteração de senha.
12. Configure variáveis permanentes no Render.
13. Configure `FRONTEND_ORIGIN` para o domínio real.
14. Publique somente os arquivos do frontend no GitHub Pages.

Não recrie o sistema do zero. Não altere o escopo sem autorização.
