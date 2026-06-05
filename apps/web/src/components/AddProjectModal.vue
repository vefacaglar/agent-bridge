<script setup lang="ts">
defineProps<{
  show: boolean;
  isMac: boolean;
  isSubmitting: boolean;
  name: string;
  path: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'browse'): void;
  (e: 'submit'): void;
  (e: 'update:name', value: string): void;
  (e: 'update:path', value: string): void;
}>();
</script>

<template>
  <div v-if="show" class="modal-overlay" @click.self="emit('close')">
    <div class="modal-card">
      <header class="modal-header">
        <h3>Add Project Folder</h3>
        <button class="close-modal-btn" @click="emit('close')">×</button>
      </header>

      <main class="modal-body">
        <div v-if="isMac" class="form-group">
          <button class="primary-button browse-btn" @click="emit('browse')">
            📂 Select Folder (macOS Finder)
          </button>
          <div class="separator-text">or enter path manually</div>
        </div>

        <div class="form-group">
          <label for="project-path">Absolute Folder Path</label>
          <input
            id="project-path"
            type="text"
            :value="path"
            placeholder="/Users/username/Projects/my-app"
            @input="emit('update:path', ($event.target as HTMLInputElement).value)"
          />
        </div>

        <div class="form-group">
          <label for="project-name">Display Name (Optional)</label>
          <input
            id="project-name"
            type="text"
            :value="name"
            placeholder="my-app"
            @input="emit('update:name', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </main>

      <footer class="modal-footer">
        <button class="ghost-button" @click="emit('close')">Cancel</button>
        <button class="primary-button" :disabled="!path.trim() || isSubmitting" @click="emit('submit')">
          {{ isSubmitting ? 'Adding...' : 'Add Project' }}
        </button>
      </footer>
    </div>
  </div>
</template>
