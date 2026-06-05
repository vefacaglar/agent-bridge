import { ref } from 'vue';

export interface DialogRequest {
  type: 'alert' | 'confirm';
  title?: string;
  message: string;
  resolve: (value: boolean) => void;
}

const activeDialog = ref<DialogRequest | null>(null);

export function useCustomDialog() {
  function showAlert(message: string, title = 'Alert'): Promise<void> {
    return new Promise<void>((resolve) => {
      activeDialog.value = {
        type: 'alert',
        title,
        message,
        resolve: () => {
          activeDialog.value = null;
          resolve();
        }
      };
    });
  }

  function showConfirm(message: string, title = 'Confirm'): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      activeDialog.value = {
        type: 'confirm',
        title,
        message,
        resolve: (result: boolean) => {
          activeDialog.value = null;
          resolve(result);
        }
      };
    });
  }

  return {
    activeDialog,
    showAlert,
    showConfirm
  };
}
