import { computed, ref, type Ref } from 'vue';
import type { Run, Project } from '@bridgemind/shared';
import { api } from '../api/client';
import { DEFAULT_PROJECT_PATH } from '../lib/format';

/**
 * Owns the project list, the active project selection and the add/remove
 * project flow. Run counts are derived from the passed-in runs ref.
 */
export function useProjects(runs: Ref<Run[]>) {
  const projects = ref<Project[]>([]);
  const activeProjectPath = ref(DEFAULT_PROJECT_PATH);

  const showAddProjectModal = ref(false);
  const newProjectName = ref('');
  const newProjectPath = ref('');
  const isSubmittingProject = ref(false);

  const projectOptions = computed(() => {
    return projects.value
      .map(p => ({
        path: p.path,
        name: p.name,
        count: runs.value.filter(run => (run.projectPath || DEFAULT_PROJECT_PATH) === p.path).length
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const activeProject = computed(() => {
    return projectOptions.value.find(p => p.path === activeProjectPath.value) || projectOptions.value[0];
  });

  async function loadProjects() {
    const data = await api.getProjects();
    if (data) projects.value = data;
  }

  async function browseFolder() {
    try {
      const data = await api.browseFolder();
      newProjectPath.value = data.path;
      newProjectName.value = data.name;
    } catch (err: any) {
      window.alert(err.message || 'Mac klasor secme penceresi acilamadi.');
    }
  }

  /** Creates a project and returns its path, or null if validation/submit fails. */
  async function submitNewProject(): Promise<string | null> {
    if (!newProjectPath.value.trim()) return null;
    isSubmittingProject.value = true;
    try {
      const added = await api.createProject(newProjectPath.value.trim(), newProjectName.value.trim());
      await loadProjects();
      closeAddProjectModal();
      return added.path;
    } catch (err: any) {
      window.alert(err.message || 'Proje kaydedilirken hata olustu.');
      return null;
    } finally {
      isSubmittingProject.value = false;
    }
  }

  /** Removes a project; returns the fallback path to select if the active one was deleted. */
  async function deleteProject(projectPath: string): Promise<string | null> {
    if (projectOptions.value.length <= 1) {
      window.alert('En az bir proje tanimli olmalidir.');
      return null;
    }
    if (!window.confirm('Bu projeyi listeden kaldirmak istediginize emin misiniz? (Mevcut sohbet gecmisi silinmeyecektir)')) {
      return null;
    }

    try {
      await api.deleteProject(projectPath);
      await loadProjects();
      if (activeProjectPath.value === projectPath) {
        return projectOptions.value[0]?.path || '';
      }
    } catch (err) {
      console.error(err);
    }
    return null;
  }

  function openAddProjectModal() {
    newProjectName.value = '';
    newProjectPath.value = '';
    showAddProjectModal.value = true;
  }

  function closeAddProjectModal() {
    showAddProjectModal.value = false;
  }

  return {
    projects,
    activeProjectPath,
    projectOptions,
    activeProject,
    showAddProjectModal,
    newProjectName,
    newProjectPath,
    isSubmittingProject,
    loadProjects,
    browseFolder,
    submitNewProject,
    deleteProject,
    openAddProjectModal,
    closeAddProjectModal
  };
}
