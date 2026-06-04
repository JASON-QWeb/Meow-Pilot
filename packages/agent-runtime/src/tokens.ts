export function estimateTokens(text: string) {
  const cjk = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const words = text.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9_'-]+/g)?.length ?? 0;
  const punctuation = text.match(/[^\sA-Za-z0-9_\u3400-\u9fff]/g)?.length ?? 0;
  return Math.max(1, Math.ceil(cjk * 1.1 + words * 1.35 + punctuation * 0.35));
}
