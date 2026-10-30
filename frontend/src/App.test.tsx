import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

test('renders the placeholder page', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Code Shell' })).toBeTruthy();
});
