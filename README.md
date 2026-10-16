Slot Studio

A visual slot-game blueprint builder with a deterministic backend engine and a headless local Playtest runtime.

Documentation snapshot: October 16, 2026 — implementation through B18.

    Important: This is a development and local Playtest application, not a certified real-money casino platform. The visual Preview workspace and the B18 backend runtime are separate: the default frontend preview adapter is still disconnected from the backend runtime. A working backend does not automatically make the Preview Spin button a connected playable game.

Contents

    What the app does
    How it works
    Requirements
    Install and run locally
    Storage and configuration
    Using the studio
    Using the backend runtime
    Build and verification
    Project structure
    Backup and recovery
    Troubleshooting
    Questions and answers
    Current limitations
    Further documentation

1. What the app does

Slot Studio helps designers and developers define a slot game, organize its artwork and presentation, configure its mathematical inputs, and inspect real backend outcomes.
Area 	What is available
Project workspace 	Create games, organize folders, search/filter projects, duplicate projects, and manage saved project data.
Game creation 	Manual configuration of a game draft, grid, symbols, artwork references and initial settings.
Design and canvas 	Elements, layers, scene objects, layout, object properties, manual composition and editing history.
Artwork and symbols 	Asset library, artwork assignment, symbol sets, symbol editing and image-history workflows.
Reels and payouts 	Reel strips/stops, paylines, paytable entries, bet levels and configuration validation.
Presentation 	Scenes, supported animation configuration, overlays and visual preview controls.
Export 	Blueprint JSON, Project JSON, ZIP bundles and PNG asset sheets.
Backend engine 	Seeded RNG, real reel/board evaluation, paylines, ways, clusters, pay-anywhere, wilds, scatters and configured advanced mechanics.
Math and verification 	Statistical simulation, payout/distribution/volatility reporting, authored deterministic verification cases and replay.
Local Playtest runtime 	Isolated sessions, paid spins, explicit feature continuation, settlement, bounded history, snapshots, replay and saved-project HTTP endpoints.

Some navigation labels and reserved tools describe future capabilities. A visible label is not a guarantee that its feature is implemented. For example, AI providers are explicitly unavailable; there is no active AI-generation service.
2. How it works
The shared game definition

The central data contract is GameBlueprint. It describes the game's metadata, symbols, reels, payouts, artwork, scenes and other configuration. Backend schema/normalization code turns supported definitions into the inputs used by the actual engines.

Studio editors
    ↓
GameBlueprint and saved project data
    ↓
Validation and backend configuration
    ↓
Seeded RNG → reels → board → win evaluation
    ↓
Configured features, cascades, multipliers, values and meters
    ↓
Authoritative settlement and immutable results

The frontend is responsible for editing and presentation. It must not invent gameplay wins, choose production reel stops or change authoritative feature state.
Three different ways to inspect a game

    Visual Preview: Inspect layout, symbols, scenes, overlays and available presentation settings. The default adapter reports “Runtime Engine Not Connected” instead of generating fake spins.
    Math simulation and deterministic verification: Developer-facing engine APIs run configured rounds, accumulate statistics or compare outcomes against explicitly authored expectations. Setting an RTP target does not automatically tune the game to that RTP.
    B18 local runtime: Start a session and execute one paid spin or feature continuation per request. It uses the shared real engines and returns the resulting state, events and settlement.

Determinism and settlement

The same compatible definition, seed, starting state and inputs should reproduce the same engine result. Different definition revisions or mechanic settings can change the result even if the seed stays the same.

The runtime charges a paid wager once, charges zero additional wager for its free feature actions, and applies the configured cumulative round cap. Repeating an identical completed request ID returns the original result rather than charging again. Failed execution does not commit a partial gameplay state.
3. Requirements

    Node.js: Use a currently supported LTS release, such as Node.js 22 LTS. The installed Next.js package declares a minimum of Node.js 20.9.0; the minimum is not a recommendation to use an end-of-life release.
    npm: A compatible npm installation, normally included with Node.js.
    Git: Needed if cloning the repository rather than using a supplied source archive.
    Browser: A current desktop browser for the visual studio.
    Writable storage: Needed for the default local project database and local development/build files.
    Internet: Needed to obtain npm dependencies. There is no required AI API key or AI provider subscription.

PostgreSQL is optional for the default local setup. The application has a JSON-backed local persistence adapter when DATABASE_URL is not set.

The stack currently includes Next.js 16.2.6, React 19.2.6, TypeScript, Tailwind CSS 4 and Drizzle ORM.
4. Install and run locally
Step 1 — Obtain the application source

git clone https://github.com/Maxrom69/slot.git
cd slot

Use a branch or release that contains the implemented application. Before continuing, confirm the checkout contains package.json, src/ and tests/.

If a checkout contains only the original ZIP archive and workflow, it is not yet the runnable application tree. Obtain the application-bearing branch/release or the complete supplied source directory. Do not expect a development ZIP alone to be an installed application.
Step 2 — Check Node.js and npm

node --version
npm --version

Step 3 — Install locked dependencies

npm ci

Run this from the project directory containing package-lock.json. Do not substitute a globally installed Next.js version for the repository's locked dependencies.
Step 4 — Choose local storage

For the simplest setup, leave DATABASE_URL unset. Check both your shell and any .env/.env.local files; a configured database URL selects PostgreSQL instead of the local adapter.

No environment file is required for the default local setup.
Step 5 — Start development mode

npm run dev

Open http://localhost:3000. The root route redirects to /games; the workspace initializes demonstration projects on first access.

If port 3000 is occupied:

npm run dev -- --port 3001

Open the port printed in the terminal. Stop the server with Ctrl+C.
Remote machines and hosted development previews

If the server must be reachable outside its own machine:

npm run dev -- --hostname 0.0.0.0 --port 3000

Use the actual hosted preview URL in your browser. Browser requests to the application should use the same origin and relative API paths—not the remote server's localhost address. Restrict network access: the current app is not a hardened public multi-tenant service.
Run a production build locally

npm run build
npm run start

start requires a successful build. To choose an explicit interface/port:

npm run start -- --hostname 0.0.0.0 --port 3000

These commands run the Next.js production server. They do not make the runtime a certified or financially durable production gaming platform.
5. Storage and configuration
Default JSON-backed storage

Without DATABASE_URL, project/workspace persistence uses:

.local/slot-studio-db.json

The local adapter stores workspace records, including saved project blueprints and associated asset records. The parent directory must be writable. Local mode is intended for development/Playtest, not concurrent deployment across multiple server processes.

To choose another local database path, set:

SLOT_STUDIO_LOCAL_DB_PATH=/absolute/path/to/slot-studio-db.json

For example, an optional local .env.local file can contain that setting. Use a location you can back up and that is not publicly served. If DATABASE_URL is set, this local-path setting does not switch the app away from PostgreSQL.
Optional PostgreSQL setup

This is an advanced alternative to the quick-start local adapter:

    Create a dedicated PostgreSQL database and an appropriate database user.

    Set DATABASE_URL in the server environment or .env.local, using your own credentials:

    DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/slot_studio

    Initialize the schema defined in src/db/schema.ts using Drizzle tooling against that dedicated database.

    Restart the app with the same database configuration.

For a disposable development database, an example Bash schema-push command is:

npx drizzle-kit push --dialect=postgresql --schema=./src/db/schema.ts --url="$DATABASE_URL"

The shell must actually have DATABASE_URL exported for that command. Next.js loading .env.local for the app does not mean every separately invoked command has that variable in its environment. Do not mix an explicit CLI configuration with a conflicting Drizzle configuration file.

Review proposed schema changes before accepting them. Back up an existing database first; do not run schema-push commands blindly against valuable or production data. The repository's drizzle.config.json contains a development connection example and is not automatically the same as your runtime environment setting. There is no packaged npm run migrate script.

Changing storage backends does not automatically migrate existing JSON-backed projects into PostgreSQL. Treat migration as a separate, planned operation.
Health endpoint

Visit /api/health or run:

curl http://localhost:3000/api/health

A healthy response is {"ok":true}. This checks the database connection/adapter query; it does not certify that every schema table, game configuration or runtime feature is correct.
Configuration security

Do not commit credentials, local database contents or environment files. Do not expose the JSON database through public/. Only trust forwarded host/protocol headers from your own reverse proxy. HTTPS is required for Secure runtime cookies outside plain local development.
6. Using the studio
A practical first-project workflow

    Open Your Games at /games and inspect a demonstration project.
    Choose New Game at /games/new for a new draft.
    Use the manual creation workflow to define the title, grid, symbols and initial game settings.
    Organize the project into workspace folders as needed.
    Add/import artwork in the asset library, assign it to symbols or elements, and check image/history references.
    Use Design/Canvas to arrange elements, layers and scene objects.
    Configure reel stops, active paylines, paytable entries and bet levels. Keep symbol references consistent across these settings.
    Inspect scenes, overlays and supported animation settings in Preview. This is not proof of a connected gameplay runtime.
    Save the project and address validation messages before exporting or using backend tools.
    Export Blueprint JSON or Project JSON for data exchange/recovery, a ZIP for a studio bundle, or a PNG sheet for visual reference.

A PNG asset sheet is not an editable project database. A studio ZIP is not an automatically deployed, self-contained casino game.
Keyboard shortcuts

In workspaces that register the relevant editor actions:
Shortcut 	Action
V 	Select/move tool
Delete 	Delete selected elements
Ctrl/Cmd + Z 	Undo
Ctrl/Cmd + Shift + Z 	Redo
Ctrl/Cmd + S 	Save active project
F 	Toggle supported fullscreen workspace mode

Shortcuts are context-sensitive. Raster brush, eraser, blur and pixel-eyedropper shortcuts are reserved/unavailable in the current shared shortcut registry; do not assume this is a full raster image editor.
7. Using the backend runtime

B18 is a headless local Playtest API, not a new frontend gameplay screen. It loads an already saved project and delegates outcomes to the backend engines.
Available endpoints
Method 	Path 	Purpose
POST 	/api/runtime/sessions 	Create a local session from a saved project.
GET 	/api/runtime/sessions/:id 	Read the session view/state.
GET 	/api/runtime/sessions/:id/history 	Read retained history.
POST 	/api/runtime/sessions/:id/start 	Move a created session into a ready state.
POST 	/api/runtime/sessions/:id/spin 	Execute one paid action when allowed.
POST 	/api/runtime/sessions/:id/continueFeature 	Execute one allowed feature action.
POST 	/api/runtime/sessions/:id/snapshot 	Issue a same-runtime snapshot.
POST 	/api/runtime/sessions/:id/restore 	Restore an eligible issued snapshot.
POST 	/api/runtime/sessions/:id/replay 	Replay a retained spin without changing the live session.
POST 	/api/runtime/sessions/:id/reset 	Reset and advance the request epoch.
POST 	/api/runtime/sessions/:id/close 	Close the session.
Example from the app's browser console

Use this only with your own local application and a saved project whose backend configuration is supported. Replace the project ID; it is not a game name. Keep each new action's request ID unique, and use the current epoch after resets.

async function request(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data;
}

const projectId = "REPLACE_WITH_YOUR_SAVED_PROJECT_ID";
const project = await request(`/api/projects/${projectId}`);
const session = await request("/api/runtime/sessions", {
  projectId,
  seed: "my-local-playtest-seed",
  initialBalance: 1000,
  bet: project.blueprint.math.betLevels[0],
});
const root = `/api/runtime/sessions/${session.sessionId}`;
await request(`${root}/start`, {});
const result = await request(`${root}/spin`, {
  requestId: "paid-001",
  epoch: session.state.epoch,
});
console.log(result.settlement, result.nextAction);

If result.nextAction is continueFeature, issue a separate continueFeature request with a new request ID and the current epoch. Do not submit another paid spin while a feature is waiting for continuation. There is no automatic frontend feature loop.

The runtime establishes an HttpOnly owner cookie. Keep the same browser/client cookie context across requests. Plain JSON payloads cannot provide fixed reel stops, arbitrary definitions, mechanic commands, seeds for an existing spin or writable runtime state. Fixed stops require explicitly enabled, trusted in-process verification—not a production HTTP request field.

Some advanced mechanics require authored extensions.backendRuntime policies. A configuration flag alone may not specify a complete playable rule. Unsupported/incomplete policies reject rather than silently awarding invented results.
Persistence boundary

Saved studio projects persist in the selected project database. Runtime sessions do not. Session state, local owners, processed-request receipts and issued snapshots are in-memory and disappear when the process restarts.

Snapshots must be issued by the same live runtime and match its owner/receipt checks. Restoring a snapshot intentionally rewinds local Playtest state; it is not a financial recovery mechanism. After a restart, old runtime cookies/sessions may need to be cleared/recreated.
8. Build and verification
Available npm scripts
Command 	Purpose
npm run dev 	Start the development server.
npm run build 	Build the production application.
npm run start 	Start the previously built application.
npm run typecheck 	Run TypeScript without emitting application code.
npm run lint 	Run ESLint.

There is no npm test script in the current package file.
Running automated tests safely

Tests create and modify project records. Never point them at valuable workspace or production data. Use a fresh disposable local database path and ensure DATABASE_URL is unset for these test processes.

Example for Bash on Linux/macOS, from the repository root:

env -u DATABASE_URL SLOT_STUDIO_LOCAL_DB_PATH="$PWD/.local/readme-tests-only.json" \
  npx tsx --test tests/dashboard.test.ts

env -u DATABASE_URL SLOT_STUDIO_LOCAL_DB_PATH="$PWD/.local/readme-tests-only.json" \
  npx tsx --test --test-concurrency=1 tests/*.test.ts

Choose a new unused test filename for a clean run. The first command seeds dashboard fixtures that other suites expect. The full regression is run serially because suites share that disposable database. On Windows, set the environment variables using PowerShell and pass the expanded list of tests/*.test.ts files if the shell does not expand that wildcard.

For the dedicated runtime/API suites:

env -u DATABASE_URL SLOT_STUDIO_LOCAL_DB_PATH="$PWD/.local/runtime-tests-only.json" \
  npx tsx --test tests/playable-runtime.test.ts tests/runtime-api.test.ts

tsx is invoked through npx and is not currently listed as a locked project dependency; the first invocation may download it. The Bash-specific env -u syntax is not a native PowerShell command.
Latest recorded checkpoint

The B18 implementation report records:

    349/349 full-suite tests passing across 42 test files.
    33/33 dedicated runtime/API tests passing.
    Typecheck, lint and production build passing.
    An actual production-server HTTP smoke test covering settlement, idempotency, replay, snapshots, ownership, forbidden fixed stops and stale request epochs.

These are recorded results from the implementation checkpoint, not a claim that installation was repeated or tests were rerun while writing this README. No source code was changed for this documentation request.
9. Project structure

src/
  app/                  Next.js pages and HTTP API routes
  components/           Studio UI workspaces and reusable controls
  db/                   Drizzle schema and local/PostgreSQL adapters
  engine/               Backend schema, RNG, evaluation, mechanics and runtime
    math/               Simulation/statistics and shared execution
    verification/       Deterministic authored-case verification
    runtime/            Headless playable-session orchestration
  lib/                  Blueprint, editor, assets, export and client helpers
  server/               Project/asset/canvas/runtime route services
public/                 Static assets
tests/                  Automated tests and authored fixtures
docs/implementation/    Section reports and implementation index
docs/backups/           Backup records and historical manifest archive

The frontend and backend share contracts, not a second independent set of slot rules. Engine outcomes remain backend responsibilities.
10. Backup and recovery

For a meaningful project backup:

    Stop writes, then copy the local database file, or take a consistent PostgreSQL backup as appropriate.
    Keep project/blueprint exports and referenced artwork available.
    Preserve the matching application source/version and configuration needed to interpret that data.
    Keep secrets outside shared exports and source backups.
    Test restoration into a separate environment before relying on a backup.

Repository implementation backups are incremental, organized in Google Drive under Slot Studio Backups, with section records in docs/backups/Backup-Manifest.md. An incremental section folder alone is not a complete runnable project snapshot. Historical records are preserved in the manifest archive.

Uploading a README or exporting a PNG does not back up your current project database. In-memory Playtest sessions are not durable backup data and cannot be recovered merely by restarting the app.
11. Troubleshooting
Symptom 	What to check
package.json not found 	You are in the wrong directory or have an archive/workflow-only checkout instead of the implemented source tree.
Node/Next.js version error 	Check node --version; use a supported LTS compatible with Next.js 16.
Dependencies missing 	Run npm ci in the application directory with network access to npm.
Port already in use 	Choose another port and open the URL printed by Next.js.
next start cannot find a build 	Run npm run build successfully first.
Database connection failure 	Check whether DATABASE_URL unexpectedly selects PostgreSQL; verify connectivity and configuration.
PostgreSQL relation/table missing 	Initialize/review the schema in the intended database. A successful select 1 health check does not create tables.
Local changes are not saved 	Confirm the configured database path, directory permissions and available storage; inspect server errors.
Preview says runtime is disconnected 	Expected with the default frontend adapter. B18 supplies a separate headless API, not automatic Preview integration.
Runtime returns 403 	Keep the owner cookie, use the same origin, and do not send fixed stops or unsupported fields. Clear stale runtime cookies after a server restart if necessary.
Paid spin rejected during a feature 	Follow nextAction and submit continueFeature instead.
Stale-epoch request rejected 	Fetch current session state and use its epoch after reset.
A repeated request does not produce a new spin 	Reusing the same request ID intentionally returns its original result. Use a new ID for a new action.
A configuration is rejected 	Check symbol IDs, reel records, bet levels and required advanced mechanic policies. Do not silence validation by substituting made-up outcomes.
Full tests fail on missing demo fixtures 	Use a fresh isolated database, seed through tests/dashboard.test.ts, then run the suites serially.
12. Questions and answers
Q: Is Slot Studio an online casino?

A: No. It is a blueprint-design and engine-development application with local Playtest tooling. It does not provide player accounts, deposits, withdrawals, a durable financial wallet or gaming certification.
Q: Do I need PostgreSQL just to try it?

A: No. Leave DATABASE_URL unset to use the JSON-backed local adapter. PostgreSQL requires its own database and schema setup.
Q: Does it use AI to create the game or artwork?

A: No active AI generation is implemented. AI/Agent provider entries are reserved/unavailable. The working creation process is manual and does not require an LLM API key.
Q: Why does Preview say “Runtime Engine Not Connected” when a backend engine exists?

A: The presentation adapter is still disconnected by default. The backend engine and B18 session API exist independently; wiring the visual Preview to that runtime is separate work and is not claimed as complete here.
Q: Are the backend results fake or hard-coded demo wins?

A: No. Configured backend evaluation uses actual reel, board and mechanic engines. Tests author specific inputs and expected outcomes for verification; those fixtures are not a production outcome generator.
Q: Can the same seed always recreate a result?

A: It requires the same compatible definition/revision, algorithm, effective mechanics, starting state and action inputs. A seed alone is not enough if those change.
Q: Does an RTP target automatically balance or optimize the game?

A: No. Simulation reports and target-compliance checks exist; an autonomous reel-strip optimizer is not implemented. A short simulation is not a certified theoretical RTP calculation.
Q: Can I choose winning reel stops through the HTTP API?

A: No. Ordinary runtime requests reject fixed stops and other state/mechanic injections. Fixed-stop execution belongs to explicitly enabled trusted verification tooling.
Q: Are free spins charged again?

A: The B18 runtime keeps the triggering bet context and charges zero additional wager for allowed feature continuations. It does not treat every feature action as another paid spin.
Q: What if the network retries a request?

A: The same request ID, epoch and inputs return the completed result if retained. Conflicting reuse rejects. Even if a result has expired from retained history, its processed ID is not silently executed again. This guarantee is local to the live runtime; it is not durable across process restarts.
Q: Will a saved project or Playtest session survive restarting the server?

A: Saved projects survive when their database/storage survives. In-memory runtime sessions, owners and snapshot receipts do not.
Q: Can I restore a snapshot on another server?

A: Not with the current API. Restoration requires the issuing live runtime's receipt and owner checks. The snapshot hash is not a cryptographic authorization signature.
Q: Can I export an instantly deployable playable game?

A: Current exports are studio data/assets: Blueprint JSON, Project JSON, ZIP bundles and PNG sheets. They are not a turnkey hosted casino deployment or an independently certified game executable.
Q: Can several users or server instances safely share this as a production service?

A: That deployment is not the current supported claim. Local owner cookies are not full account authentication, and the local adapter/runtime do not provide distributed transaction authority.
Q: Do uploaded implementation backups include my current game database?

A: Do not assume so. The documented section backups focus on changed implementation files and records. Back up your actual project database and artwork deliberately.
Q: Are brush, blur, advanced artwork generation and every roadmap label usable now?

A: No. Some controls/capability slots are reserved or unavailable. The existing manual layout tools should not be mistaken for a complete raster-artwork suite or an implemented future phase.
13. Current limitations

    B18 is a bounded, single-process local runtime. Default limits include 64 sessions, 64 loaded game revisions, 32 retained history entries, 10,000 processed requests per session, 512 retained observations per step, and 256 issued snapshot receipts per runtime.
    Closed sessions and loaded revisions still consume configured runtime capacity. Snapshot receipts/history are bounded; expired data is not a permanent archive.
    No frontend runtime connection, remote account-authentication system, real-money wallet, distributed session store or worker orchestration is provided by B18.
    Advanced mechanics need sufficient authored policy; a capability flag alone does not define all rules.
    Exact math percentiles retain a frequency map proportional to distinct returns; no million-spin performance certification is claimed.
    Fingerprints are noncryptographic identity/checksum aids, not security signatures.
    Legacy fork/custom-seed snapshots without recoverable RNG lineage can be rejected rather than replayed under a different identity.
    No promise is made that every possible authored mechanic composition has been exhaustively certified. See the implementation reports before relying on a specific advanced configuration.

14. Further documentation

Paths below are relative to the repository root. When reading this file alone in Google Drive, obtain the corresponding repository/backup files to follow them.

    Implementation index
    B01 — Slot Game Engine Architecture
    B02 — Game Definition Schema
    B03 — RNG System
    B16 — Math Simulation & Statistics Engine
    B17 — Deterministic Verification Engine
    B18 — Playable Game Runtime
    Backup manifest

Documentation-only delivery: This Readme.md describes the existing application. It does not change application code, connect the frontend runtime, install dependencies, alter database configuration or authorize the next implementation phase.
