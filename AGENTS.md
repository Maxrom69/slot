# AGENTS.md — Slot Studio Master Project Rules

## 1. PRIMARY OBJECTIVE

Maintain and extend the existing Slot Studio application without breaking its current functionality.

Establish a consistent project structure, document every implementation section, and create verified incremental Google Drive backups after every section is completed.

These rules apply to all current and future sections:

- **F — Frontend / Slots Studio Builder**
- **B — Backend / Slot Game Engine**
- **C — Image Editor**
- Any additional sections or subsystems introduced later.

These are global project rules, not a request to rebuild the application.

## 2. INSPECT THE EXISTING PROJECT BEFORE MAKING CHANGES

Before creating directories, moving files, modifying configuration, or changing architecture:

1. Inspect the actual project root.
2. Identify the existing framework, routes, components, stores, services, database, persistence mechanisms, tests, scripts, and build configuration.
3. Identify the existing directory structure and determine which proposed directories already exist.
4. Read relevant implementation reports and existing documentation.
5. Identify the canonical GameBlueprint contract and the current scene, state, and persistence architecture.
6. Determine whether Git or another reliable change-tracking mechanism is available.
7. Determine whether authorized Google Drive integration is available.
8. Produce a concise assessment of the current structure and any necessary additions.

Do not assume that example paths or filenames in this prompt already exist.

Do not replace the existing architecture simply to match the proposed folder structure.

**Preserve all working features, routes, components, data, configurations, and integrations unless a change is explicitly required.**

## 3. RECOMMENDED PROJECT ROOT STRUCTURE

Use the following as a target organizational model. Adapt it to the real project and existing conventions rather than blindly creating every directory.

```text
slot-studio/
│
├── README.md
├── CHANGELOG.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── next.config.ts
├── drizzle.config.ts
├── electron-builder.yml
├── .gitignore
│
├── docs/
│   ├── README.md
│   │
│   ├── implementation/
│   │   ├── INDEX.md
│   │   │
│   │   ├── F-frontend/
│   │   │   ├── F01-<confirmed-section-name>.md
│   │   │   ├── F02-<confirmed-section-name>.md
│   │   │   ├── F03-<confirmed-section-name>.md
│   │   │   ├── F04-<confirmed-section-name>.md
│   │   │   ├── F05-canvas-system.md
│   │   │   └── F06-<confirmed-section-name>.md
│   │   │
│   │   ├── B-backend/
│   │   │   ├── B01-slot-game-engine-architecture.md
│   │   │   ├── B02-game-definition-schema.md
│   │   │   ├── B03-<confirmed-section-name>.md
│   │   │   └── ...
│   │   │
│   │   ├── C-image-editor/
│   │   │   ├── C01-<confirmed-section-name>.md
│   │   │   ├── C02-<confirmed-section-name>.md
│   │   │   └── ...
│   │   │
│   │   └── other/
│   │       └── <confirmed-section-name>.md
│   │
│   ├── architecture/
│   │   ├── application-architecture.md
│   │   ├── folder-structure.md
│   │   ├── game-blueprint-contract.md
│   │   ├── data-flow.md
│   │   └── persistence.md
│   │
│   ├── testing/
│   │   ├── testing-strategy.md
│   │   └── regression-checklist.md
│   │
│   └── backups/
│       ├── Backup-Manifest.md
│       └── backup-policy.md
│
├── public/
│   ├── images/
│   ├── icons/
│   ├── fonts/
│   └── audio/
│
├── src/
│   ├── app/
│   ├── components/
│   ├── features/
│   ├── game/
│   ├── stores/
│   ├── services/
│   ├── lib/
│   ├── hooks/
│   ├── types/
│   └── utils/
│
├── electron/
│   ├── main.js
│   ├── preload.js
│   └── ...
│
├── server/
│   └── ...
│
├── db/
│   ├── schema/
│   └── migrations/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── regression/
│   └── fixtures/
│
├── scripts/
│   └── ...
│
├── assets/
│   ├── symbols/
│   ├── backgrounds/
│   ├── frames/
│   ├── audio/
│   └── imported/
│
├── data/
│   └── demo-games/
│
├── .next/          # Generated build output; do not back up by default
├── node_modules/   # Installed dependencies; do not back up by default
└── dist/           # Packaging output; do not back up by default
```

### Important structure rules

- The tree is illustrative, not a requirement to create every folder.
- Confirm section names from the actual prompts, code, and existing documentation.
- Never invent section titles or pretend a section has been implemented.
- Keep source files organized by technical responsibility, not by prompt ID.
- Do not duplicate components or source files into separate F01, F02, F03, or similar directories merely to match prompt sections.
- A single section may modify files in several existing directories. Its implementation report must document every relevant change.
- Use the project's actual extensions and configuration filenames. For example, do not create `next.config.ts` if the existing project uses `next.config.js` without a specific reason.
- Do not create duplicate routes, stores, services, or schemas.

## 4. SOURCE CODE ORGANIZATION

Organize code by responsibility, following the existing architecture.

Where applicable, responsibilities may include:

- `src/app/` — application routes and page entry points.
- `src/components/` — reusable UI components.
- `src/features/` — feature-specific implementation modules.
- `src/game/` — GameBlueprint contracts, game schemas, and shared game types.
- `src/stores/` — canonical application and scene state.
- `src/services/` — persistence, exports, and external integrations.
- `src/lib/` — shared libraries and framework utilities.
- `src/hooks/` — reusable React hooks.
- `src/types/` — shared TypeScript types.
- `src/utils/` — general-purpose utilities.
- `tests/` — unit, integration, and regression tests.
- `electron/` — Electron main-process, preload, and desktop application files, if applicable.

These are organizational guidelines. Reuse existing equivalents instead of introducing competing systems.

### Architecture boundaries

**F — Frontend**

Responsible for the visual builder, canvas, scene editing, symbols, layers, and configuration workflows.

**B — Backend**

Responsible for the actual slot game engine and runtime logic. It must consume the agreed GameBlueprint contract rather than duplicating game-engine logic in React components.

**C — Image Editor**

Responsible for image-editing operations such as crop, resize, format conversion, brightness, contrast, and saving edited images, according to the confirmed scope of each C section.

Do not silently expand one section into another section's responsibilities.

Do not introduce AI agents, fake AI workflows, or unrequested AI-generated functionality.

## 5. MANDATORY MARKDOWN IMPLEMENTATION REPORT FOR EVERY SECTION

Every section that is implemented, modified, repaired, or completed must have its own `.md` implementation report.

Examples:

- `docs/implementation/F-frontend/F05-canvas-system.md` (or the repository's existing `docs/implementation/<ID>-<confirmed-section-name>.md` convention)
- `docs/implementation/B-backend/B01-slot-game-engine-architecture.md`
- `docs/implementation/C-image-editor/C01-<confirmed-section-name>.md`

Use the actual confirmed section names.

If a report already exists, update it instead of creating a duplicate.

### Every implementation report must contain

1. Section ID and name.
2. Objective and scope.
3. Requirements and explicit exclusions.
4. Implementation summary.
5. Files created, modified, and deleted, including paths.
6. Architecture and dependencies.
7. Relevant components, interfaces, schemas, stores, and APIs.
8. Data flow and persistence behavior.
9. Integration points with other sections.
10. UI controls, actions, keyboard shortcuts, and expected behavior, where applicable.
11. Tests, type checks, builds, and their actual results.
12. Requirement-by-requirement status: `PASS`, `PARTIAL`, `FAIL`, or `NOT VERIFIED`.
13. Known issues, limitations, placeholders, and unverified behavior.
14. Remaining work and next steps.
15. Google Drive backup location and status.
16. Last update date.

Document what the code actually implements, not merely what the prompt requested.

Never claim that a feature, test, build, upload, or verification succeeded without evidence.

A feature that has not been verified must be marked `NOT VERIFIED`.

A partially implemented feature must be marked `PARTIAL`.

A failed requirement must be marked `FAIL`.

## 6. MASTER IMPLEMENTATION INDEX

Maintain:

`docs/implementation/INDEX.md`

This file must provide a central inventory of all known sections.

For each section, record:

- Section ID.
- Confirmed section name.
- Purpose.
- Implementation report path.
- Implementation status.
- Verification status.
- Last update date.
- Known gaps.
- Google Drive backup location and status.

Do not mark a section complete just because a prompt was submitted.

Use evidence from the code and actual verification results.

Keep the index synchronized with the implementation reports.

## 7. GOOGLE DRIVE BACKUP DIRECTORY

Use an authorized Google Drive connector or another supported upload integration.

Create the following directory structure in Google Drive:

```text
Slot Studio Backups/
│
├── Backup-Manifest.md
│
├── F - Frontend/
│   ├── F01/
│   ├── F02/
│   ├── F03/
│   ├── F04/
│   ├── F05/
│   └── F06/
│
├── B - Backend/
│   ├── B01/
│   ├── B02/
│   ├── B03/
│   └── ...
│
├── C - Image Editor/
│   ├── C01/
│   ├── C02/
│   ├── C03/
│   └── ...
│
└── Other Sections/
    └── ...
```

### Google Drive rules

- Reuse the existing backup root if it already exists.
- Do not create duplicate directories on repeated runs.
- Record stable folder IDs or references when available.
- Create one backup folder for each section.
- Preserve the original relative paths of uploaded files inside the section folder.
- Do not upload the entire project after each section.
- Do not claim that Google Drive has been configured unless access and folder creation have been confirmed.
- If authorization is required, explain the required action.
- Never simulate uploads when no upload mechanism is available.

## 8. MANDATORY INCREMENTAL BACKUP AFTER EVERY SECTION

Immediately after each section's implementation, verification, and Markdown documentation are complete, perform its incremental Google Drive backup.

Examples:

- Complete F05 → back up F05's changed files.
- Complete F06 → back up F06's changed files.
- Complete B01 → back up B01's changed files.
- Complete C01 → back up C01's changed files.

Do not wait until the entire F, B, or C prompt pack is finished.

If verification fails, document the failure. Back up useful work when appropriate, but mark the section incomplete and report the actual status.

## 9. UPLOAD ONLY FILES CREATED OR MODIFIED BY THE CURRENT SECTION

This is a strict requirement.

### Before implementation

Record the starting file-change state using Git status/diff or another reliable change-tracking mechanism.

Where Git is available, distinguish changes that already existed before the section began from changes made by the current section.

Do not assume all existing local changes belong to the current task.

### After implementation

Identify the exact files that were:

- Created.
- Modified.
- Deleted.

Upload only files created or modified by the current section.

Include its implementation report if the report was created or updated.

Include `INDEX.md` and the backup manifest only when they were actually updated.

Include tests, configuration, assets, schemas, migrations, and other documentation only when they were created or modified by the current section.

Do not upload unchanged files.

Do not upload the entire source tree, application, or project.

Exclude the following by default:

- `node_modules/`
- `.next/`
- `dist/`
- Build caches.
- Temporary files.
- Logs unrelated to the implementation record.
- Generated artifacts that can be recreated.
- API keys, access tokens, credentials, and secrets.
- Sensitive `.env` files.

If a specific generated or configuration file is necessary for recovery, assess it individually and exclude any secrets.

### If change tracking is unavailable

Do not guess which files changed.

Use available project history and file evidence to establish the safest possible change list. If the exact changes cannot be established reliably, report that limitation before uploading uncertain files.

## 10. PRESERVE FILE PATHS IN SECTION BACKUPS

Example: suppose F05 modifies:

- `src/components/canvas/StageCanvas.tsx`
- `src/stores/sceneStore.ts`
- `docs/implementation/F-frontend/F05-canvas-system.md`

The backup should contain only those changed files, organized as follows:

```text
Slot Studio Backups/
└── F - Frontend/
    └── F05/
        ├── src/
        │   ├── components/
        │   │   └── canvas/
        │   │       └── StageCanvas.tsx
        │   └── stores/
        │       └── sceneStore.ts
        └── docs/
            └── implementation/
                └── F-frontend/
                    └── F05-canvas-system.md
```

This is an example only. Use the real paths and changed files discovered during implementation.

Do not move the local source files to match the backup layout.

### Repeated updates to a section

If F05 is repaired later:

- Update the F05 implementation report.
- Upload the newly created or modified files.
- Update the F05 backup safely.
- Preserve earlier versions when supported.
- Do not overwrite an unrelated Drive file.
- Identify destination files using exact IDs or another reliable unique reference.

If a file is deleted locally, record the deletion in the manifest. Do not assume that omitting the file from a later upload deletes its old Drive copy.

## 11. BACKUP MANIFEST

Maintain:

- Local manifest: `docs/backups/Backup-Manifest.md`
- Google Drive manifest: `Slot Studio Backups/Backup Manifest.md` (File ID: `1nPfzpYU4k3oZ2jYa6mqmDezVLDhuKXYn`)

Update a manifest only when its contents change, and include that changed manifest in the incremental backup where applicable.

Record the following for every section and backup attempt:

- Section ID and name.
- Backup date and time.
- Local files created, modified, and deleted.
- Google Drive destination paths.
- Uploaded file IDs or stable references, where available.
- Verification results.
- Backup status: `SUCCESS`, `PARTIAL`, or `FAILED`.
- Files that failed to upload.
- Failure reasons.
- Retry status.
- Outstanding issues.

Never put passwords, access tokens, API keys, or other secrets in either manifest.

## 12. VERIFY EVERY UPLOAD

After uploading:

1. Confirm that Google Drive accepted each expected file.
2. Verify the destination and filename.
3. Record the file ID or stable reference where available.
4. Compare file sizes or checksums if supported.
5. Confirm that all expected files appear in the manifest.
6. Retry failed uploads when safe.
7. Mark the backup `PARTIAL` or `FAILED` if any required upload remains unsuccessful.

Do not claim that a backup is successful merely because an upload operation was initiated.

If the integration cannot verify file contents, explain exactly what was verified and what remains unverified.

## 13. SYNCHRONIZE REPORTS AND BACKUPS

The implementation report, master index, and backup manifest must reflect the actual final state.

Follow this order:

1. Finish the implementation.
2. Run applicable tests and verification.
3. Write the implementation report with actual results.
4. Identify the section's changed files.
5. Upload the changed files.
6. Verify the upload.
7. Update the local backup manifest and master index.
8. Upload those metadata files if they changed and are part of the required backup workflow.
9. Verify any additional uploads.
10. Update the implementation report with the final backup status if that report changes.
11. If the report changes after being uploaded, upload the updated report and verify it again.

Repeat only as necessary to ensure that the final implementation report accurately reflects the final backup status.

Do not upload unchanged files merely to repeat the workflow.

## 14. REQUIRED WORKFLOW FOR EVERY SECTION

For every section, follow this sequence:

1. Inspect the project and relevant documentation.
2. Record the initial change-tracking state.
3. Confirm the section's exact requirements and dependencies.
4. Implement only the requested scope.
5. Preserve existing functionality and architecture.
6. Run applicable tests, type checks, and builds.
7. Verify the requirements and document any gaps.
8. Create or update the section-specific `.md` report.
9. Update the master implementation index.
10. Identify files created, modified, and deleted by the section.
11. Upload only the eligible changed files to the section's Google Drive backup folder.
12. Verify the uploaded files.
13. Update the local and Google Drive backup manifests as applicable.
14. Ensure the final report and backup metadata reflect the actual result.
15. Provide a concise completion summary.

Do not start an unrelated section automatically unless explicitly instructed.

## 15. COMPLETION SUMMARY REQUIRED AFTER EVERY SECTION

After each section, provide:

- **Section:** ID and confirmed name.
- **Implementation status:** `COMPLETED`, `PARTIAL`, `FAILED`, or `NOT VERIFIED`.
- **Implementation report:** Exact local path.
- **Master index:** Updated or not updated.
- **Files created:** Count and list.
- **Files modified:** Count and list.
- **Files deleted:** Count and list.
- **Tests and builds:** Commands executed and actual results.
- **Google Drive destination:** Actual folder path or reference.
- **Files uploaded:** Count and list.
- **Backup status:** `SUCCESS`, `PARTIAL`, or `FAILED`.
- **Unverified items:** Any remaining uncertainty.
- **Outstanding work:** Bugs, missing features, or follow-up tasks.

Never report a successful test, file creation, folder creation, upload, or verification unless supported by evidence.

## 16. PROJECT SAFETY AND INTEGRITY

These rules must not cause the Agent to:

- Rebuild the application from scratch.
- Replace working architecture unnecessarily.
- Change existing routes or visual identity without authorization.
- Introduce duplicate state stores or business logic.
- Refactor unrelated files.
- Implement features assigned to another section.
- Add unrequested AI agents or simulated AI workflows.
- Delete or move local files as part of the backup process.
- Upload credentials or sensitive information.
- Claim access to unavailable services.
- Claim a backup is complete when it is not.

Inspect first. Make minimal, scoped changes. Test. Document. Back up. Verify.

## 17. FINAL NON-NEGOTIABLE REQUIREMENTS

Every section must leave behind:

1. A section-specific Markdown implementation report.
2. An accurate entry in `docs/implementation/INDEX.md`.
3. A record in the backup manifest.
4. An incremental Google Drive backup containing only the files created or modified by that section, including changed required documentation and metadata.
5. A completion summary stating the real implementation, test, and backup status.

**The Markdown report preserves implementation knowledge. The Google Drive backup preserves the actual changed files. The index provides a central inventory. The manifest records the backup history.**

If a required operation cannot be performed, report the limitation explicitly and mark the relevant status as incomplete. Never fabricate success.

---

## 18. PROJECT-SPECIFIC TECHNICAL & GOOGLE DRIVE REFERENCE (ACTUAL VERIFIED STATE)

### 18.1 Existing Repository Structure Assessment
- **Framework & Build**: Next.js 15 (`next.config.ts`), React 19, TypeScript 5 (`tsconfig.json`), Tailwind CSS 4 (`postcss.config.mjs`), Drizzle ORM (`drizzle.config.json`).
- **Source Layout (`src/`)**:
  - `src/app/` — Next.js App Router pages and API routes (`/`, `/new`, `/projects/[id]/...`, `/project/[projectId]/...`, `/api/projects/...`, `/api/folders/...`).
  - `src/components/` — UI and workspace components (`assets/`, `canvas/`, `creation/`, `dashboard/`, `design/`, `layers/`, `project/`, `shell/`, `studio/`, `ui/`).
  - `src/lib/` — Domain models, state, and pure operations (`assets/`, `blueprint/`, `canvas/`, `creation/`, `design/`, `editor/`, `elements/`, `export/`, `layers/`, `manual-editor/`, `paylines/`, `paytable/`, `preview/`, `projects/`, `reels/`, `studio/`, `theme/`, `validation/`, `workspace/`).
  - `src/db/` — Drizzle schema (`schema.ts`), database connection (`index.ts`), and deterministic local file-backed PostgreSQL fallback (`local-pool.ts` persisting to `.local/slot-studio-db.json`).
  - `src/server/` — Server-side services (`workspace-service.ts`, `design-service.ts`, `asset-service.ts`).
- **Tests (`tests/`)**:
  - `17` automated Node `tsx` test suites (`tests/*.test.ts` — `131/131` passing) plus browser test scripts (`tests/*.browser.mjs`).
- **Documentation (`docs/`)**:
  - `docs/implementation/INDEX.md` — Master implementation index (`F01`–`F17`).
  - `docs/implementation/F01..F17-*.md` — Existing verified implementation reports (`F01` through `F17`).
  - `docs/backups/Backup-Manifest.md` — Master Google Drive backup manifest.

### 18.2 Verified Google Drive Backup Folder & File IDs
| Google Drive Path | Google Drive ID | Purpose |
| --- | --- | --- |
| `Slot Studio Backups/` | `1KbJujCuFnukvn7XQMaXgMRqiVYJhm7pM` | Root Backup Directory |
| `Slot Studio Backups/Backup Manifest.md` | `1nPfzpYU4k3oZ2jYa6mqmDezVLDhuKXYn` | Root Master Backup Manifest File |
| `Slot Studio Backups/AGENTS.md` | `1dUlu8jdk2vwbgJVmIjY8BY3QX-K3Kn5d` | Root Master Project Rules File |
| `Slot Studio Backups/F - Frontend/` | `1PSoT-AA0p6-l9OGAOiQGVESI7DAjHM0t` | Frontend Sections (`F01`–`Fxx`) |
| `Slot Studio Backups/B - Backend/` | `1RMX0xU4YgJqWq7m_CUIwY20cI5jvSIS4` | Backend / Slot Engine Sections (`B01`–`Bxx`) |
| `Slot Studio Backups/C - Image Editor/` | `1-ShpkSQCvnB8jHvinP-gTASNCxkt5f8H` | Image Editor Sections (`C01`–`Cxx`) |
| `Slot Studio Backups/Other Sections/` | `1C38KM6lMHSbxsO9hkkTOFS-bGjJrzSlH` | Non-standard / Cross-cutting Sections |

### 18.3 Completed Section Folder IDs (`F01`–`F17`)
| Section ID | Confirmed Section Name | Status | Local Report Path | Test Suite | Google Drive Folder ID |
| --- | --- | --- | --- | --- | --- |
| `F01` | Studio Foundation & Core Architecture | `COMPLETED` | `docs/implementation/F01-studio-foundation-and-core-architecture.md` | `tests/foundation.test.ts` | `19YyEbVLBoRvQbfq9frudcCpmJhg7LY4q` |
| `F02` | Dashboard | `COMPLETED` | `docs/implementation/F02-dashboard.md` | `tests/dashboard.test.ts` | `1EpmmG8fKVW57U9eD1SxOKf1RD27wg58P` |
| `F03` | Project Creation | `COMPLETED` | `docs/implementation/F03-project-creation.md` | `tests/creation.test.ts` | `1P5c0BOuTQ81RlK2cFTM8jk0QSI2uRL2s` |
| `F04` | Design View | `COMPLETED` | `docs/implementation/F04-design-view.md` | `tests/design.test.ts` | `1eJyw_cax4OtXGxyQbeAie_pTh9w9xvEz` |
| `F05` | Canvas System | `COMPLETED` | `docs/implementation/F05-canvas-system.md` | `tests/canvas.test.ts` | `16eodGW1OZ9Wu9nnYfxJN6euSPKyyGcsX` |
| `F06` | Layers System | `COMPLETED` | `docs/implementation/F06-layers-system.md` | `tests/layers.test.ts` | `1LnhMC8y20zcp-_q1GI-20EdNW15nLjdQ` |
| `F07` | Element System | `COMPLETED` | `docs/implementation/F07-element-system.md` | `tests/elements.test.ts` | `1Qlkk6lMvkrdf0CIM9GG_iNxGRVN_ywDU` |
| `F08` | Symbol Sets | `COMPLETED` | `docs/implementation/F08-symbol-sets.md` | `tests/symbol-sets.test.ts` | `13Unt4fZYRdrtH6Kurn3GsAd_sKOdwjiA` |
| `F09` | Symbol Editor | `COMPLETED` | `docs/implementation/F09-symbol-editor.md` | `tests/symbol-editor.test.ts` | `1-utIlFbAhV51djdPZjb0Y478P_I_A0GT` |
| `F10` | Asset Management | `COMPLETED` | `docs/implementation/F10-asset-management.md` | `tests/assets.test.ts` | `1ZyUieApdBF6_KqjaA5-Z-ThV4bf9HrN1` |
| `F11` | Element Detail View | `COMPLETED` | `docs/implementation/F11-element-detail-view.md` | `tests/element-detail.test.ts` | `1IoGGxSbGbrIcKj6CTgPBAHSDsBxXSzhp` |
| `F12` | Image History | `COMPLETED` | `docs/implementation/F12-image-history.md` | `tests/image-history.test.ts` | `1nGGpPzJCIxpITIleAcfTL8kMV7tVD0Jo` |
| `F13` | Manual Element Editor | `COMPLETED` | `docs/implementation/F13-manual-element-editor.md` | `tests/manual-editor.test.ts` | `1wWybnPVQ5tqkyQsqvlvuOavkRoSfd33j` |
| `F14` | Reel Editor | `COMPLETED` | `docs/implementation/F14-reel-editor.md` | `tests/reel-editor.test.ts` | `19pgGy21wZ6cGQClOYjuQker18qUbOyQ3` |
| `F15` | Payline Editor | `COMPLETED` | `docs/implementation/F15-payline-editor.md` | `tests/payline-editor.test.ts` | `1HLsYsL_tf9FRT6ELzgp7dzbXYUnUvDab` |
| `F16` | Paytable Editor | `COMPLETED` | `docs/implementation/F16-paytable-editor.md` | `tests/paytable-editor.test.ts` | `1bLKP2buMTL9f0DeJiiMOgj6Le4b9qa2A` |
| `F17` | Preview Controls | `COMPLETED` | `docs/implementation/F17-preview-controls.md` | `tests/preview-controls.test.ts` | `13Pe4FsMckhfJbgk_PhPnNRW3zMEElGAp` |
