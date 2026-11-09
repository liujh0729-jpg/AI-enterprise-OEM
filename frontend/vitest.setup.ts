import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

vi.mock('@/lib/i18n/i18n', () => ({
  useI18n: () => ({
    lang: 'zh-CN',
    dir: 'ltr',
    antdLocale: undefined,
    setLang: vi.fn(),
    t: (text: string) => text,
  }),
}));

afterEach(() => {
  cleanup();
});

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

class ResizeObserverMock implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock;

window.scrollTo = vi.fn();
