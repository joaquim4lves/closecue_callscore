import { getActivePlaybook } from "./service";
import type { PlaybookDetail } from "./types";

/**
 * CallScore (fatia 3) must load the playbook through this function.
 * Drafts and archived versions are never score input — only status=active.
 */
export async function getPlaybookForScoring(orgId: string): Promise<PlaybookDetail | null> {
  const playbook = await getActivePlaybook(orgId);
  if (!playbook || playbook.status !== "active") return null;
  return playbook;
}
