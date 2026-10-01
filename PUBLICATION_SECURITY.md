# Publicação segura — Aroeira G Fitness (GitHub-only)

## Separação obrigatória

- O repositório público `liderancaindigofabio-lab/aroeiragfitness` contém somente o frontend e seus assets públicos.
- `aroeira_data.json`, com dados pessoais e históricos dos alunos, permanece no repositório privado `liderancaindigofabio-lab/aroeiragfitness-data`.
- Nunca copie o arquivo privado, dados reais, tokens, backups ou pendências locais para o repositório público.
- A API Render atualmente suspensa não é o backend desta versão; não configure, altere nem declare restaurada essa API como parte da migração.

## Acesso via GitHub Contents API

O GitHub Pages é público e não pode guardar um segredo de servidor. A versão estática não usa OAuth/device flow no navegador e não implementa login de um clique. Para conectar, o proprietário cria no GitHub um Fine-grained PAT restrito a **somente** `aroeiragfitness-data`, com apenas `Contents: Read and write`, e o digita na tela do painel.

O token fica no `sessionStorage` da sessão do navegador. Nunca o embuta no código, HTML, repositório, URL, log, backup ou mensagem. Nunca use tokens do conector de publicação da Zapia no site. Tokens Fine-grained têm acesso ao repositório inteiro — não a um arquivo específico — portanto a restrição a um único repositório e a expiração curta são essenciais. O proprietário deve revogar imediatamente um token exposto.

## Integridade e privacidade

- Toda leitura/gravação aponta ao caminho privado esperado; o site público contém apenas o nome do repositório e caminho, não o conteúdo dos dados.
- A gravação usa o SHA remoto e rejeita alterações concorrentes. Em conflito ou indisponibilidade, a edição é preservada como pendência local. Pendências legadas nunca são reaplicadas automaticamente; versões-base divergentes exigem revisão antes de qualquer reenvio.
- Pendências podem conter dados pessoais; proteja o navegador/dispositivo e os arquivos exportados. Remova pendências somente após exportar e revisar.
- Dados carregados não devem permanecer em cache persistente local. A sessão autenticada mantém os dados em memória.
- Nenhum teste de gravação deve ser feito contra o arquivo de produção usando dados fictícios, salvo se o proprietário autorizar um procedimento seguro que não substitua registros reais.

## Revisão antes de publicar

- Verificar sintaxe JavaScript e estrutura do HTML.
- Conferir se IDs são únicos e se referências estáticas do app existem.
- Confirmar que scripts/assets usados são locais e que CSP autoriza apenas os recursos necessários.
- Procurar referências ao Render, endpoints antigos, credenciais, tokens e dados privados no frontend.
- Revisar cada interpolação de dados pessoais inserida em HTML e escapar texto e atributos.
- Confirmar que as permissões e instruções do PAT correspondem ao único repositório privado de dados.
- Depois do deploy, verificar a página GitHub Pages publicada, sem PAT, e confirmar que nenhum dado privado é servido antes da autenticação.
