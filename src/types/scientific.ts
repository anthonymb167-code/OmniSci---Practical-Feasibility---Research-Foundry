export type ScientificDiscipline =
  | 'Sustainable Cleantech & Geopolymers'
  | 'Biomedical & Tissue Engineering'
  | 'Pharmaceuticals & Molecular Docking'
  | 'Space Exploration & Extraterrestrial Logistics'
  | 'Quantum & Advanced Materials'
  | 'Synthetic Biology & Metabolic Pathways'
  | 'Chemical Engineering & Catalysis'
  | 'Historical Alchemy Modernization'
  | 'Emergent Future Discipline';

export type CommercialAvailability =
  | 'Commercial Off-The-Shelf'
  | 'Specialty Synthesis'
  | 'Industrial Bulk'
  | 'Research Prototype';

export interface MaterialItem {
  name: string;
  casNumber: string;
  commercialAvailability: CommercialAvailability;
  estimatedCostPerUnit: string;
  role: string;
  hazards: string;
}

export interface ArchaicTermMapping {
  originalTerm: string;
  modernTerm: string;
  notes: string;
}

export interface ModernEquivalentTranslation {
  archaicOrForeignTermsMapped: ArchaicTermMapping[];
  chemicalEquation: string;
  stoichiometricSummary: string;
}

export interface MakerDiyStep {
  stepNumber: number;
  title: string;
  action: string;
  safetyWarning: string;
}

export interface MakerPrototypingPlan {
  estimatedBudget: string;
  timeToFirstPrototype: string;
  keyTools: string[];
  diySteps: MakerDiyStep[];
}

export interface InvestorGradePlan {
  targetTRLMilestone: string;
  estimatedCapex: string;
  estimatedOpexMonthly: string;
  unitEconomicsSummary: string;
  targetAddressableMarket: string;
  scaleUpRisks: string[];
}

export interface RegulatoryComplianceItem {
  body: 'FDA' | 'EMA' | 'ISO' | 'REACH/EPA' | 'COSPAR/NASA';
  framework: string;
  status: 'Exempt' | 'Required Prior to Clinical/Pilot' | 'High Barrier Review' | 'Standard Certification';
  actionItems: string;
}

export interface SpaceExtraterrestrialLogistics {
  isApplicable: boolean;
  microgravityBehavior: string;
  regolithIsruPotential: string;
  radiationHardeningNotes: string;
  cosparPlanetaryProtectionClass: string;
}

export interface ProjectMilestone {
  id: string;
  phase: string;
  title: string;
  duration: string;
  deliverables: string[];
  status: 'planned' | 'in_progress' | 'completed';
}

export interface ScientificNote {
  id: string;
  projectId: string;
  milestoneId?: string;
  title: string;
  content: string;
  type: 'written' | 'audio';
  audioBlobUrl?: string;
  audioDuration?: number;
  createdAt: string;
  extractedParameters?: Array<{
    parameter: string;
    value: string;
    significance: string;
  }>;
  complianceImpact?: string;
  tags: string[];
}

export interface ScientificProject {
  id: string;
  title: string;
  summary: string;
  discipline: ScientificDiscipline;
  trlLevel: number; // 1 to 9
  overallFeasibilityScore: number; // 1 to 100
  materialReadinessScore: number; // 1 to 100
  regulatoryComplexityScore: number; // 1 to 100
  createdAt: string;
  updatedAt: string;
  inputFormat: 'text' | 'graph-stats' | 'chemical' | 'historical-1500s' | 'polyglot';
  rawInputData: string;
  chemicalFormula?: string;
  sourceOrigin: string;
  targetScope: 'personal-maker' | 'investor-grade' | 'dual';
  spaceContext: boolean;
  modernEquivalentTranslation: ModernEquivalentTranslation;
  materialsCatalog: MaterialItem[];
  makerPrototypingPlan: MakerPrototypingPlan;
  investorGradePlan: InvestorGradePlan;
  regulatoryComplianceMatrix: RegulatoryComplianceItem[];
  spaceExtraterrestrialLogistics: SpaceExtraterrestrialLogistics;
  milestones: ProjectMilestone[];
  notes: ScientificNote[];
  customTags: string[];
}

export interface BiometricSecurityAudit {
  timestamp: string;
  event: string;
  status: 'verified' | 'absence_detected' | 'paused' | 'resumed';
}

export interface BiometricSecurityState {
  isArmed: boolean;
  isPresent: boolean;
  absenceDurationSeconds: number;
  pausedReason: string;
  mode: 'webcam' | 'simulated';
  sensitivity: number; // 1 to 10
  faceConfidence: number; // 0 to 100
  emergencyNoteAllowed: boolean;
  auditLog: BiometricSecurityAudit[];
}
