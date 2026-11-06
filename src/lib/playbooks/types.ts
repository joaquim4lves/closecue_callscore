export type PlaybookStatus = "draft" | "active" | "archived";

export type Phase = {
  id: string;
  sortOrder: number;
  name: string;
  triggerText: string;
  script: string;
  checklistItems: string[];
};

export type Objection = {
  id: string;
  sortOrder: number;
  label: string;
  signals: string[];
  suggestedResponse: string;
};

export type PlaybookSummary = {
  id: string;
  orgId: string;
  name: string;
  version: number;
  status: PlaybookStatus;
  createdBy: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlaybookDetail = PlaybookSummary & {
  phases: Phase[];
  objections: Objection[];
};

export type PlaybookListResponse = {
  playbooks: PlaybookSummary[];
  activePlaybookId: string | null;
  noneActive: { copyKey: "playbook.none_active"; copy: string } | null;
};
