export interface ConfirmationQuestion {
  question: string;
  options: string[];
}

export function parseConfirmations(content: string): ConfirmationQuestion[] {
  const confirmations: ConfirmationQuestion[] = [];
  const regex = /<confirm\b([^>]*)>([\s\S]*?)<\/confirm>/ig;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const attrs = match[1];
    const questionText = match[2].trim();
    if (!questionText) continue;
    
    let options: string[] = [];
    const optMatch = /options="([^"]+)"/i.exec(attrs);
    if (optMatch) {
      options = optMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    } else {
      const isTurkish = /[\u011e\u011f\u0130\u0131\u015e\u015f\u00c7\u00e7\u00d6\u00f6\u00dc\u00fc]/i.test(questionText) || 
        /\b(evet|hayır|onay|başla|devam|uygun|mı|mi|mu|mü)\b/i.test(questionText.toLowerCase());
      options = isTurkish ? ['Evet', 'Hayır'] : ['Yes', 'No'];
    }
    
    confirmations.push({
      question: questionText,
      options
    });
  }
  return confirmations;
}

export function getConfirmations(content: string): ConfirmationQuestion[] {
  return parseConfirmations(content);
}

export function getConfirmationOptions(content: string): string[] | null {
  const confs = getConfirmations(content);
  if (confs.length === 0) return null;
  return confs[0].options;
}
