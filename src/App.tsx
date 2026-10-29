import React, { useState, useEffect } from 'react';
import {
  Atom,
  Workflow,
  PlusCircle,
  FileSpreadsheet,
  Mic,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  Search,
  Filter,
  Sparkles,
  Layers,
  ChevronDown,
  Lock,
  Globe,
  Hammer,
  TrendingUp,
} from 'lucide-react';
import { ScientificProject, ScientificNote, BiometricSecurityState } from './types/scientific';
import { SEED_PROJECTS } from './data/seedProjects';
import { BiometricSecurityGuard } from './components/BiometricSecurityGuard';
import { UniversalIngestionHub } from './components/UniversalIngestionHub';
import { ProjectWorkspace } from './components/ProjectWorkspace';
import { NotesAndToolsHub } from './components/NotesAndToolsHub';
import { BillingPanel } from './components/BillingPanel';

export default function App() {
  // Load saved projects from localStorage or default to SEED_PROJECTS
  const [projects, setProjects] = useState<ScientificProject[]>(() => {
    try {
      const saved = localStorage.getItem('omnisci_projects');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.warn('Error reading saved projects:', e);
    }
    return SEED_PROJECTS;
  });

  const [activeProjectId, setActiveProjectId] = useState<string>(projects[0]?.id || 'proj-isru-martian-regolith');
  const [activeTab, setActiveTab] = useState<'workspace' | 'ingestion' | 'notes-tools'>('workspace');
  const [disciplineFilter, setDisciplineFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Active continuous biometric presence security state
  const [securityState, setSecurityState] = useState<BiometricSecurityState>({
    isArmed: true,
    isPresent: true,
    absenceDurationSeconds: 0,
    pausedReason: '',
    mode: 'simulated', // Defaults to simulated for instant, frictionless preview; user can click "Enable Webcam" anytime!
    sensitivity: 8,
    faceConfidence: 96,
    emergencyNoteAllowed: true,
    auditLog: [
      {
        timestamp: new Date().toLocaleTimeString(),
        event: 'Biometric Presence Guard Initialized (1.0s Absence Threshold)',
        status: 'verified',
      },
    ],
  });

  const [isLocked, setIsLocked] = useState<boolean>(false);

  // Sync projects to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('omnisci_projects', JSON.stringify(projects));
    } catch (e) {
      console.warn('Error saving projects to localStorage:', e);
    }
  }, [projects]);

  // Active project getter
  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];

  // Add note handler
  const handleAddNote = async (noteData: Partial<ScientificNote>, targetProjectId?: string) => {
    const projId = targetProjectId || activeProjectId;
    const newNote: ScientificNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      projectId: projId,
      title: noteData.title || `Lab Observation (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
      content: noteData.content || '',
      type: noteData.type || 'written',
      audioBlobUrl: noteData.audioBlobUrl,
      audioDuration: noteData.audioDuration,
      createdAt: new Date().toISOString(),
      extractedParameters: noteData.extractedParameters || [],
      complianceImpact: noteData.complianceImpact,
      tags: noteData.tags || ['Scientific-Foundry'],
    };

    setProjects((prev) =>
      prev.map((p) => {
        if (p.id === projId) {
          return {
            ...p,
            notes: [newNote, ...p.notes],
            updatedAt: new Date().toISOString(),
          };
        }
        return p;
      })
    );
  };

  // Add new project from Universal Ingestion
  const handleProjectCreated = (newProject: ScientificProject) => {
    setProjects((prev) => [newProject, ...prev]);
    setActiveProjectId(newProject.id);
    setActiveTab('workspace');
  };

  // Update existing project
  const handleUpdateProject = (updatedProject: ScientificProject) => {
    setProjects((prev) => prev.map((p) => (p.id === updatedProject.id ? updatedProject : p)));
  };

  // Quick forge from historical translator
  const handleForgeProjectFromText = (title: string, text: string, discipline: any, era: string) => {
    const newProj: ScientificProject = {
      id: `proj-transmuted-${Date.now()}`,
      title,
      summary: `Decoded from ${era} into modern empirical material science with non-toxic precursors.`,
      discipline,
      trlLevel: 4,
      overallFeasibilityScore: 89,
      materialReadinessScore: 92,
      regulatoryComplexityScore: 60,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      inputFormat: 'historical-1500s',
      rawInputData: text,
      sourceOrigin: era,
      targetScope: 'personal-maker',
      spaceContext: false,
      modernEquivalentTranslation: {
        archaicOrForeignTermsMapped: [],
        chemicalEquation: 'Modernized Green Stoichiometry',
        stoichiometricSummary: 'Reaction validated for closed-atmosphere benchtop run.',
      },
      materialsCatalog: [
        {
          name: 'High-Purity Inorganic Reagent',
          casNumber: '7757-79-1',
          commercialAvailability: 'Commercial Off-The-Shelf',
          estimatedCostPerUnit: '$18.50 / kg',
          role: 'Primary modern precursor',
          hazards: 'Standard laboratory chemical handling',
        },
      ],
      makerPrototypingPlan: {
        estimatedBudget: '$250 - $600 USD',
        timeToFirstPrototype: '7 Days',
        keyTools: ['Muffle furnace', 'Inert gas purge', 'Borosilicate condenser'],
        diySteps: [
          {
            stepNumber: 1,
            title: 'Precursor Preparation',
            action: 'Weigh modern stoichiometric equivalents under dry atmosphere.',
            safetyWarning: 'Wear eye protection and nitrile gloves.',
          },
        ],
      },
      investorGradePlan: {
        targetTRLMilestone: 'TRL 5',
        estimatedCapex: '$250,000 USD',
        estimatedOpexMonthly: '$15,000 USD',
        unitEconomicsSummary: 'Clean continuous catalytic replacement yields 45% cost reduction.',
        targetAddressableMarket: '$1.4B Green Specialty Chemicals',
        scaleUpRisks: ['Thermal efficiency of induction heating cell'],
      },
      regulatoryComplianceMatrix: [
        {
          body: 'REACH/EPA',
          framework: 'EPA TSCA Section 5',
          status: 'Exempt',
          actionItems: 'Confirm zero toxic effluent gas emission.',
        },
      ],
      spaceExtraterrestrialLogistics: {
        isApplicable: false,
        microgravityBehavior: 'Requires centrifugal separation under 0g.',
        regolithIsruPotential: 'Precursors align with lunar basalt mineral extracts.',
        radiationHardeningNotes: 'N/A',
        cosparPlanetaryProtectionClass: 'Category I',
      },
      milestones: [
        {
          id: `ms-${Date.now()}-1`,
          phase: 'Phase 1: Manuscript Translation & Modernization',
          title: 'Stoichiometry & Reaction Balance Verification',
          duration: 'Weeks 1 - 2',
          deliverables: ['Modernized protocol SOP', 'CAS sourcing sheet'],
          status: 'completed',
        },
      ],
      notes: [],
      customTags: ['Transmuted', 'Historical', 'Green-Chemistry'],
    };

    setProjects((prev) => [newProj, ...prev]);
    setActiveProjectId(newProj.id);
    setActiveTab('workspace');
  };

  // Collect all notes across all projects for the global notes hub
  const allNotes = projects.flatMap((p) => p.notes).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Filter projects for selector
  const filteredProjects = projects.filter((p) => {
    const matchesDiscipline = disciplineFilter === 'all' || p.discipline === disciplineFilter;
    const matchesSearch =
      searchQuery === '' ||
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.summary.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesDiscipline && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* 1. Continuous Active Biometric Security Guard (HUD & 1s Lockdown Overlay) */}
      <BiometricSecurityGuard
        securityState={securityState}
        setSecurityState={setSecurityState}
        projects={projects}
        onAddNote={handleAddNote}
        isLocked={isLocked}
        setIsLocked={setIsLocked}
      />

      {/* 2. Top Application Navigation Bar */}
      <header className="bg-slate-950 border-b border-slate-800/80 sticky top-0 z-20 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo & Platform identity */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-900/30">
              <Atom className="w-6 h-6 text-white animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-base tracking-tight text-white font-mono">
                  OmniSci
                </span>
                <span className="text-slate-500 font-mono text-xs hidden sm:inline">
                  /
                </span>
                <span className="text-xs text-slate-400 font-mono hidden sm:inline">
                  Feasibility &amp; Research Foundry
                </span>
              </div>
            </div>
          </div>

          {/* Center Navigation Tabs */}
          <nav className="flex items-center space-x-1 sm:space-x-2 bg-slate-900/80 p-1 rounded-xl border border-slate-800 text-xs font-mono">
            <button
              onClick={() => setActiveTab('workspace')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                activeTab === 'workspace'
                  ? 'bg-cyan-600 text-white font-semibold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Workflow className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Project Workspace</span>
              <span className="sm:hidden">Workspace</span>
            </button>

            <button
              onClick={() => setActiveTab('ingestion')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                activeTab === 'ingestion'
                  ? 'bg-cyan-600 text-white font-semibold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Ingest &amp; Forge</span>
              <span className="sm:hidden">Ingest</span>
            </button>

            <button
              onClick={() => setActiveTab('notes-tools')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                activeTab === 'notes-tools'
                  ? 'bg-cyan-600 text-white font-semibold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Mic className="w-3.5 h-3.5 text-rose-400" />
              <span className="hidden sm:inline">Notes &amp; Polyglot</span>
              <span className="sm:hidden">Notes</span>
            </button>
          </nav>

          {/* Right: Quick Project Selector Dropdown */}
          <div className="relative">
            <select
              value={activeProjectId}
              onChange={(e) => {
                setActiveProjectId(e.target.value);
                setActiveTab('workspace');
              }}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-cyan-300 font-mono font-medium focus:outline-none focus:border-cyan-500 max-w-[190px] sm:max-w-[260px] truncate"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <BillingPanel />

        {/* Project Switcher Shelf (visible in workspace mode) */}
        {activeTab === 'workspace' && (
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center space-x-2">
              <span className="font-mono text-slate-400">Active Foundry Blueprints:</span>
              <div className="flex flex-wrap gap-1.5">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setActiveProjectId(p.id)}
                    className={`px-3 py-1 rounded-lg text-xs font-mono transition flex items-center gap-1.5 border ${
                      p.id === activeProjectId
                        ? 'bg-cyan-950 text-cyan-300 border-cyan-700 font-semibold shadow'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {p.spaceContext && <Rocket className="w-3 h-3 text-indigo-400" />}
                    <span>{p.title.length > 22 ? p.title.substring(0, 22) + '...' : p.title}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setActiveTab('ingestion')}
              className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-mono text-xs flex items-center gap-1 transition"
            >
              <PlusCircle className="w-3 h-3" /> Forge New Project
            </button>
          </div>
        )}

        {/* TAB 1: MODULAR PROJECT WORKSPACE */}
        {activeTab === 'workspace' && activeProject && (
          <ProjectWorkspace
            project={activeProject}
            onUpdateProject={handleUpdateProject}
            onAddNote={handleAddNote}
          />
        )}

        {/* TAB 2: UNIVERSAL DATA INGESTION & FEASIBILITY ENGINE */}
        {activeTab === 'ingestion' && (
          <UniversalIngestionHub
            onProjectCreated={handleProjectCreated}
            activeProjectCount={projects.length}
          />
        )}

        {/* TAB 3: NOTES & POLYGLOT 1500s HISTORICAL TRANSLATOR */}
        {activeTab === 'notes-tools' && (
          <NotesAndToolsHub
            projects={projects}
            allNotes={allNotes}
            onAddNote={handleAddNote}
            onForgeProjectFromText={handleForgeProjectFromText}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-slate-950 border-t border-slate-900 py-4 text-center text-xs font-mono text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <span className="text-cyan-400 font-semibold">OmniSci Foundry</span>
            <span>•</span>
            <span>Material Science &amp; Extraterrestrial Feasibility Engine</span>
          </div>
          <div className="flex items-center space-x-3 text-[11px]">
            <span>Security: 1.0s Continuous Biometric Eye Guard</span>
            <span>•</span>
            <span>Regulatory: FDA / EMA / ISO 13485 / COSPAR IVb</span>
          </div>
          <nav aria-label="Legal pages" className="flex flex-wrap items-center justify-center gap-3 text-[11px]">
            <a href="/terms" className="hover:text-cyan-300">Terms</a>
            <a href="/privacy" className="hover:text-cyan-300">Privacy</a>
            <a href="/refunds" className="hover:text-cyan-300">Refunds &amp; Cancellation</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
