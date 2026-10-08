import { render, screen } from '@testing-library/react';
import type { StockPlatformInfo } from '@dfs/contracts';
import { PlatformBadges } from './PlatformBadges';

const platforms: StockPlatformInfo[] = [
  { id: 'adobe', label: 'Adobe Stock', lastVerified: '2026-01-01', verified: true },
  { id: 'shutterstock', label: 'Shutterstock', lastVerified: '2026-01-01', verified: true },
];

describe('PlatformBadges', () => {
  it('shows a dash without validations', () => {
    render(<PlatformBadges validations={[]} platforms={platforms} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('renders short codes with tones and messages on hover', () => {
    render(
      <PlatformBadges
        validations={[
          { platform: 'adobe', level: 'ok', messages: [] },
          { platform: 'shutterstock', level: 'error', messages: ['Title too long', 'No category'] },
          { platform: 'pond5', level: 'warning', messages: ['Few keywords'] },
          { platform: 'storyblocks', level: 'ok', messages: [] },
        ]}
        platforms={platforms}
      />,
    );
    const as = screen.getByText('AS');
    expect(as.getAttribute('title')).toBe('Adobe Stock: OK');
    expect(as.className).toContain('emerald');
    const ss = screen.getByText('SS');
    expect(ss.getAttribute('title')).toBe('Shutterstock:\n• Title too long\n• No category');
    expect(ss.className).toContain('red');
    // Unknown labels fall back to the platform id.
    expect(screen.getByText('P5').getAttribute('title')).toBe('pond5:\n• Few keywords');
    expect(screen.getByText('ST').getAttribute('title')).toBe('storyblocks: OK');
  });
});
