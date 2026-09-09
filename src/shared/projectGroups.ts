import type { Project, ProjectGroup } from './types/project';

export type { ProjectGroup };

export const ALL_GROUP_ID = '__all__';
export const UNGROUPED_GROUP_ID = '__ungrouped__';

export type GroupSelection = typeof ALL_GROUP_ID | typeof UNGROUPED_GROUP_ID | string;

export interface GroupSection<T extends Project = Project> {
  groupId: string;
  group?: ProjectGroup;
  projects: T[];
}

function knownGroupIds(groups: readonly ProjectGroup[]): Set<string> {
  return new Set(groups.map((group) => group.id));
}

function isArchived(id: string, archivedIds: readonly string[]): boolean {
  return archivedIds.includes(id);
}

export function isUngroupedProject(project: Project, groups: readonly ProjectGroup[]): boolean {
  const groupId = project.groupId;
  return !groupId || !knownGroupIds(groups).has(groupId);
}

export function filterProjectsByGroup<T extends Project>(
  projects: readonly T[],
  groups: readonly ProjectGroup[],
  archivedIds: readonly string[],
  selected: GroupSelection
): T[] {
  const active = projects.filter((project) => !isArchived(project.id, archivedIds));
  if (selected === ALL_GROUP_ID) return active;
  if (selected === UNGROUPED_GROUP_ID) {
    return active.filter((project) => isUngroupedProject(project, groups));
  }
  return active.filter((project) => project.groupId === selected);
}

export function sectionsForAllView<T extends Project>(
  projects: readonly T[],
  groups: readonly ProjectGroup[],
  archivedIds: readonly string[]
): GroupSection<T>[] {
  const active = projects.filter((project) => !isArchived(project.id, archivedIds));
  const ordered = [...groups].sort((a, b) => a.order - b.order);
  const known = knownGroupIds(groups);
  const sections: GroupSection<T>[] = ordered.map((group) => ({
    groupId: group.id,
    group,
    projects: active.filter((project) => project.groupId === group.id),
  }));
  const ungrouped = active.filter((project) => !project.groupId || !known.has(project.groupId));
  if (ungrouped.length > 0) {
    sections.push({ groupId: UNGROUPED_GROUP_ID, projects: ungrouped });
  }
  return sections;
}

export type ProjectGroupPatch = {
  name?: string;
  emoji?: string;
  color?: string;
};

/** 编辑器会把「取消颜色」写成 color: undefined；不能当成「不改这个字段」。 */
export function applyProjectGroupPatch(
  group: ProjectGroup,
  patch: ProjectGroupPatch
): ProjectGroup {
  const next: ProjectGroup = {
    ...group,
    ...(patch.name !== undefined ? { name: patch.name.trim() || group.name } : {}),
  };
  if ('emoji' in patch) {
    if (patch.emoji) next.emoji = patch.emoji;
    else delete next.emoji;
  }
  if ('color' in patch) {
    if (patch.color) next.color = patch.color;
    else delete next.color;
  }
  return next;
}
