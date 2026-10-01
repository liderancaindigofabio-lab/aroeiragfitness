# Aroeira G Fitness — Cloudflare Worker + D1

A API do sistema usa Cloudflare Workers e Cloudflare D1. O frontend é publicado no GitHub Pages e usa o endpoint definido em `app.js`.

## Proteção dos dados

O navegador criptografa o cofre com AES-GCM antes de enviá-lo. O D1 armazena apenas o registro criptografado, além do verificador de senha e sessões temporárias. Não coloque dados de alunos, senhas ou tokens neste repositório.

## Publicação

Com Wrangler autenticado na conta correta, a partir desta pasta:

```sh
wrangler d1 execute aroeira-gfitness-data --remote --file=schema.sql
wrangler deploy
```

O banco e o Worker já foram criados na conta Cloudflare da Aroeira. `wrangler.toml` contém apenas identificadores de infraestrutura, sem credenciais.

## Operação

- O login administrativo é `Admin`; a senha é definida separadamente e não deve ser armazenada no código.
- A API permite somente a origem do GitHub Pages da Aroeira.
- Sessões expiram em 8 horas; tentativas de login são limitadas.
- O plano gratuito tem limites de uso. Confira o painel Cloudflare; não habilite plano pago sem autorização do proprietário.
