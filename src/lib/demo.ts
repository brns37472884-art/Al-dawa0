/** DEMO_MODE للعميل — يقرأ من /api/config مباشرة (لا يُصدَّق للقرارات الأمنية) */
let cached: boolean | null = null;

export function isDemoModeClient(): boolean {
  return cached ?? false;
}

export function initDemoModeClient(v: boolean): void {
  cached = v;
}
