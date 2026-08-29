import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App.js';

describe('App', () => {
  it('renders the application name', () => {
    render(<App />);
    expect(screen.getByText('CraftifAI')).toBeDefined();
  });
});
