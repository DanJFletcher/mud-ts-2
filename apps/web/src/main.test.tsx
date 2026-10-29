import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createRoot: vi.fn(),
  render: vi.fn(),
}));

vi.mock('react-dom/client', () => ({
  createRoot: (element: HTMLElement) => {
    mocks.createRoot(element);
    return { render: mocks.render };
  },
}));

vi.mock('./AccountApp.js', () => ({ default: () => null }));

describe('web application entry point', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.createRoot.mockReset();
    mocks.render.mockReset();
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('mounts the account app into the root element in strict mode', async () => {
    await import('./main.js');

    expect(mocks.createRoot).toHaveBeenCalledOnce();
    expect(mocks.createRoot).toHaveBeenCalledWith(document.getElementById('root'));
    expect(mocks.render).toHaveBeenCalledOnce();
    const tree = mocks.render.mock.calls[0]?.[0] as { type?: unknown; props?: { children?: unknown } };
    expect(tree.type).toBe((await import('react')).StrictMode);
    expect(tree.props?.children).toBeDefined();
  });
});
