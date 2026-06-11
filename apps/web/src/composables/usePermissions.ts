import { ref } from 'vue';
import type { PermissionRule } from '@locagens/shared';
import { api } from '../api/client';
import { useCustomDialog } from './useCustomDialog';

/**
 * Owns the standing-permissions list and the settings modal that manages it.
 * Permissions are loaded lazily when the modal opens.
 */
export function usePermissions() {
  const { showConfirm } = useCustomDialog();
  const permissions = ref<PermissionRule[]>([]);
  const showSettings = ref(false);
  const isLoading = ref(false);

  async function loadPermissions() {
    isLoading.value = true;
    try {
      const data = await api.getPermissions();
      if (data) permissions.value = data;
    } finally {
      isLoading.value = false;
    }
  }

  async function openSettings() {
    showSettings.value = true;
    await loadPermissions();
  }

  function closeSettings() {
    showSettings.value = false;
  }

  async function revokePermission(id: number) {
    await api.revokePermission(id);
    permissions.value = permissions.value.filter(p => p.id !== id);
  }

  async function clearPermissions() {
    if (permissions.value.length === 0) return;
    if (!(await showConfirm('Are you sure you want to remove all saved permissions?'))) return;
    await api.clearPermissions();
    permissions.value = [];
  }

  return {
    permissions,
    showSettings,
    isLoading,
    openSettings,
    closeSettings,
    revokePermission,
    clearPermissions
  };
}
