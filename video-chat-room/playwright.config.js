import { defineConfig } from '@playwright/test';

/**
 * Playwright E2E (задача 24, TDD §11; PRD US-1…US-13). Сценарии на базе Gherkin:
 * вход по ссылке, видимость потоков, чат в реальном времени, индикация mute,
 * выход/обрыв, «комната заполнена».
 *
 * Приложение под тестом — собранный клиент, который раздаёт сам сервер вместе с
 * Socket.io на одном origin (TDD §12). Сервер поднимается по HTTPS, если в `certs/`
 * есть сертификат (secure context для getUserMedia/WebRTC) — поэтому baseURL https
 * и `ignoreHTTPSErrors` для самоподписанного сертификата.
 *
 * Fake-медиа: Chromium запускается с `--use-fake-device-for-media-stream` (поток
 * без реальных устройств) и `--use-fake-ui-for-media-stream` (авто-грант доступа).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'https://localhost:3001',
    ignoreHTTPSErrors: true,
    permissions: ['camera', 'microphone'],
    trace: 'on-first-retry',
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    // Собираем клиент и поднимаем сервер (раздаёт SPA + Socket.io на одном origin).
    command: 'npm run build && npm run start',
    url: 'https://localhost:3001/healthz',
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
