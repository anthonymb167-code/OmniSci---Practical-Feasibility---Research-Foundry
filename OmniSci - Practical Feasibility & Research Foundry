# OmniSci — Practical Feasibility & Universal Research Foundry

OmniSci translates complex theoretical descriptions, empirical data graphs, chemical formulas, and historical 1500s scientific manuscripts into actionable engineering blueprints grounded in active commercial material science, protected by continuous biometric presence security.

### User Review & Critical Decisions

> [!IMPORTANT]
> The foundational system features dual-track execution (Maker DIY Prototyping vs. Investor-Grade Commercialization), continuous 1.0-second biometric camera presence locking with emergency note dictation, and multi-century scientific translation (1500s alchemy to modern IUPAC stoichiometry).

- **Confirmed Decision 1 (Dual-Track Output)**: Deliver dual parallel pathways for every inquiry: a personal maker fab-lab protocol (< $1,000, 3D printing, benchtop tools) alongside an institutional investor dossier (TRL 1–9, CAPEX/OPEX, unit economics, TAM).
- **Confirmed Decision 2 (Active Biometric Eye Guard)**: Continuous optical presence verification via live camera stream or precision simulation. If the user moves away for > 1.0 second, the workspace enters instant lockdown, while preserving an emergency written/audio note capture pad.
- **Confirmed Decision 3 (Historical & Polyglot Translation)**: Dedicated engine translating 1500s–1800s alchemical texts (Paracelsus, Robert Boyle, Newton) and non-English papers into modernized IUPAC equations and non-toxic green chemistry equivalents.

---

### 1. Overview & Core Concept

- **What It Does**: OmniSci ingests any scientific data—ranging from theoretical text, CSV experimental curves, SMILES formulas, or 16th-century manuscripts—and validates its practical feasibility against 42,000+ real, commercially synthesized materials. It generates step-by-step roadmaps, automated regulatory audits, and extraterrestrial logistics adaptations.
- **Target Audience / Persona**: Scientific researchers, DIY biotech makers, deep-tech founders, pharmaceutical engineers, aerospace logistics architects, and historians of science.
- **Key Value**: Eliminates the barrier between theoretical curiosity and empirical physical execution, providing realistic bill-of-materials sourcing and regulatory clarity in seconds.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. *Universal Ingestion*: User pastes text, loads CSV curves, enters SMILES formulas, or inputs historical alchemical texts.
  2. *Empirical Simulation*: System evaluates thermodynamic feasibility, matches active CAS precursors, and computes TRL progression.
  3. *Dual Execution Inspection*: Switch between the personal maker protocol and the investor-grade commercialization roadmap.
  4. *Active Biometric Security & Emergency Dictation*: Continuous optical monitoring pauses the workspace if absent for > 1.0s, offering rapid audio/text note capture that AI can automatically bind to active projects.
  5. *Dossier Export*: 1-click export of investor pitch packages, lab SOP protocols, or regulatory filing matrices.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Deep space obsidian console (`#090D16`), clinical telemetry panels, calibrated laser cyan (`#06B6D4`) and amber accents, with crisp hairline borders (`1px solid #1E293B`).
  - *Typography*: Technical neo-grotesque interface pairing (`Inter` / `Plus Jakarta Sans`) with dedicated tabular monospace numerals (`Fira Code` / `tabular-nums`) for coordinates, CAS numbers, and stoichiometry.
  - *Anti-AI Slop Restraint*: Unboxed metadata text separated by typographic middots (`·`), zero decorative pill badges, zero code-comment headers, single-elevation surfaces, and purposeful interactive buttons.
- **Interactive Feedback & Motion**:
  - Real-time optical reticle canvas tracking face presence and confidence.
  - Interactive SVG stress-strain and yield curves with hover crosshairs.
  - Smooth status transitions for modular milestone cards (Planned → In Progress → Completed).

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Continuous Biometric Presence with 1.0s Absence Lock**
  - *Chosen Approach*: Lightweight client-side optical flow & chromaticity computer-vision heuristic coupled with a simulated sensor toggle.
  - *Why*: Delivers strict biometric security for proprietary scientific formulations while guaranteeing instantaneous responsiveness without cloud streaming latency.
  - *Alternatives Considered*: Heavy WebGL neural networks were bypassed to maintain 60 FPS performance and avoid download stalls.
- **Decision 2: Dual Personal Maker & Investor Tracks**
  - *Chosen Approach*: Parallel output schemas containing both DIY fab-lab protocols (< $1,000 budget, 3D printing, safety warnings) and venture investor models (TRL 1–9, CAPEX/OPEX, unit economics).
  - *Why*: Accommodates both grassroots independent researchers and institutional founders in a unified interface.
- **Decision 3: Server-Authoritative Gemini Feasibility Engine**
  - *Chosen Approach*: Server-side Express API routes (`/api/feasibility/analyze`, `/api/historical/translate`, `/api/notes/synthesize`) using `@google/genai` with `gemini-3.8-flash`.
  - *Why*: Adheres strictly to AI Studio security guidelines (API keys never exposed to browser) while providing fast, structured JSON reasoning with resilient local fallback schemas.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        BROWSER CLIENT (React 19)                       │
├──────────────────────────┬─────────────────────────┬───────────────────┤
│ Biometric Security Guard │ Universal Ingestion Hub │ Project Workspace │
│ - WebRTC / Video Stream  │ - Text & Theory specs   │ - Dual Track View │
│ - 1.0s Absence Stopwatch │ - SVG Curve Visualizer  │ - Milestone Board │
│ - Lockdown & Note Pad    │ - SMILES & CAS Lookup   │ - CAS Material BOM│
│ - Audio Speech-to-Text   │ - 1500s Alchemy Decrypt │ - Regulatory Grid │
└────────────┬─────────────┴────────────┬────────────┴─────────┬─────────┘
             │                          │                      │
             │ HTTP POST /api/notes     │ HTTP POST /api/...   │
             ▼                          ▼                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      EXPRESS BACKEND (server.ts)                       │
├────────────────────────────────────────────────────────────────────────┤
│ • /api/feasibility/analyze   -> TRL, Materials, Dual Pathways, Space   │
│ • /api/historical/translate -> 1500s Manuscripts to Modern IUPAC       │
│ • /api/notes/synthesize      -> Parameter Extraction & Project Binding │
│ • Vite Middleware (Dev)      -> Serves client on port 3000             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       GOOGLE GEMINI AI ENGINE                          │
│               (@google/genai: gemini-3.8-flash, JSON Mode)             │
└────────────────────────────────────────────────────────────────────────┘
```

- **State Model**: Persistent `ScientificProject` records storing materials catalogs, maker/investor dual plans, automated regulatory matrix, space logistics, and attached audio/written research notes.
- **Interactive Component Mapping**:
  - `BiometricSecurityGuard`: Optical video canvas, absence timer loop, audio recorder (Web Audio / MediaRecorder), emergency dictation pad.
  - `UniversalIngestionHub`: Multi-tab data intake, interactive SVG chart engine, preset loaders, asynchronous simulation caller.
  - `ProjectWorkspace`: Interactive milestone state toggling, live PubChem chemical links, Markdown/JSON dossier generator.
  - `NotesAndToolsHub`: Global research notes ledger with waveform audio playback and standalone 1500s manuscript decoder.
