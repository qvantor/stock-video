import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG_DIR, loadStockConfig, stockCategories } from './config.js';

describe('stock config', () => {
  it('loads and validates the bundled configs', () => {
    const config = loadStockConfig();
    expect(config.adobe.categories).toHaveLength(21);
    expect(config.shutterstock.categories).toContain('Buildings/Landmarks');
    // Footage list: photo-only categories are rejected by Shutterstock for video.
    expect(config.shutterstock.categories).toHaveLength(19);
    expect(config.shutterstock.categories).not.toContain('Parks/Outdoor');
    expect(config.envato.categories).toContain('Overhead');
    expect(config.pond5.header[0]).toBe('originalfilename');
    expect(stockCategories(config).adobe[1]).toEqual({
      id: 2,
      label: 'Buildings and Architecture',
    });
  });

  it('reports a readable error for a broken file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfs-stock-'));
    for (const f of fs.readdirSync(DEFAULT_CONFIG_DIR))
      fs.copyFileSync(path.join(DEFAULT_CONFIG_DIR, f), path.join(dir, f));
    fs.writeFileSync(path.join(dir, 'adobe.json'), JSON.stringify({ platform: 'adobe' }));
    expect(() => loadStockConfig(dir)).toThrow(/Invalid stock config .*adobe\.json/);
    fs.rmSync(dir, { recursive: true });
  });
});
