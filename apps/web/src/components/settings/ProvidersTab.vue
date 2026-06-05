<script setup lang="ts">
import type { ProviderMetadata } from '@bridgemind/shared';

defineProps<{
  providers: ProviderMetadata[];
}>();
</script>

<template>
  <div class="settings-tab-panel">
    <header class="settings-section-head">
      <div>
        <h3 class="settings-section-title">Providers</h3>
        <p class="settings-section-desc">
          Configured in <code>providers.local.json</code>. API keys stay on the
          backend and are never shown here.
        </p>
      </div>
    </header>

    <div v-if="providers.length === 0" class="settings-empty">
      No providers configured. Add them to providers.local.json.
    </div>

    <ul v-else class="provider-list">
      <li v-for="provider in providers" :key="provider.id" class="provider-item">
        <div class="provider-head">
          <span class="provider-name">{{ provider.displayName }}</span>
          <span class="provider-type">{{ provider.type }}</span>
        </div>
        <div class="provider-models">
          <span v-for="model in provider.models" :key="model" class="provider-model-pill">{{ model }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.provider-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.provider-item {
  padding: 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.provider-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.provider-name {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--text);
}

.provider-type {
  font-size: 0.72rem;
  color: var(--muted);
  background: var(--surface-strong);
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: 20px;
  font-family: monospace;
}

.provider-models {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.provider-model-pill {
  font-size: 0.75rem;
  font-family: monospace;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  padding: 3px 8px;
  border-radius: 6px;
}
</style>
