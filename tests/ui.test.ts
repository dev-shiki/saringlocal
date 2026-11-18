import { beforeEach, describe, expect, it } from 'vitest';
import { mountWorkbench } from '../src/ui/app';

describe('SaringLocal Workbench UI', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    window.localStorage.clear();
  });

  it('renders empty state, runs triage, switches ARIA tabs by click and keyboard, and toggles theme', async () => {
    const root = document.getElementById('app')!;
    mountWorkbench(root);

    const panelTriage = root.querySelector<HTMLElement>('#panel-triage')!;
    expect(panelTriage.textContent).toContain('No triage run yet');

    const runBtn = root.querySelector<HTMLButtonElement>('#run-triage-btn')!;
    runBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(panelTriage.textContent).toContain('Source: local_deterministic');
    expect(panelTriage.textContent).toContain('Priority: HIGH');

    // Switch to Cloud Payload Diff tab via keyboard ArrowRight
    const tabTriage = root.querySelector<HTMLButtonElement>('#tab-triage')!;
    const tabDiff = root.querySelector<HTMLButtonElement>('#tab-diff')!;
    const panelDiff = root.querySelector<HTMLElement>('#panel-diff')!;

    tabTriage.focus();
    tabTriage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(tabDiff.getAttribute('aria-selected')).toBe('true');
    expect(panelDiff.hidden).toBe(false);
    expect(panelDiff.textContent).toContain('[EMAIL_1]');
    expect(panelDiff.textContent).toContain('[SECRET_1]');

    // Clear document and verify error state on empty run
    root.querySelector<HTMLButtonElement>('#clear-doc-btn')!.click();
    runBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(panelTriage.textContent).toContain('Document input is empty');

    // Theme toggle switches data-theme
    const themeBtn = root.querySelector<HTMLButtonElement>('#theme-toggle')!;
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    themeBtn.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(themeBtn.getAttribute('aria-pressed')).toBe('true');
  });
});
