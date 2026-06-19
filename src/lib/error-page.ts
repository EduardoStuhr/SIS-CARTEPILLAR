export function renderErrorPage() {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Erro interno</title>
  </head>
  <body>
    <main>
      <h1>Não foi possível carregar a aplicação.</h1>
      <p>Tente novamente em alguns instantes.</p>
    </main>
  </body>
</html>`;
}
