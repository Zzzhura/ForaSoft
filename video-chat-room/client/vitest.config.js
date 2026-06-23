import { defineConfig } from 'vitest/config';

/**
 * Конфиг Vitest для клиентских unit-тестов (задача 22, TDD §11).
 * По умолчанию окружение `node` (для `PeerConnectionManager` с мок-WebRTC);
 * тесты React-хука включают jsdom пофайлово через `// @vitest-environment jsdom`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
    clearMocks: true,
  },
});
