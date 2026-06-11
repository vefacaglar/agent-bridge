/**
 * Pure display formatters for model/provider identifiers. No state — safe to
 * use from any component (composer menus, preset rows, settings).
 */

/** "anthropic/claude-opus-4-8" -> "Claude Opus 4.8" (with brand-cased fallbacks). */
export function formatModelName(modelId: string): string {
  let name = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
  const lowerName = name.toLowerCase();

  if (lowerName === 'claude-sonnet-4-6') return 'Claude Sonnet 4.6';
  if (lowerName === 'claude-opus-4-8') return 'Claude Opus 4.8';
  if (lowerName === 'claude-haiku-4-5-20251001') return 'Claude Haiku 4.5';
  if (lowerName === 'deepseek-v4-pro') return 'DeepSeek V4 Pro';
  if (lowerName === 'deepseek-v4-flash') return 'DeepSeek V4 Flash';
  if (lowerName === 'deepseek-chat') return 'DeepSeek Chat';
  if (lowerName === 'deepseek-reasoner') return 'DeepSeek Reasoner';

  name = name.replace(/^claude-/i, 'Claude ');
  name = name.replace(/^deepseek-/i, 'DeepSeek ');
  name = name.replace(/^gpt-/i, 'GPT-');
  name = name.replace(/^glm-/i, 'GLM ');
  name = name.replace(/^kimi-/i, 'Kimi ');
  name = name.replace(/^minimax-/i, 'MiniMax ');
  name = name.replace(/^mimo-/i, 'Mimo ');
  name = name.replace(/-/g, ' ');

  return name.split(' ').map(word => {
    if (!word) return '';
    if (word === word.toUpperCase() && word.length > 1) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

/** 200000 -> "200K", 1000000 -> "1M". Empty string when unknown. */
export function formatContextLimit(limit?: number): string {
  if (!limit) return '';
  if (limit >= 1000000) {
    return `${Math.round(limit / 1000000)}M`;
  }
  if (limit >= 1000) {
    return `${Math.round(limit / 1000)}K`;
  }
  return String(limit);
}

/** One-line description for a reasoning-effort level shown in the menu. */
export function getReasoningDesc(id: string): string {
  const descriptions: Record<string, string> = {
    default: 'Use provider default configuration',
    none: 'Disable thinking/reasoning completely',
    minimal: 'Minimal reasoning tokens and budget',
    low: 'Low reasoning overhead',
    medium: 'Balanced thinking depth',
    high: 'High reasoning depth',
    xhigh: 'Extra high reasoning depth',
    max: 'Maximum reasoning depth'
  };
  return descriptions[id] || 'Reasoning parameter';
}
