## CAT Collector v2 — Extensão + Backend de Captura SIS

Vou expandir o sistema existente (CAT Smart Parts) com captura estruturada do SIS 2.0, base curada e busca inteligente.

### 1. Banco de dados (migração Supabase)

Novas tabelas + ajustes nas existentes:

- **fleets** — `id, name, owner, notes` (agrupador de máquinas do cliente)
- **machines** (já existe) — adicionar `fleet_id`, `family`
- **systems** (já existe) — reforço de unicidade `(machine_id, name, subsystem)`
- **groups** (já existe) — adicionar `illustration_ref`
- **diagrams** — `id, group_id, image_url, sis_url, captured_at`
- **parts** (já existe) — adicionar `diagram_id`, `item_position`, `status` (`pending|approved|rejected`), `source` (`manual|extension|csv`)
- **captures** — `id, sis_url, serial_number, model, system_name, subsystem, group_name, raw_payload jsonb, status, captured_at, reviewed_at, reviewed_by`
- **aliases** (já existe) — reforço

RLS: leitura pública (catálogo), escrita via service_role (endpoint público com chave compartilhada para a extensão).

### 2. Endpoint público `/api/public/sis-capture`

- POST aceita payload da extensão (URL, serial, modelo, sistema, subsistema, grupo, itens[]).
- Valida com Zod, autentica via header `x-collector-key` (secret `CAT_COLLECTOR_KEY`).
- Faz upsert em fleets/machines/systems/groups/diagrams, insere `captures` (status pending) e `parts` (status pending).
- CORS liberado para `https://sis2.cat.com` e `chrome-extension://*`.
- Endpoint OPTIONS para preflight.

### 3. Extensão Chrome (`extension/`)

Manifest V3, content script no domínio SIS 2.0:

- `manifest.json` — permissões `activeTab`, `storage`, host `https://sis2.cat.com/*`.
- `content.js` — injeta painel flutuante com 2 botões: **Capturar página** (extrai metadata + 1ª peça em foco) e **Capturar tudo visível** (varre tabela renderizada).
- Parsers tolerantes: URL → `serialNumber`; breadcrumb → modelo; sidebar ativa → sistema/subsistema/grupo; tabela → linhas (PN, descrição, qtd, posição); `<img>` do diagrama.
- `popup.html` — configurar URL do backend + collector key, ver últimas capturas (chrome.storage).
- `background.js` — fila de envio com retry, logs.
- Empacotar em `public/cat-collector.zip` via `nix run nixpkgs#zip`.

### 4. Frontend (novas rotas)

- `/base` — **Base SIS Capturada**: tabela com filtros (frota, modelo, serial, sistema, grupo, PN, descrição), busca instantânea, ações aprovar/rejeitar por linha.
- `/capturas` — fila de revisão (status pending), detalhe com payload bruto.
- `/import` — upload CSV/XLSX (sheetjs), preview + mapeamento de colunas, importação em massa como `source=csv, status=pending`.
- Página de busca existente (`/`) passa a usar a base expandida; Fuse.js + aliases já cobrem "retentor virabrequim" / "crankshaft seal".
- `/extension` (já existe) — atualizar instruções e link do zip.

### 5. Busca inteligente

- Server function `searchParts` já existe; estender para considerar `aliases` multi-idioma e ranquear por Fuse.js (threshold 0.4) com campos `description`, `part_number`, `aliases.keyword`.
- Sugestão de autocomplete via `aliases`.

### 6. Logs e tratamento de erro

- Endpoint loga em `console` (visível em server-function-logs) com requestId.
- Extensão: toast no painel + retry exponencial (3 tentativas) em `background.js`.
- Frontend: `sonner` para feedback; estados de erro nas tabelas.

### Tecnicamente

- Stack atual: TanStack Start + Supabase (Lovable Cloud).
- Secret novo: `CAT_COLLECTOR_KEY` (gero e mostro ao usuário copiar para a extensão).
- CSV/XLSX: `xlsx` (sheetjs) já comum; instalar via `bun add xlsx`.
- Fuse.js já instalado.

### Entregas

1. Migração com novas tabelas + RLS + GRANTs.
2. `src/routes/api/public/sis-capture.ts` (POST + OPTIONS).
3. `extension/` reescrita + `public/cat-collector.zip`.
4. Rotas `/base`, `/capturas`, `/import` + componentes (`CapturesTable`, `BaseFilters`, `CsvImporter`, `ReviewDialog`).
5. Extensão de `searchParts` com aliases + Fuse.
6. Atualização do `AppShell` com novos itens de menu.

Confirma que posso seguir? Em particular: (a) gerar `CAT_COLLECTOR_KEY` agora e exibir para você colar na extensão, (b) deixar leitura da base pública (anon SELECT) ou exigir login.