<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import type { UsageLog } from '@agent-bridge/shared';
import { api } from '../api/client';

const emit = defineEmits<{
  (e: 'select-run', runId: string): void;
}>();

const logs = ref<UsageLog[]>([]);
const isLoading = ref(true);

// Filter states
const searchQuery = ref('');
const selectedProvider = ref('');
const selectedRole = ref('');

// Pagination states
const currentPage = ref(1);
const itemsPerPage = 50;

async function loadLogs() {
  isLoading.value = true;
  try {
    const data = await api.getUsageLogs();
    logs.value = data || [];
  } catch (err) {
    console.error('Failed to load usage logs:', err);
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadLogs);

// Unique values for filter dropdowns
const uniqueProviders = computed(() => {
  const set = new Set<string>();
  logs.value.forEach(l => {
    if (l.providerId) set.add(l.providerId);
  });
  return Array.from(set).sort();
});

const uniqueRoles = computed(() => {
  const set = new Set<string>();
  logs.value.forEach(l => {
    if (l.agentRole) set.add(l.agentRole);
  });
  return Array.from(set).sort();
});

// Summary metrics (always based on the complete unfiltered list of logs, to show total usage)
const totalCost = computed(() => {
  return logs.value.reduce((sum, log) => sum + (log.cost || 0), 0);
});

const totalCalls = computed(() => {
  return logs.value.length;
});

const totalTokens = computed(() => {
  return logs.value.reduce((sum, log) => {
    return sum + (log.inputTokens || 0) + (log.outputTokens || 0) + (log.cacheReadTokens || 0);
  }, 0);
});

const avgCacheHitRate = computed(() => {
  const totalPrompt = logs.value.reduce((sum, log) => {
    return sum + (log.inputTokens || 0) + (log.cacheReadTokens || 0);
  }, 0);
  const totalCacheRead = logs.value.reduce((sum, log) => {
    return sum + (log.cacheReadTokens || 0);
  }, 0);
  return totalPrompt > 0 ? Math.round((totalCacheRead / totalPrompt) * 100) : 0;
});

// Filtering logic
const filteredLogs = computed(() => {
  let result = logs.value;

  if (selectedProvider.value) {
    result = result.filter(l => l.providerId === selectedProvider.value);
  }

  if (selectedRole.value) {
    result = result.filter(l => l.agentRole === selectedRole.value);
  }

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase().trim();
    result = result.filter(l => 
      l.runId.toLowerCase().includes(query) ||
      (l.model && l.model.toLowerCase().includes(query))
    );
  }

  return result;
});

// Pagination logic
const totalPages = computed(() => {
  return Math.ceil(filteredLogs.value.length / itemsPerPage) || 1;
});

watch(totalPages, (newVal) => {
  if (currentPage.value > newVal) {
    currentPage.value = newVal;
  }
});

const paginatedLogs = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  return filteredLogs.value.slice(start, end);
});

function setPage(page: number) {
  if (page < 1 || page > totalPages.value) return;
  currentPage.value = page;
  const el = document.querySelector('.table-container');
  if (el) el.scrollTop = 0;
}

function clearFilters() {
  searchQuery.value = '';
  selectedProvider.value = '';
  selectedRole.value = '';
  currentPage.value = 1;
}

function openRun(runId: string) {
  emit('select-run', runId);
}

// Helpers
function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  
  const totalSecs = Math.floor(seconds);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  
  return parts.join(' ');
}

function formatNumber(num: number): string {
  if (num === undefined || num === null) return '0';
  return num.toLocaleString('en-US');
}

function formatCost(cost: number | undefined): string {
  if (cost === undefined || cost === null) return '0.00000';
  if (cost === 0) return '0.00000';
  if (cost < 0.00001) {
    return cost.toFixed(6);
  }
  return cost.toFixed(5);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function getHitRateClass(rate: number): string {
  if (rate > 50) return 'hit-high';
  if (rate > 0) return 'hit-med';
  return 'hit-none';
}
</script>

<template>
  <div class="usage-logs-view">
    <!-- Summary Metrics -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-title">Total Cost</div>
        <div class="metric-value cost-value">${{ formatCost(totalCost) }}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Total Calls</div>
        <div class="metric-value">{{ formatNumber(totalCalls) }}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Total Tokens</div>
        <div class="metric-value">{{ formatNumber(totalTokens) }}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Avg Cache Hit Rate</div>
        <div class="metric-value" :class="getHitRateClass(avgCacheHitRate)">
          {{ avgCacheHitRate }}%
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="filter-bar">
      <div class="filter-group flex-fill">
        <input 
          v-model="searchQuery" 
          type="text" 
          placeholder="Search model or run ID..." 
          class="filter-input w-full"
          @input="currentPage = 1"
        />
      </div>
      <div class="filter-group">
        <select v-model="selectedProvider" class="filter-select" @change="currentPage = 1">
          <option value="">All Providers</option>
          <option v-for="prov in uniqueProviders" :key="prov" :value="prov">{{ prov }}</option>
        </select>
      </div>
      <div class="filter-group">
        <select v-model="selectedRole" class="filter-select" @change="currentPage = 1">
          <option value="">All Roles</option>
          <option v-for="role in uniqueRoles" :key="role" :value="role">{{ role }}</option>
        </select>
      </div>
      <button 
        v-if="searchQuery || selectedProvider || selectedRole" 
        class="clear-btn" 
        @click="clearFilters"
      >
        Clear Filters
      </button>
    </div>

    <!-- Table Container -->
    <div class="table-container">
      <div v-if="isLoading" class="loading-state">
        <div class="spinner"></div>
        <span>Loading usage logs...</span>
      </div>

      <div v-else-if="filteredLogs.length === 0" class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-icon">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <h3>No Logs Found</h3>
        <p v-if="logs.length > 0">No records match the current filter criteria.</p>
        <p v-else>Run a chat session to generate usage and pricing logs.</p>
      </div>

      <table v-else class="logs-table">
        <thead>
          <tr>
            <th class="col-date">Date & Time</th>
            <th class="col-run-id">Run ID</th>
            <th class="col-role">Role</th>
            <th class="col-provider">Provider</th>
            <th class="col-model">Model</th>
            <th class="col-input-tokens text-right">Tokens (In)</th>
            <th class="col-output-tokens text-right">Tokens (Out)</th>
            <th class="col-hit-rate">Cache Hit</th>
            <th class="col-duration text-right">Duration</th>
            <th class="col-cost text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in paginatedLogs" :key="log.id" class="log-row">
            <td class="col-date">{{ formatDate(log.createdAt) }}</td>
            <td class="col-run-id">
              <a href="#" @click.prevent="openRun(log.runId)" class="run-link font-mono" :title="`Navigate to run ${log.runId}`">
                {{ log.runId.substring(0, 8) }}
              </a>
            </td>
            <td class="col-role">
              <span class="role-badge" :class="log.agentRole">
                {{ log.agentRole }}
              </span>
            </td>
            <td class="col-provider">
              <span class="provider-badge">{{ log.providerId }}</span>
            </td>
            <td class="col-model font-mono">{{ log.model }}</td>
            <td class="col-input-tokens text-right font-mono">
              <span>{{ formatNumber(log.inputTokens) }}</span>
              <span v-if="log.cacheReadTokens" class="token-cache font-success" title="Cached input tokens (Hit)">
                +{{ formatNumber(log.cacheReadTokens) }} hit
              </span>
            </td>
            <td class="col-output-tokens text-right font-mono">
              <span>{{ formatNumber(log.outputTokens) }}</span>
            </td>
            <td class="col-hit-rate">
              <span v-if="log.cacheHitRate !== undefined" class="hit-pct" :class="getHitRateClass(log.cacheHitRate)">
                {{ log.cacheHitRate }}%
              </span>
              <span v-else class="text-faint">-</span>
            </td>
            <td class="col-duration font-mono text-right text-faint">
              {{ formatDuration(log.durationMs) }}
            </td>
            <td class="col-cost font-mono text-right">
              ${{ formatCost(log.cost) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination Controls -->
    <div v-if="filteredLogs.length > 0" class="pagination-bar">
      <div class="page-info">
        Showing {{ (currentPage - 1) * itemsPerPage + 1 }} - {{ Math.min(currentPage * itemsPerPage, filteredLogs.length) }} of {{ filteredLogs.length }} runs
      </div>
      <div class="page-buttons">
        <button 
          class="page-btn" 
          :disabled="currentPage === 1" 
          @click="setPage(1)"
          title="First Page"
        >
          &laquo;
        </button>
        <button 
          class="page-btn" 
          :disabled="currentPage === 1" 
          @click="setPage(currentPage - 1)"
          title="Previous Page"
        >
          &lsaquo;
        </button>
        
        <span class="page-indicator">
          Page {{ currentPage }} of {{ totalPages }}
        </span>

        <button 
          class="page-btn" 
          :disabled="currentPage === totalPages" 
          @click="setPage(currentPage + 1)"
          title="Next Page"
        >
          &rsaquo;
        </button>
        <button 
          class="page-btn" 
          :disabled="currentPage === totalPages" 
          @click="setPage(totalPages)"
          title="Last Page"
        >
          &raquo;
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.usage-logs-view {
  display: flex;
  flex-direction: column;
  height: calc(100% - var(--top-bar-h) - 20px);
  padding: 16px 24px;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
}

/* Metrics Grid */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.metric-card {
  background: var(--surface-elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s, border-color 0.2s;
}

.metric-card:hover {
  border-color: var(--control-border-focus);
}

.metric-title {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--faint);
  font-weight: 700;
}

.metric-value {
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--text);
}

.cost-value {
  color: var(--info);
}

/* Filters */
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
  padding: 10px 14px;
  background: var(--surface-elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  flex-shrink: 0;
}

.filter-group {
  display: flex;
  align-items: center;
}

.flex-fill {
  flex: 1;
  min-width: 200px;
}

.w-full {
  width: 100%;
}

.filter-input,
.filter-select {
  background: var(--control-bg);
  border: 1px solid var(--control-border);
  border-radius: 6px;
  padding: 8px 12px;
  color: var(--text);
  font-size: 0.84rem;
  transition: all 0.2s ease;
}

.filter-input:focus,
.filter-select:focus {
  border-color: var(--control-border-focus);
  outline: none;
  background: var(--control-bg-hover);
}

.clear-btn {
  background: transparent;
  border: none;
  color: var(--danger);
  font-size: 0.84rem;
  cursor: pointer;
  padding: 4px 8px;
  transition: all 0.2s ease;
  border-radius: 4px;
}

.clear-btn:hover {
  background: var(--danger-soft);
}

/* Table Container */
.table-container {
  flex: 1;
  overflow-y: auto;
  background: var(--surface-elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  min-height: 0;
  position: relative;
}

.logs-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 0.86rem;
}

.logs-table th {
  position: sticky;
  top: 0;
  background: var(--control-bg);
  color: var(--muted);
  font-weight: 600;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  z-index: 2;
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.logs-table td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-soft);
  color: var(--text);
  vertical-align: middle;
}

.log-row {
  transition: background 0.15s ease;
}

.log-row:hover {
  background: rgba(255, 255, 255, 0.015);
}

.run-link {
  color: var(--info);
  text-decoration: none;
  font-weight: 600;
  padding: 2px 4px;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.run-link:hover {
  background: rgba(160, 160, 165, 0.12);
  text-decoration: underline;
}

.font-mono {
  font-family: 'Fira Code', 'Courier New', Courier, monospace;
  font-size: 0.82rem;
}

.text-right {
  text-align: right !important;
}

.text-faint {
  color: var(--faint);
}

/* Badges */
.role-badge,
.provider-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.role-badge.main {
  background: rgba(123, 216, 143, 0.08);
  color: var(--executor);
  border: 1px solid rgba(123, 216, 143, 0.18);
}

.role-badge.coder {
  background: rgba(160, 160, 165, 0.08);
  color: var(--info);
  border: 1px solid rgba(160, 160, 165, 0.18);
}

.role-badge.utility {
  background: rgba(255, 209, 138, 0.08);
  color: var(--warning);
  border: 1px solid rgba(255, 209, 138, 0.18);
}

.provider-badge {
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

/* Tokens breakdown */
.token-breakdown {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.token-main {
  font-weight: 500;
}

.token-lbl {
  color: var(--faint);
  font-size: 0.78rem;
}

.token-cache {
  font-size: 0.72rem;
  display: block;
}

.font-success {
  color: var(--success);
}

/* Cache Hit Rates */
.hit-pct {
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
}

.hit-high {
  color: var(--success);
  background: rgba(123, 216, 143, 0.06);
}

.hit-med {
  color: var(--warning);
  background: rgba(255, 209, 138, 0.06);
}

.hit-none {
  color: var(--faint);
}

/* Loading & Empty States */
.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.loading-state {
  gap: 16px;
  color: var(--muted);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.08);
  border-top-color: var(--info);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.empty-state {
  color: var(--faint);
  gap: 12px;
}

.empty-state h3 {
  color: var(--text);
  margin: 0;
  font-size: 1.2rem;
}

.empty-state p {
  margin: 0;
  font-size: 0.88rem;
}

.empty-icon {
  color: var(--faint);
  margin-bottom: 8px;
}

/* Pagination Bar */
.pagination-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
  padding: 10px 16px;
  background: var(--surface-elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  flex-shrink: 0;
}

.page-info {
  font-size: 0.82rem;
  color: var(--faint);
}

.page-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

.page-indicator {
  font-size: 0.84rem;
  color: var(--muted);
  min-width: 90px;
  text-align: center;
}

.page-btn {
  background: var(--control-bg);
  border: 1px solid var(--control-border);
  color: var(--text);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.86rem;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.page-btn:hover:not(:disabled) {
  background: var(--control-bg-hover);
  border-color: var(--control-border-focus);
}

.page-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
