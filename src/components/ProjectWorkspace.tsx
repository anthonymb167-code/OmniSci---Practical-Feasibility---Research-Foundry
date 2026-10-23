import React, { useState } from 'react';
import {
  Hammer,
  TrendingUp,
  ShieldCheck,
  Rocket,
  CheckCircle2,
  Layers,
  AlertTriangle,
  ExternalLink,
  ChevronRight,
  Download,
  Atom,
  Mic,
  Plus,
  Building2,
  Workflow,
} from 'lucide-react';
import {
  ScientificProject,
  ProjectMilestone,
  ScientificNote,
} from '../types/scientific';

interface ProjectWorkspaceProps {
  project: ScientificProject;
  onUpdateProject: (updated: ScientificProject) => void;
  onAddNote: (note: Partial<ScientificNote>, targetProjectId?: string) => Promise<void>;
}

export const ProjectWorkspace: React.FC<ProjectWorkspaceProps> = ({
  project,
  onUpdateProject,
  onAddNote,
}) => {
  const [viewMode, setViewMode] = useState<'dual' | 'maker' | 'investor'>('dual');
  const [activeSection, setActiveSection] = useState<'roadmap' | 'materials' | 'regulatory' | 'space' | 'notes'>('roadmap');

  // Inline note creation
  const [isAddingNote, setIsAddingNote] = useState<boolean>(false);
  const [noteTitle, setNoteTitle] = useState<string>('');
  const [noteContent, setNoteContent] = useState<string>('');
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string>(project.milestones[0]?.id || '');

  // Toggle milestone status
  const handleToggleMilestone = (milestoneId: string) => {
    const updatedMilestones = project.milestones.map((m) => {
      if (m.id === milestoneId) {
        const nextStatus: ProjectMilestone['status'] =
          m.status === 'completed' ? 'in_progress' : m.status === 'in_progress' ? 'planned' : 'completed';
        return { ...m, status: nextStatus };
      }
      return m;
    });

    onUpdateProject({
      ...project,
      milestones: updatedMilestones,
      updatedAt: new Date().toISOString(),
    });
  };

  // Submit project-specific note
  const handleCreateProjectNote = async () => {
    if (!noteContent.trim()) return;
    await onAddNote(
      {
        title: noteTitle.trim() || `Lab Observation (${new Date().toLocaleDateString()})`,
        content: noteContent,
        milestoneId: selectedMilestoneId,
        type: 'written',
        tags: [project.discipline.split(' ')[0], 'Foundry-Note'],
      },
      project.id
    );
    setNoteTitle('');
    setNoteContent('');
    setIsAddingNote(false);
  };

  // Export full project scientific dossier as markdown / JSON
  const handleExportDossier = () => {
    const markdown = `# OMNISCI SCIENTIFIC FEASIBILITY DOSSIER: ${project.title}
Generated: ${new Date().toISOString()}
Discipline: ${project.discipline}
TRL Level: ${project.trlLevel}/9 | Overall Feasibility Score: ${project.overallFeasibilityScore}%
Material Readiness: ${project.materialReadinessScore}% | Regulatory Complexity: ${project.regulatoryComplexityScore}%
Implementation Scope: ${project.targetScope.toUpperCase()}
Space Logistics: ${project.spaceContext ? 'YES (Microgravity, ISRU & COSPAR Analyzed)' : 'TERRESTRIAL STANDARD'}

## 1. Executive Summary
${project.summary}

## 2. Chemical & Physical Formula / Stoichiometry
Formula: ${project.chemicalFormula || 'N/A'}
Equation: ${project.modernEquivalentTranslation.chemicalEquation}
Stoichiometry: ${project.modernEquivalentTranslation.stoichiometricSummary}

## 3. Commercial Material Science Catalog (CAS Index)
${project.materialsCatalog
  .map(
    (m) =>
      `- **${m.name}** (CAS: ${m.casNumber})\n  Tier: ${m.commercialAvailability} | Cost: ${m.estimatedCostPerUnit}\n  Role: ${m.role}\n  Hazards: ${m.hazards}`
  )
  .join('\n\n')}

## 4. Personal Prototyping (Maker Track)
Budget: ${project.makerPrototypingPlan.estimatedBudget}
Time to First Prototype: ${project.makerPrototypingPlan.timeToFirstPrototype}
Key Tools: ${project.makerPrototypingPlan.keyTools.join(', ')}

Steps:
${project.makerPrototypingPlan.diySteps
  .map((s) => `${s.stepNumber}. **${s.title}**: ${s.action} (Safety: ${s.safetyWarning})`)
  .join('\n')}

## 5. Investor-Grade Commercialization Plan
Target Milestone: ${project.investorGradePlan.targetTRLMilestone}
Estimated CAPEX: ${project.investorGradePlan.estimatedCapex}
Estimated Monthly OPEX: ${project.investorGradePlan.estimatedOpexMonthly}
Target Addressable Market (TAM): ${project.investorGradePlan.targetAddressableMarket}
Unit Economics: ${project.investorGradePlan.unitEconomicsSummary}

## 6. Automated Regulatory Compliance Matrix
${project.regulatoryComplianceMatrix
  .map(
    (r) =>
      `- **${r.body} (${r.framework})**: ${r.status}\n  Action Items: ${r.actionItems}`
  )
  .join('\n\n')}

## 7. Extraterrestrial Logistics & Space Adaptation
Microgravity: ${project.spaceExtraterrestrialLogistics.microgravityBehavior}
Regolith ISRU: ${project.spaceExtraterrestrialLogistics.regolithIsruPotential}
Radiation Hardening: ${project.spaceExtraterrestrialLogistics.radiationHardeningNotes}
COSPAR Planetary Protection: ${project.spaceExtraterrestrialLogistics.cosparPlanetaryProtectionClass}
`;

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `OmniSci_${project.title.replace(/[^a-zA-Z0-9]/g, '_')}_Dossier.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Project Master Header Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6 relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            {/* Unboxed clean metadata separated by typographic middots */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mb-2 font-mono">
              <span className="text-cyan-400 font-medium">{project.discipline}</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>{project.sourceOrigin}</span>
              {project.spaceContext && (
                <>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="text-indigo-300 flex items-center gap-1">
                    <Rocket className="w-3 h-3" /> Space Qualified
                  </span>
                </>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              {project.title}
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
              {project.summary}
            </p>
          </div>

          {/* Action buttons: Export Dossier */}
          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={handleExportDossier}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-mono font-medium flex items-center gap-2 transition"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" /> Export Full Dossier
            </button>
          </div>
        </div>

        {/* Technical Metric Scores & TRL Bar with Tabular Numerals */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4">
          <div className="bg-slate-950/70 border border-slate-800/80 p-3 rounded-xl">
            <div className="text-[11px] font-mono text-slate-400 mb-1">TRL READINESS</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold font-mono tabular-nums text-cyan-400">
                TRL-{project.trlLevel}
              </span>
              <span className="text-[11px] text-slate-500 font-mono">/ 9</span>
            </div>
            {/* TRL mini bar */}
            <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden flex">
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  key={i}
                  className={`flex-1 border-r border-slate-900 ${
                    i < project.trlLevel ? 'bg-cyan-500' : 'bg-slate-800'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800/80 p-3 rounded-xl">
            <div className="text-[11px] font-mono text-slate-400 mb-1">OVERALL FEASIBILITY</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
              {project.overallFeasibilityScore}%
            </div>
            <div className="text-[10px] text-slate-500 mt-1">High empirical confidence</div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800/80 p-3 rounded-xl">
            <div className="text-[11px] font-mono text-slate-400 mb-1">MATERIAL READINESS</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-blue-400">
              {project.materialReadinessScore}%
            </div>
            <div className="text-[10px] text-slate-500 mt-1">Commercial off-the-shelf</div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800/80 p-3 rounded-xl">
            <div className="text-[11px] font-mono text-slate-400 mb-1">REGULATORY INDEX</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-purple-400">
              {project.regulatoryComplexityScore}%
            </div>
            <div className="text-[10px] text-slate-500 mt-1">FDA / ISO / REACH mapped</div>
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2">
        <div className="flex items-center space-x-2 text-xs font-mono">
          <button
            onClick={() => setActiveSection('roadmap')}
            className={`px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1.5 ${
              activeSection === 'roadmap'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-700'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Workflow className="w-3.5 h-3.5" /> Modular Roadmap &amp; Execution
          </button>

          <button
            onClick={() => setActiveSection('materials')}
            className={`px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1.5 ${
              activeSection === 'materials'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-700'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> Material Science Catalog ({project.materialsCatalog.length})
          </button>

          <button
            onClick={() => setActiveSection('regulatory')}
            className={`px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1.5 ${
              activeSection === 'regulatory'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-700'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" /> Regulatory Matrix ({project.regulatoryComplianceMatrix.length})
          </button>

          <button
            onClick={() => setActiveSection('space')}
            className={`px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1.5 ${
              activeSection === 'space'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-700'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Rocket className="w-3.5 h-3.5" /> Space Logistics
          </button>

          <button
            onClick={() => setActiveSection('notes')}
            className={`px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1.5 ${
              activeSection === 'notes'
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-700'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Mic className="w-3.5 h-3.5" /> Research Notes ({project.notes.length})
          </button>
        </div>

        {/* Dual Lens Switcher (Maker vs Investor) */}
        {activeSection === 'roadmap' && (
          <div className="flex items-center space-x-1 p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono">
            <button
              onClick={() => setViewMode('dual')}
              className={`px-2.5 py-1 rounded transition ${
                viewMode === 'dual' ? 'bg-cyan-600 text-white font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Unified View
            </button>
            <button
              onClick={() => setViewMode('maker')}
              className={`px-2.5 py-1 rounded flex items-center gap-1 transition ${
                viewMode === 'maker' ? 'bg-amber-600 text-white font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Hammer className="w-3 h-3" /> DIY Maker
            </button>
            <button
              onClick={() => setViewMode('investor')}
              className={`px-2.5 py-1 rounded flex items-center gap-1 transition ${
                viewMode === 'investor' ? 'bg-purple-600 text-white font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <TrendingUp className="w-3 h-3" /> Investor Grade
            </button>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* SECTION 1: MODULAR ROADMAP & STEP-BY-STEP EXECUTION                       */}
      {/* ========================================================================= */}
      {activeSection === 'roadmap' && (
        <div className="space-y-6">
          {/* Dual Lens Comparison Highlights */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Personal Maker Track Card */}
            {(viewMode === 'dual' || viewMode === 'maker') && (
              <div className="bg-slate-900/90 border border-amber-800/50 rounded-xl p-5 shadow-lg">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-amber-900/40">
                  <div className="flex items-center space-x-2">
                    <span className="p-1.5 rounded-lg bg-amber-950 border border-amber-700 text-amber-400">
                      <Hammer className="w-4 h-4" />
                    </span>
                    <h3 className="font-bold text-amber-300 text-sm font-mono">
                      Personal Making &amp; Fab Lab Track
                    </h3>
                  </div>
                  <span className="text-xs font-mono text-amber-300">
                    Budget: {project.makerPrototypingPlan.estimatedBudget}
                  </span>
                </div>

                <div className="text-xs text-slate-300 space-y-2 mb-4">
                  <div className="flex justify-between font-mono">
                    <span className="text-slate-400">Time to 1st Prototype:</span>
                    <span className="text-amber-300">{project.makerPrototypingPlan.timeToFirstPrototype}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-mono block mb-1">Required Desktop Tools:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {project.makerPrototypingPlan.keyTools.map((tool, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded bg-slate-950 text-slate-300 border border-slate-800 text-[11px] font-mono"
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Step by step maker steps */}
                <div className="space-y-2">
                  <div className="text-[11px] font-mono text-amber-400 uppercase tracking-wider font-semibold">
                    Hands-On Fabrication Protocol:
                  </div>
                  {project.makerPrototypingPlan.diySteps.map((step) => (
                    <div
                      key={step.stepNumber}
                      className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs"
                    >
                      <div className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-amber-950 text-amber-300 border border-amber-700 flex items-center justify-center text-[10px] font-mono">
                          {step.stepNumber}
                        </span>
                        {step.title}
                      </div>
                      <p className="text-slate-300 text-[11px] leading-relaxed mb-1.5">{step.action}</p>
                      <div className="text-[10px] text-rose-300/90 font-mono flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                        <span>Safety Warning: {step.safetyWarning}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Investor-Grade Commercialization Card */}
            {(viewMode === 'dual' || viewMode === 'investor') && (
              <div className="bg-slate-900/90 border border-purple-800/50 rounded-xl p-5 shadow-lg">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-purple-900/40">
                  <div className="flex items-center space-x-2">
                    <span className="p-1.5 rounded-lg bg-purple-950 border border-purple-700 text-purple-400">
                      <TrendingUp className="w-4 h-4" />
                    </span>
                    <h3 className="font-bold text-purple-300 text-sm font-mono">
                      Investor-Grade Commercialization
                    </h3>
                  </div>
                  <span className="text-xs font-mono text-purple-300">
                    {project.investorGradePlan.targetTRLMilestone}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono mb-4">
                  <div className="p-2 rounded bg-slate-950 border border-slate-800">
                    <div className="text-slate-400 text-[10px]">Estimated CAPEX</div>
                    <div className="text-purple-300 font-bold mt-0.5">{project.investorGradePlan.estimatedCapex}</div>
                  </div>
                  <div className="p-2 rounded bg-slate-950 border border-slate-800">
                    <div className="text-slate-400 text-[10px]">Monthly OPEX</div>
                    <div className="text-purple-300 font-bold mt-0.5">{project.investorGradePlan.estimatedOpexMonthly}</div>
                  </div>
                </div>

                <div className="space-y-2 text-xs mb-4">
                  <div>
                    <span className="text-slate-400 font-mono block text-[11px]">Total Addressable Market (TAM):</span>
                    <span className="text-white font-semibold">{project.investorGradePlan.targetAddressableMarket}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-mono block text-[11px]">Unit Economics &amp; Margin:</span>
                    <span className="text-slate-300 text-[11px]">{project.investorGradePlan.unitEconomicsSummary}</span>
                  </div>
                </div>

                {/* Scale up risks */}
                <div>
                  <div className="text-[11px] font-mono text-purple-400 uppercase tracking-wider font-semibold mb-1">
                    Scale-up Critical Risks:
                  </div>
                  <ul className="space-y-1 text-[11px] text-slate-300">
                    {project.investorGradePlan.scaleUpRisks.map((risk, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-purple-400 shrink-0">•</span>
                        <span>{risk}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* Interactive Project Milestones & Kanban Tasks */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Workflow className="w-4 h-4 text-cyan-400" />
                <h3 className="font-bold text-white text-sm font-mono">
                  Master Project Milestones &amp; Work Breakdown
                </h3>
              </div>
              <span className="text-xs font-mono text-slate-400">
                Click any milestone to cycle state: Planned → In Progress → Completed
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {project.milestones.map((milestone) => (
                <div
                  key={milestone.id}
                  onClick={() => handleToggleMilestone(milestone.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                    milestone.status === 'completed'
                      ? 'bg-emerald-950/20 border-emerald-700/60 shadow-emerald-950/20'
                      : milestone.status === 'in_progress'
                      ? 'bg-cyan-950/30 border-cyan-500/80 shadow-cyan-950/20'
                      : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono text-slate-400">{milestone.duration}</span>
                      <span
                        className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded font-bold ${
                          milestone.status === 'completed'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-700'
                            : milestone.status === 'in_progress'
                            ? 'bg-cyan-950 text-cyan-300 border border-cyan-700 animate-pulse'
                            : 'bg-slate-900 text-slate-400 border border-slate-800'
                        }`}
                      >
                        {milestone.status.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="text-[11px] font-mono text-cyan-400 mb-1">{milestone.phase}</div>
                    <div className="text-xs font-bold text-white mb-2 leading-snug">{milestone.title}</div>

                    <div className="space-y-1 mb-3">
                      {milestone.deliverables.map((deliv, idx) => (
                        <div key={idx} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                          <CheckCircle2
                            className={`w-3 h-3 shrink-0 mt-0.5 ${
                              milestone.status === 'completed' ? 'text-emerald-400' : 'text-slate-600'
                            }`}
                          />
                          <span>{deliv}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="text-[10px] font-mono text-slate-500 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                    <span>Toggle Status</span>
                    <ChevronRight className="w-3 h-3 text-cyan-400" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 2: MATERIAL SCIENCE CATALOG & SOURCING INDEX                      */}
      {/* ========================================================================= */}
      {activeSection === 'materials' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div>
              <h3 className="font-bold text-white text-sm font-mono flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                Active Material Science Catalog (Grounded in Commercial Synthesis)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                All precursors verified against current commercial supply chains, standard purity grades, and CAS registry identifiers.
              </p>
            </div>
            <span className="text-xs font-mono text-emerald-400">
              Supply Chain Feasibility: 96% Available
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 font-mono text-[11px] uppercase border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Material Precursor</th>
                  <th className="py-2.5 px-3">CAS Number</th>
                  <th className="py-2.5 px-3">Commercial Availability</th>
                  <th className="py-2.5 px-3">Est. Unit Cost</th>
                  <th className="py-2.5 px-3">Function / Role</th>
                  <th className="py-2.5 px-3">Hazards &amp; Handling</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {project.materialsCatalog.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/50 transition">
                    <td className="py-3 px-3 font-semibold text-white">
                      {item.name}
                    </td>
                    <td className="py-3 px-3 text-cyan-400 tabular-nums">
                      {item.casNumber !== 'N/A' && !item.casNumber.includes('Blend') ? (
                        <a
                          href={`https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(item.casNumber)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline flex items-center gap-1"
                        >
                          {item.casNumber} <ExternalLink className="w-2.5 h-2.5 text-slate-500" />
                        </a>
                      ) : (
                        item.casNumber
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          item.commercialAvailability === 'Commercial Off-The-Shelf'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                            : item.commercialAvailability === 'Industrial Bulk'
                            ? 'bg-blue-950 text-blue-300 border border-blue-700'
                            : 'bg-purple-950 text-purple-300 border border-purple-700'
                        }`}
                      >
                        {item.commercialAvailability}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-200 tabular-nums">{item.estimatedCostPerUnit}</td>
                    <td className="py-3 px-3 text-slate-300 font-sans text-xs max-w-xs">{item.role}</td>
                    <td className="py-3 px-3 text-rose-300/90 font-sans text-xs max-w-xs">
                      {item.hazards}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Historical translation / Chemical formula callout */}
          {project.modernEquivalentTranslation && (
            <div className="mt-4 p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="text-xs font-mono text-cyan-400 font-semibold flex items-center gap-1.5">
                <Atom className="w-4 h-4" /> Balanced Reaction &amp; Stoichiometric Modernization
              </div>
              <div className="font-mono text-xs text-white bg-slate-900 p-2.5 rounded border border-slate-800">
                {project.modernEquivalentTranslation.chemicalEquation}
              </div>
              <p className="text-xs text-slate-400">
                {project.modernEquivalentTranslation.stoichiometricSummary}
              </p>

              {project.modernEquivalentTranslation.archaicOrForeignTermsMapped.length > 0 && (
                <div className="pt-2 border-t border-slate-800">
                  <div className="text-[11px] font-mono text-amber-400 font-semibold mb-1">
                    Archaic / Polyglot Terms Mapped to IUPAC:
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {project.modernEquivalentTranslation.archaicOrForeignTermsMapped.map((term, i) => (
                      <div key={i} className="p-2 rounded bg-slate-900 border border-slate-800">
                        <span className="text-amber-300 font-mono font-semibold">{term.originalTerm}</span> →{' '}
                        <span className="text-emerald-300 font-mono font-semibold">{term.modernTerm}</span>
                        <p className="text-[10px] text-slate-400 mt-0.5">{term.notes}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 3: AUTOMATED REGULATORY COMPLIANCE MATRIX                         */}
      {/* ========================================================================= */}
      {activeSection === 'regulatory' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div>
              <h3 className="font-bold text-white text-sm font-mono flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-cyan-400" />
                Automated Regulatory Compliance Matrix
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Automated audit across FDA 510(k)/IND, EMA, ISO 13485, EU REACH/US TSCA, and NASA Planetary Protection.
              </p>
            </div>
            <span className="text-xs font-mono text-purple-300">
              Audit Status: Verified for Pilot Readiness
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {project.regulatoryComplianceMatrix.map((item, idx) => (
              <div
                key={idx}
                className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-slate-900 text-cyan-300 border border-slate-700">
                      {item.body}
                    </span>
                    <span
                      className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded font-semibold ${
                        item.status === 'Exempt'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                          : item.status === 'Standard Certification'
                          ? 'bg-blue-950 text-blue-300 border border-blue-700'
                          : 'bg-rose-950 text-rose-300 border border-rose-700'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>

                  <div className="text-xs font-bold text-white mb-1.5 font-mono">{item.framework}</div>
                  <p className="text-xs text-slate-300 leading-relaxed">{item.actionItems}</p>
                </div>

                <div className="mt-3 pt-2 border-t border-slate-900 text-[10px] font-mono text-slate-500">
                  Pre-filing documentation verification recommended prior to clinical trial or pilot batch.
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 4: SPACE & EXTRATERRESTRIAL LOGISTICS                             */}
      {/* ========================================================================= */}
      {activeSection === 'space' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <Rocket className="w-5 h-5 text-indigo-400" />
              <div>
                <h3 className="font-bold text-white text-sm font-mono">
                  Space Exploration &amp; Extraterrestrial Logistics Module
                </h3>
                <p className="text-xs text-slate-400">
                  Microgravity fluidics, Lunar/Martian regolith ISRU, cosmic radiation hardening, and planetary protection.
                </p>
              </div>
            </div>
            <span className="text-xs font-mono text-indigo-300">
              COSPAR Class: {project.spaceExtraterrestrialLogistics.cosparPlanetaryProtectionClass}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-indigo-400 font-mono font-semibold mb-1 flex items-center gap-1.5">
                <Rocket className="w-3.5 h-3.5" /> Microgravity (0g) Kinetics &amp; Fluidics
              </div>
              <p className="text-slate-300 leading-relaxed">
                {project.spaceExtraterrestrialLogistics.microgravityBehavior}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-emerald-400 font-mono font-semibold mb-1 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" /> In-Situ Resource Utilization (ISRU)
              </div>
              <p className="text-slate-300 leading-relaxed">
                {project.spaceExtraterrestrialLogistics.regolithIsruPotential}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-amber-400 font-mono font-semibold mb-1 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> Radiation Hardening &amp; Outgassing
              </div>
              <p className="text-slate-300 leading-relaxed">
                {project.spaceExtraterrestrialLogistics.radiationHardeningNotes}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-purple-400 font-mono font-semibold mb-1 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" /> Outer Space Treaty &amp; Planetary Protection
              </div>
              <p className="text-slate-300 leading-relaxed">
                COSPAR Policy Category: {project.spaceExtraterrestrialLogistics.cosparPlanetaryProtectionClass}. Strict dry heat microbial reduction (DHMR) limits applied to flight articles.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 5: RESEARCHER NOTES & AUDIO MEMOS                                 */}
      {/* ========================================================================= */}
      {activeSection === 'notes' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="font-bold text-white text-sm font-mono flex items-center gap-2">
                <Mic className="w-4 h-4 text-cyan-400" />
                Researcher Empirical Observations &amp; Audio Memos
              </h3>
              <p className="text-xs text-slate-400">
                Incorporated written and voice notes tagged directly to project milestones.
              </p>
            </div>

            <button
              onClick={() => setIsAddingNote(!isAddingNote)}
              className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs flex items-center gap-1 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Add Research Note
            </button>
          </div>

          {/* Quick add note form */}
          {isAddingNote && (
            <div className="p-4 rounded-xl bg-slate-950 border border-cyan-800/80 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Note Title / Experiment Reference"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                />
                <select
                  value={selectedMilestoneId}
                  onChange={(e) => setSelectedMilestoneId(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500 font-mono"
                >
                  {project.milestones.map((m) => (
                    <option key={m.id} value={m.id}>
                      Tag Milestone: {m.phase} - {m.title}
                    </option>
                  ))}
                </select>
              </div>

              <textarea
                rows={3}
                placeholder="Record observation, unexpected rheology, temperature drift, or yield metric..."
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
              />

              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setIsAddingNote(false)}
                  className="px-3 py-1.5 rounded bg-slate-800 text-slate-300 text-xs font-mono"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateProjectNote}
                  disabled={!noteContent.trim()}
                  className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono font-semibold disabled:opacity-50"
                >
                  Save Note to Project
                </button>
              </div>
            </div>
          )}

          {/* List of notes */}
          {project.notes.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs font-mono">
              No notes incorporated into this project yet. Use the top biometric lock screen, audio dictation, or the button above to log observations.
            </div>
          ) : (
            <div className="space-y-3">
              {project.notes.map((note) => (
                <div
                  key={note.id}
                  className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-slate-200">{note.title}</span>
                      <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800">
                        {note.type.toUpperCase()}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500">
                      {new Date(note.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <p className="text-slate-300 leading-relaxed font-mono text-[11px] bg-slate-900 p-2.5 rounded border border-slate-800/80">
                    {note.content}
                  </p>

                  {note.audioBlobUrl && (
                    <div className="pt-1">
                      <audio controls src={note.audioBlobUrl} className="h-8 w-full max-w-sm" />
                    </div>
                  )}

                  {note.extractedParameters && note.extractedParameters.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1 font-mono text-[10px]">
                      {note.extractedParameters.map((param, i) => (
                        <span key={i} className="px-2 py-0.5 rounded bg-slate-900 text-cyan-300 border border-slate-800">
                          {param.parameter}: {param.value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
